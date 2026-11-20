import { ApiError, isErrorBody, readErrorResponse, request } from './http.js'
import { streamChatCompletion } from './openai.js'
import { readMessageEvent } from './parseEvent.js'
import type { ResolvedProvider } from './provider.js'
import { isMissingEndpointStatus } from './provider.js'
import { readServerSentEvents } from './sse.js'
import type {
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageParam,
  MessageStreamEvent,
} from './types.js'

export { ApiError, request } from './http.js'
export type { ApiErrorKind } from './http.js'

/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'
/** 原生 Anthropic 接口要求的协议版本；缺少该头会直接拒绝 */
const ANTHROPIC_VERSION = '2023-06-01'
/** 第三方 Anthropic 兼容接口要求 max_tokens 必填 */
const COMPATIBLE_MAX_TOKENS = 8192

/**
 * 只有官方 Anthropic 接口要求 anthropic-version 与浏览器直连声明。
 * 第三方网关的 CORS 白名单通常只允许 Authorization，多带这两个头会导致预检被拒。
 */
const isNativeAnthropic = (url: string): boolean => {
  try {
    return new URL(url).hostname.endsWith('anthropic.com')
  } catch {
    return false
  }
}

/**
 * 第三方 Anthropic 兼容接口的鉴权方式：默认 Bearer，
 * 服务端拒绝时依次回退到 x-api-key、原生 Anthropic 头（含协议版本）。
 */
type AnthropicAuthMode = 'bearer' | 'x-api-key' | 'native'

/** 记住每个接口源已确认可用的鉴权方式，后续请求不再重复失败一次 */
const anthropicAuthCache = new Map<string, AnthropicAuthMode>()

const authCacheKey = (url: string) => {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

const authHeadersFor = (
  provider: ResolvedProvider,
  mode: AnthropicAuthMode
): Record<string, string> => {
  if (mode === 'bearer') {
    return { Authorization: `Bearer ${provider.apiKey}` }
  }
  if (mode === 'x-api-key') {
    return { 'x-api-key': provider.apiKey }
  }
  return {
    'x-api-key': provider.apiKey,
    Authorization: `Bearer ${provider.apiKey}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}

/** 官方 Anthropic 只用原生方式；第三方优先用上一次成功的方式 */
const anthropicAuthOrder = (url: string): AnthropicAuthMode[] => {
  const modes: AnthropicAuthMode[] = isNativeAnthropic(url)
    ? ['native']
    : ['bearer', 'x-api-key', 'native']
  const cached = anthropicAuthCache.get(authCacheKey(url))
  return cached ? [cached, ...modes.filter((mode) => mode !== cached)] : modes
}

/** 鉴权失败（401/403）或服务端要求 anthropic-version 时，值得换一种方式重试 */
const shouldRetryAuth = (error: unknown) =>
  error instanceof ApiError &&
  (error.status === 401 ||
    error.status === 403 ||
    (error.status === 400 && /anthropic-version/i.test(error.message)))

/**
 * 第三方 Anthropic 兼容接口的鉴权回退：按顺序尝试，成功即记住该方式。
 * 回退请求若被浏览器拦截（如网关 CORS 不允许 x-api-key），仍抛出服务端给出的鉴权错误。
 */
const requestAnthropic = async (
  provider: ResolvedProvider,
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<Response> => {
  const order = anthropicAuthOrder(url)
  let authError: unknown
  for (let index = 0; index < order.length; index += 1) {
    try {
      const response = await request(url, {
        ...init,
        headers: { ...init.headers, ...authHeadersFor(provider, order[index]) },
        signal,
      })
      anthropicAuthCache.set(authCacheKey(url), order[index])
      return response
    } catch (error) {
      if (!shouldRetryAuth(error)) {
        throw authError ?? error
      }
      authError = error
      if (index === order.length - 1) {
        throw error
      }
    }
  }
  throw authError
}

/** 官方扩展接口的请求头；第三方由各自的鉴权流程补充 */
const headersFor = (
  provider: ResolvedProvider,
  { json = false, beta = false }: { json?: boolean; beta?: boolean } = {}
): Record<string, string> => {
  if (!provider.extended) {
    return json ? { 'Content-Type': 'application/json' } : {}
  }
  return {
    'x-api-key': provider.apiKey,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
  }
}

/** 官方与 OpenAI 兼容接口的模型列表鉴权头都用 Bearer */
const modelsHeaders = (provider: ResolvedProvider): Record<string, string> => ({
  Authorization: `Bearer ${provider.apiKey}`,
})

export type VerifyResult = {
  /** false 表示供应商没有模型列表接口，鉴权已跳过而不是失败 */
  verified: boolean
}

/** 用 GET /models 校验供应商配置（不产生费用）；没有该接口的供应商返回 unverified */
export const verifyProvider = async (
  provider: ResolvedProvider,
  signal?: AbortSignal
): Promise<VerifyResult> => {
  if (!provider.configured) {
    throw new ApiError('protocol', { key: 'providerIncomplete' })
  }
  try {
    if (provider.id === 'custom' && provider.protocol === 'anthropic') {
      await requestAnthropic(provider, provider.modelsUrl, { method: 'GET' }, signal)
    } else {
      await request(provider.modelsUrl, {
        method: 'GET',
        headers: modelsHeaders(provider),
        signal,
      })
    }
    return { verified: true }
  } catch (error) {
    if (error instanceof ApiError && isMissingEndpointStatus(error.status)) {
      return { verified: false }
    }
    throw error
  }
}

/** GET /models，返回可用模型 id；部分第三方不提供该接口或跨域被拦截时抛错 */
export const listModels = async (
  provider: ResolvedProvider,
  signal?: AbortSignal
): Promise<string[]> => {
  if (!provider.configured) {
    throw new ApiError('protocol', { key: 'providerIncomplete' })
  }
  const response =
    provider.id === 'custom' && provider.protocol === 'anthropic'
      ? await requestAnthropic(provider, provider.modelsUrl, { method: 'GET' }, signal)
      : await request(provider.modelsUrl, {
          method: 'GET',
          headers: modelsHeaders(provider),
          signal,
        })
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new ApiError('protocol', text)
  }
  const data =
    typeof body === 'object' && body !== null && 'data' in body
      ? (body as { data: unknown }).data
      : undefined
  if (!Array.isArray(data)) {
    throw new ApiError('protocol', text)
  }
  const ids = data.flatMap((item) => {
    if (typeof item === 'string') {
      return [item]
    }
    if (typeof item === 'object' && item !== null && 'id' in item) {
      const id = (item as { id: unknown }).id
      return typeof id === 'string' ? [id] : []
    }
    return []
  })
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

/**
 * POST {filesUrl} 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  provider: ResolvedProvider,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  if (!provider.filesUrl) {
    throw new ApiError('protocol', { key: 'providerNoFiles' })
  }
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(provider.filesUrl, {
    method: 'POST',
    headers: headersFor(provider, { beta: true }),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE {filesUrl}/{file_id} */
export const deleteFile = async (provider: ResolvedProvider, fileId: string): Promise<void> => {
  if (!provider.filesUrl) {
    throw new ApiError('protocol', { key: 'providerNoFiles' })
  }
  await request(`${provider.filesUrl}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: headersFor(provider, { beta: true }),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * 第三方 Anthropic 兼容接口的请求体：去掉 DeepSeek 专有字段（搜索工具、标题、安全审核、
 * latest_reminder 角色、思考签名），只保留协议标准部分。
 */
const toCompatibleBody = (provider: ResolvedProvider, body: CreateMessageRequest) => {
  const messages: MessageParam[] = []
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      continue
    }
    if (message.role === 'assistant') {
      const content = message.content.filter((block) => block.type === 'text')
      if (content.length > 0) {
        messages.push({ role: 'assistant', content })
      }
      continue
    }
    if (typeof message.content === 'string') {
      if (message.content !== '') {
        messages.push(message)
      }
      continue
    }
    const content = message.content.filter((block) => block.type === 'text')
    if (content.length > 0) {
      messages.push({ role: 'user', content })
    }
  }
  return {
    model: provider.model ?? body.model,
    ...(body.system.trim() === '' ? {} : { system: body.system }),
    messages,
    stream: true,
    max_tokens: COMPATIBLE_MAX_TOKENS,
  }
}

/**
 * POST {messagesUrl}（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  provider: ResolvedProvider,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  if (!provider.configured) {
    throw new ApiError('protocol', { key: 'providerIncomplete' })
  }
  if (!provider.ready) {
    throw new ApiError('protocol', { key: 'providerModelMissing' })
  }
  if (provider.protocol === 'openai') {
    yield* streamChatCompletion(provider, body, signal)
    return
  }
  const payload = provider.extended ? { ...body, stream: true } : toCompatibleBody(provider, body)
  const init: RequestInit = {
    method: 'POST',
    headers: {
      ...headersFor(provider, { json: true, beta: provider.extended && hasFile(body) }),
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
  }
  // 第三方 Anthropic 兼容接口带鉴权回退；官方保持原有单次请求
  const response = provider.extended
    ? await request(provider.messagesUrl, { ...init, signal })
    : await requestAnthropic(provider, provider.messagesUrl, init, signal)
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
