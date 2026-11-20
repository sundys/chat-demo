import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import {
  resolveProvider,
  type ApiProtocol,
  type CustomProviderSettings,
  type ProviderId,
  type ResolvedProvider,
} from './api/provider.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key 与供应商、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  /** DeepSeek 官方 API Key */
  apiKey: string | null
  /** 当前生效的模型供应商 */
  provider: ProviderId
  /** 自定义（第三方）供应商配置 */
  customProvider: CustomProviderSettings
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  provider: 'chat-demo:provider',
  customProvider: 'chat-demo:custom-provider',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

export const DEFAULT_CUSTOM_PROVIDER: CustomProviderSettings = {
  baseUrl: '',
  apiKey: null,
  protocol: 'anthropic',
  model: '',
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 未保存过或内容损坏时使用 DeepSeek 官方供应商 */
const initialProvider = (): ProviderId => (read(KEYS.provider) === 'custom' ? 'custom' : 'deepseek')

const initialCustomProvider = (): CustomProviderSettings => {
  let saved: unknown
  try {
    saved = JSON.parse(read(KEYS.customProvider) ?? 'null')
  } catch {
    return DEFAULT_CUSTOM_PROVIDER
  }
  if (typeof saved !== 'object' || saved === null) {
    return DEFAULT_CUSTOM_PROVIDER
  }
  const value = saved as Partial<Record<keyof CustomProviderSettings, unknown>>
  const protocol: ApiProtocol = value.protocol === 'openai' ? 'openai' : 'anthropic'
  return {
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
    apiKey: typeof value.apiKey === 'string' && value.apiKey !== '' ? value.apiKey : null,
    protocol,
    model: typeof value.model === 'string' ? value.model : '',
  }
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  provider: initialProvider(),
  customProvider: initialCustomProvider(),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setProvider = (provider: ProviderId) => {
  write(KEYS.provider, provider)
  useSettings.setState({ provider })
}

/** 局部更新自定义供应商；空 Key 视为清除 */
export const setCustomProvider = (update: Partial<CustomProviderSettings>) => {
  const customProvider = { ...useSettings.getState().customProvider, ...update }
  write(KEYS.customProvider, JSON.stringify(customProvider))
  useSettings.setState({ customProvider })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

/** 当前生效的供应商配置，包含地址、Key、模型与能力开关 */
export const getActiveProvider = (): ResolvedProvider => {
  const { provider, apiKey, customProvider } = useSettings.getState()
  return resolveProvider({ provider, apiKey, custom: customProvider })
}

/** 当前供应商是否已填好地址与 Key（自定义供应商还要求模型名） */
export const isProviderConfigured = (): boolean => getActiveProvider().ready
