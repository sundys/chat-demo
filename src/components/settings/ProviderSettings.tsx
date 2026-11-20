import clsx from 'clsx'
import { useSettings, setProvider } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import { useIsMobile } from '../../app/viewport.js'
import { Select } from '../base/Select.js'
import { ApiKeyConfirm, ApiKeyField, type ApiKeyEditor } from './ApiKeyField.js'
import { SettingCell } from './SettingCell.js'
import { useCustomProviderForm } from './useCustomProviderForm.js'
import styles from './Settings.module.css'

const MODEL_LIST_ID = 'custom-provider-model-options'

/**
 * 模型供应商：默认 DeepSeek 官方（固定地址），也可接入第三方兼容接口。
 * 选中官方时填 API Key；选中自定义时填协议、地址、Key 与模型名。
 */
export const ProviderSettings = ({ editor }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const provider = useSettings((state) => state.provider)
  return (
    <>
      <SettingCell
        label={t('settingsProvider')}
        description={t('settingsProviderDescription')}
        status={null}
        action={
          <Select
            ariaLabel={t('settingsProvider')}
            value={provider}
            options={[
              { value: 'deepseek', label: t('settingsProviderDeepseek') },
              { value: 'custom', label: t('settingsProviderCustom') },
            ]}
            onChange={setProvider}
          />
        }
      />
      {provider === 'deepseek' ? (
        <>
          <ApiKeyField editor={editor} />
          {isMobile ? <ApiKeyConfirm editor={editor} /> : null}
        </>
      ) : (
        <CustomProviderFields />
      )}
    </>
  )
}

/** 第三方供应商表单：保存前校验地址与 Key，模型名可从拉取的列表中选择或手填。 */
const CustomProviderFields = () => {
  const t = useTranslate()
  const form = useCustomProviderForm()
  const busy = form.busy !== null
  return (
    <div className={styles.cell}>
      <div className={styles.providerForm}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('settingsProviderProtocol')}</span>
          <Select
            ariaLabel={t('settingsProviderProtocol')}
            value={form.protocol}
            options={[
              { value: 'anthropic', label: t('settingsProviderProtocolAnthropic') },
              { value: 'openai', label: t('settingsProviderProtocolOpenai') },
            ]}
            onChange={form.setProtocol}
          />
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('settingsProviderBaseUrl')}</span>
          <input
            className={styles.fieldInput}
            type="url"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            placeholder={t('settingsProviderBaseUrlPlaceholder')}
            value={form.baseUrl}
            onChange={(event) => form.setBaseUrl(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('settingsProviderApiKey')}</span>
          <input
            className={styles.fieldInput}
            type="password"
            spellCheck={false}
            autoComplete="off"
            placeholder={t('settingsProviderApiKeyPlaceholder')}
            value={form.apiKey}
            onChange={(event) => form.setApiKey(event.target.value)}
          />
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('settingsProviderModel')}</span>
          <div className={styles.fieldControl}>
            <input
              className={styles.fieldInput}
              type="text"
              spellCheck={false}
              autoComplete="off"
              list={MODEL_LIST_ID}
              placeholder={t('settingsProviderModelPlaceholder')}
              value={form.model}
              onChange={(event) => form.setModel(event.target.value)}
            />
            <datalist id={MODEL_LIST_ID}>
              {form.models.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            <button
              type="button"
              className={styles.fieldAction}
              disabled={busy}
              onClick={() => void form.fetchModels()}
            >
              {form.busy === 'models' ? t('providerFetchingModels') : t('providerFetchModels')}
            </button>
          </div>
        </div>
        {form.status ? (
          <div
            className={clsx(
              form.status.tone === 'error' ? styles.error : styles.description,
              form.status.tone === 'success' && styles.providerSuccess
            )}
          >
            {form.status.text}
          </div>
        ) : null}
        <button
          type="button"
          className={styles.providerSave}
          disabled={busy}
          onClick={() => void form.save()}
        >
          {form.busy === 'save' ? t('providerSaving') : t('providerSave')}
        </button>
        <div className={styles.description}>{t('settingsProviderCorsHint')}</div>
      </div>
    </div>
  )
}
