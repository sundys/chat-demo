import clsx from 'clsx'
import type { ReactNode } from 'react'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import styles from './Settings.module.css'

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
export type SettingStatus =
  | (TranslationMessage & { error?: boolean; reason?: TranslationKey })
  | null

/** 设置项：左侧标题与说明，右侧操作控件 */
export const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: SettingStatus
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}
