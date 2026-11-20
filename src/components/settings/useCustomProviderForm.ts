import { useState } from 'react'
import { ApiError, listModels, verifyProvider } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import { customProvider, type ApiProtocol } from '../../services/api/provider.js'
import { setCustomProvider, setProvider, useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'

export type CustomProviderStatus = { tone: 'error' | 'success' | 'hint'; text: string } | null

const messageOf = (t: ReturnType<typeof useTranslate>, error: unknown) =>
  error instanceof ApiError && error.localMessage
    ? t(error.localMessage.key, error.localMessage.params)
    : error instanceof Error
      ? error.message
      : String(error)

/**
 * 自定义供应商表单：地址、Key、协议与模型名。
 * 保存前用 GET /models 校验；供应商没有该接口时仍保存，只提示未能校验。
 */
export const useCustomProviderForm = () => {
  const t = useTranslate()
  const saved = useSettings((state) => state.customProvider)
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl)
  const [apiKey, setApiKey] = useState(saved.apiKey ?? '')
  const [protocol, setProtocol] = useState<ApiProtocol>(saved.protocol)
  const [model, setModel] = useState(saved.model)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState<'save' | 'models' | null>(null)
  const [status, setStatus] = useState<CustomProviderStatus>(null)

  /** 表单当前值对应的配置；模型可以为空，仅用于取模型列表与校验 */
  const draft = () => customProvider({ baseUrl, apiKey, protocol, model })

  const fetchModels = async () => {
    const provider = draft()
    if (!provider.configured) {
      setStatus({ tone: 'error', text: t('providerIncomplete') })
      return
    }
    setBusy('models')
    setStatus(null)
    try {
      const ids = await listModels(provider)
      setModels(ids)
      setStatus({ tone: 'success', text: t('providerModelsLoaded', { count: ids.length }) })
    } catch (error) {
      setModels([])
      // 地址不可达或供应商不允许跨域时浏览器只会给出 Failed to fetch，给出可操作的提示
      setStatus({
        tone: 'error',
        text:
          classifyApiError(error) === 'network'
            ? t('providerRequestBlocked')
            : t('providerFetchModelsFailed', { message: messageOf(t, error) }),
      })
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    const provider = draft()
    if (!provider.configured) {
      setStatus({ tone: 'error', text: t('providerIncomplete') })
      return
    }
    if (!provider.ready) {
      setStatus({ tone: 'error', text: t('providerModelMissing') })
      return
    }
    setBusy('save')
    setStatus(null)
    try {
      const { verified } = await verifyProvider(provider)
      setCustomProvider({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        protocol,
        model: model.trim(),
      })
      setProvider('custom')
      setStatus({
        tone: verified ? 'success' : 'hint',
        text: t(verified ? 'providerSaved' : 'providerSavedUnverified'),
      })
    } catch (error) {
      const condition = classifyApiError(error)
      setStatus({
        tone: 'error',
        text:
          condition === 'unauthorized'
            ? t('apiKeyInvalid')
            : condition === 'network'
              ? t('providerRequestBlocked')
              : t('apiKeyVerificationFailed', { message: messageOf(t, error) }),
      })
    } finally {
      setBusy(null)
    }
  }

  return {
    baseUrl,
    setBaseUrl,
    apiKey,
    setApiKey,
    protocol,
    setProtocol,
    model,
    setModel,
    models,
    busy,
    status,
    fetchModels,
    save,
  }
}
