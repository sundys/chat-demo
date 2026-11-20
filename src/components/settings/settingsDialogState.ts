import { create } from 'zustand'
import { isProviderConfigured } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 模型供应商 / 数据管理 */
export type SettingsSection = 'general' | 'provider' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 当前供应商还没有配好时打开设置并选中「模型供应商」，返回是否已可用 */
export const ensureApiKey = () => {
  if (isProviderConfigured()) {
    return true
  }
  openSettings('provider')
  return false
}
