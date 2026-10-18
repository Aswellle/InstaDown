import type { AppErrorCode } from '@shared/types'
import { i18nT } from '@/i18n'

/**
 * 错误码 → 当前语言文案。
 *
 * 文案只在渲染层解析：主进程 / worker 只传 `AppErrorCode`，不携带
 * 用户可见的自然语言，避免同一条错误在中英文界面下显示成固定中文。
 * 缺键时回退到调用方给的原始消息，再回退到网络错误文案。
 */
export function appErrorText(code: AppErrorCode, fallback?: string): string {
  const key = `error.${code}`
  const text = i18nT(key)
  if (text !== key) return text
  return fallback || i18nT('error.E_NETWORK')
}

/**
 * 携带错误码的异常：store 抛出时还不知道当前语言（且不应该知道），
 * 由渲染层的 toast 处按当时的语言翻译。
 */
export class AppErrorException extends Error {
  readonly code: AppErrorCode

  constructor(code: AppErrorCode, fallback?: string) {
    super(fallback || code)
    this.name = 'AppErrorException'
    this.code = code
  }
}

/** 统一的异常取文案：带错误码的翻译，其余原样取 message */
export function errorMessage(e: unknown): string {
  if (e instanceof AppErrorException) return appErrorText(e.code, e.message)
  return (e as Error)?.message ?? String(e)
}
