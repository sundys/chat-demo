/**
 * 模型供应商配置：默认使用构建期注入的 DeepSeek 官方地址，
 * 也可以接入第三方兼容接口（Anthropic Messages 或 OpenAI Chat Completions）。
 * 这里只做纯函数解析，不读写本机设置，便于在任意上下文复用。
 */

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const OFFICIAL_API_ORIGIN = __API_ORIGIN__

export type ProviderId = 'deepseek' | 'custom'

/** 第三方接口协议：Anthropic Messages 或 OpenAI Chat Completions */
export type ApiProtocol = 'anthropic' | 'openai'

export type CustomProviderSettings = {
  /** 接口根地址，可带 /v1，也可直接填完整的 messages / chat/completions 地址 */
  baseUrl: string
  apiKey: string | null
  protocol: ApiProtocol
  /** 第三方模型名；官方供应商不使用该字段 */
  model: string
}

export type ProviderSettings = {
  provider: ProviderId
  /** DeepSeek 官方 API Key */
  apiKey: string | null
  custom: CustomProviderSettings
}

export type ResolvedProvider = {
  id: ProviderId
  protocol: ApiProtocol
  /** 当前供应商实际使用的 Key；未填时为空串 */
  apiKey: string
  /** 请求使用的模型名；null 表示沿用应用内置的官方模型 */
  model: string | null
  /** 聊天请求地址 */
  messagesUrl: string
  /** 模型列表地址，用于校验 Key 与拉取可选模型 */
  modelsUrl: string
  /**
   * 是否支持 DeepSeek 专有扩展：联网搜索与阅读链接工具、自动标题、
   * safety_check、latest_reminder 角色、引用与文件上传。
   */
  extended: boolean
  /** Files API 前缀；仅官方支持，其他供应商为 null */
  filesUrl: string | null
  /** 语音识别与合成前缀；仅官方支持，其他供应商为 null */
  toolsUrl: string | null
  /** 地址与 Key 是否已填好，可以校验与拉取模型列表 */
  configured: boolean
  /** 是否已填好全部必填项（自定义供应商还需要模型名），可以直接发起对话请求 */
  ready: boolean
}

const trimBaseUrl = (value: string) => value.trim().replace(/\/+$/, '')

/**
 * 推导聊天与模型列表地址：
 * - 完整地址（…/messages、…/v1/messages、…/chat/completions）直接使用；
 * - 根地址已带 /v1（或 /v2 这类版本段）时只补末段；
 * - 其余按协议补 /v1/…，避免用户漏写版本段。
 */
const resolveUrls = (baseUrl: string, protocol: ApiProtocol) => {
  const base = trimBaseUrl(baseUrl)
  const messageSuffix = protocol === 'anthropic' ? '/messages' : '/chat/completions'
  if (base.endsWith(messageSuffix)) {
    const root = base.slice(0, -messageSuffix.length)
    return { messagesUrl: base, modelsUrl: `${root}/models` }
  }
  if (/\/v\d+[a-z]*$/i.test(base)) {
    return { messagesUrl: `${base}${messageSuffix}`, modelsUrl: `${base}/models` }
  }
  return {
    messagesUrl: `${base}/v1${messageSuffix}`,
    modelsUrl: `${base}/v1/models`,
  }
}

const officialUrls = () => ({
  messagesUrl: `${OFFICIAL_API_ORIGIN}/anthropic/v1/messages`,
  modelsUrl: `${OFFICIAL_API_ORIGIN}/models`,
})

/** 官方供应商：固定地址，支持全部 DeepSeek 扩展能力 */
export const officialProvider = (apiKey: string | null): ResolvedProvider => {
  const configured = Boolean(apiKey)
  return {
    id: 'deepseek',
    protocol: 'anthropic',
    apiKey: apiKey ?? '',
    model: null,
    ...officialUrls(),
    extended: true,
    filesUrl: `${OFFICIAL_API_ORIGIN}/anthropic/v1/files`,
    toolsUrl: `${OFFICIAL_API_ORIGIN}/v1/tools`,
    configured,
    ready: configured,
  }
}

/** 自定义供应商：地址、Key、模型都必需；不启用 DeepSeek 专有能力 */
export const customProvider = (custom: CustomProviderSettings): ResolvedProvider => {
  const baseUrl = trimBaseUrl(custom.baseUrl)
  const urls = baseUrl === '' ? officialUrls() : resolveUrls(baseUrl, custom.protocol)
  const model = custom.model.trim()
  const apiKey = custom.apiKey?.trim() ?? ''
  const configured = baseUrl !== '' && apiKey !== ''
  return {
    id: 'custom',
    protocol: custom.protocol,
    apiKey,
    model: model === '' ? null : model,
    ...urls,
    extended: false,
    filesUrl: null,
    toolsUrl: null,
    configured,
    ready: configured && model !== '',
  }
}

export const resolveProvider = ({ provider, apiKey, custom }: ProviderSettings): ResolvedProvider =>
  provider === 'custom' ? customProvider(custom) : officialProvider(apiKey)

/** 第三方供应商不支持模型列表接口时，用该状态码区分「地址或鉴权错误」与「未实现」 */
export const isMissingEndpointStatus = (status: number | undefined) =>
  status === 404 || status === 405 || status === 501
