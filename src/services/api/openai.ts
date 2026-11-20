import { ApiError, isErrorBody, request } from './http.js'
import type { ResolvedProvider } from './provider.js'
import { readServerSentEvents } from './sse.js'
import type {
  CreateMessageRequest,
  MessageParam,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
} from './types.js'

/**
 * OpenAI Chat Completions 兼容适配：把内部的 Messages 结构转成 chat 请求，
 * 再把流式 chunk 还原成应用消费的 MessageStreamEvent，上层无需区分协议。
 */

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type OpenAIChunk = {
  choices?: {
    delta?: {
      /** 正文增量 */
      content?: string | null
      /** 部分供应商（DeepSeek 官方等）用 reasoning_content 下发思考 */
      reasoning_content?: string | null
      /** OpenRouter 等用 reasoning 下发思考 */
      reasoning?: string | null
    }
    finish_reason?: string | null
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/** 内容块数组只取正文；文件块在进入请求前已被剔除 */
const blockText = (content: MessageParam['content']) => {
  if (typeof content === 'string') {
    return content
  }
  return content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n\n')
}

const toOpenAIMessages = (body: CreateMessageRequest): OpenAIMessage[] => {
  const messages: OpenAIMessage[] = []
  if (body.system.trim() !== '') {
    messages.push({ role: 'system', content: body.system })
  }
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      continue
    }
    const content = blockText(message.content)
    if (content === '') {
      continue
    }
    messages.push({ role: message.role, content })
  }
  return messages
}

/** chat 的 finish_reason 映射到应用的结束原因 */
const mapStopReason = (value: string | null | undefined): StopReason => {
  switch (value) {
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    default:
      return 'end_turn'
  }
}

const toUsage = (usage: OpenAIChunk['usage']): MessageUsage | undefined =>
  usage
    ? {
        input_tokens: usage.prompt_tokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: usage.completion_tokens ?? 0,
      }
    : undefined

const toStopEvents = (
  stopReason: StopReason,
  usage: MessageUsage | undefined,
  blockKind: 'text' | 'thinking' | null,
  blockIndex: number
): MessageStreamEvent[] => [
  ...(blockKind ? [{ type: 'content_block_stop' as const, index: blockIndex }] : []),
  { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage },
  { type: 'message_stop' },
]

/** 非流式响应（部分供应商忽略 stream）直接按完整结果还原 */
const fromCompletionBody = (raw: string, model: string): MessageStreamEvent[] | null => {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (isErrorBody(body)) {
    throw new ApiError('http', body.error.message)
  }
  if (typeof body !== 'object' || body === null || !('choices' in body)) {
    return null
  }
  const { choices, usage } = body as {
    choices?: {
      message?: { content?: string | null; reasoning_content?: string | null }
      finish_reason?: string | null
    }[]
    usage?: OpenAIChunk['usage']
  }
  const choice = choices?.[0]
  if (!choice) {
    return null
  }
  const events: MessageStreamEvent[] = [{ type: 'message_start', message: { id: '', model } }]
  let index = -1
  if (choice.message?.reasoning_content) {
    index++
    events.push(
      {
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: choice.message.reasoning_content },
      },
      { type: 'content_block_stop', index }
    )
  }
  if (choice.message?.content) {
    index++
    events.push(
      { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: choice.message.content },
      },
      { type: 'content_block_stop', index }
    )
  }
  events.push(...toStopEvents(mapStopReason(choice.finish_reason), toUsage(usage), null, index))
  return events
}

/** POST {base}/chat/completions（stream: true），逐个产出流式事件 */
export async function* streamChatCompletion(
  provider: ResolvedProvider,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const model = provider.model ?? body.model
  const response = await request(provider.messagesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ model, messages: toOpenAIMessages(body), stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    const events = fromCompletionBody(await response.text(), model)
    if (!events) {
      throw new ApiError('protocol', '')
    }
    for (const event of events) {
      yield event
    }
    return
  }
  yield { type: 'message_start', message: { id: '', model } }
  const stream = response.body
  if (!stream) {
    throw new ApiError('protocol', '')
  }
  let blockKind: 'text' | 'thinking' | null = null
  let blockIndex = -1
  let stopReason: StopReason = 'end_turn'
  let usage: MessageUsage | undefined
  /** 同一批增量合并后一次产出，减少渲染层切换 */
  const pending: MessageStreamEvent[] = []
  const append = (kind: 'text' | 'thinking') => {
    if (blockKind === kind) {
      return
    }
    if (blockKind) {
      pending.push({ type: 'content_block_stop', index: blockIndex })
    }
    blockKind = kind
    blockIndex++
    pending.push({
      type: 'content_block_start',
      index: blockIndex,
      content_block:
        kind === 'text'
          ? { type: 'text', text: '' }
          : { type: 'thinking', thinking: '', signature: '' },
    })
  }
  for await (const { data } of readServerSentEvents(stream, signal)) {
    if (data === '[DONE]') {
      break
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    const chunk = payload as OpenAIChunk
    const choice = chunk.choices?.[0]
    const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
    if (typeof reasoning === 'string' && reasoning !== '') {
      append('thinking')
      pending.push({
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'thinking_delta', thinking: reasoning },
      })
    }
    const text = choice?.delta?.content
    if (typeof text === 'string' && text !== '') {
      append('text')
      pending.push({
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'text_delta', text },
      })
    }
    if (choice?.finish_reason) {
      stopReason = mapStopReason(choice.finish_reason)
    }
    usage = toUsage(chunk.usage) ?? usage
    for (const event of pending.splice(0)) {
      yield event
    }
  }
  for (const event of toStopEvents(stopReason, usage, blockKind, blockIndex)) {
    yield event
  }
}
