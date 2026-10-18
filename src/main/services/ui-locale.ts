import { app } from 'electron'
import type { Locale } from '@shared/types'

/**
 * 主进程侧的界面语言（用于原生对话框 / 系统通知等非渲染层文案）。
 *
 * 渲染层是语言的唯一所有者：它在切换时通过 `window:setLocale` 把结果
 * 推过来。未收到之前按系统语言兜底 —— 但 `app.getLocale()` 在
 * app ready 之前返回空串，所以兜底必须惰性求值，不能在 registerIpc
 * 里一次性算好（那会让兜底值恒为英文）。
 */
let override: Locale | null = null

export function setUiLocale(locale: Locale): void {
  override = locale
}

export function uiLocale(): Locale {
  if (override) return override
  return /^zh/i.test(app.getLocale() || '') ? 'zh-CN' : 'en'
}
