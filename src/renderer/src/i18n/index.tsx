import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { zhCN } from './zh-CN'
import { en } from './en'

/**
 * 轻量 i18n：无第三方依赖（项目惯例——运行时依赖克制）。
 *
 * 语言解析优先级：
 *   1. 用户显式选择（localStorage，应用内切换开关写入）
 *   2. 系统语言（navigator.language）——匹配 zh* 用简中，其余用英文
 *   3. 兜底简中（默认语言，见需求）
 *
 * 为什么不用 i18next：只有一个二维语言集（zh-CN / en），200+ 键值，
 * 自带实现 < 100 行且类型全推导（键名写错编译期报错），依赖成本为零。
 */

export type Locale = 'zh-CN' | 'en'

const STORAGE_KEY = 'instadown.locale'

const DICTS = { 'zh-CN': zhCN, en: en } as const

/** 从 localStorage 读取用户显式选择（无选择返回 null = 跟随系统） */
function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'zh-CN' || v === 'en' ? v : null
  } catch {
    return null
  }
}

/** 系统语言 → 支持的 Locale：zh 开头一律简中，其余英文（兜底简中） */
export function systemLocale(): Locale {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN'
  return lang?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function initialLocale(): Locale {
  return storedLocale() ?? systemLocale()
}

export type I18n = {
  locale: Locale
  setLocale: (l: Locale | null) => void
  /** null = 清除显式选择，回到跟随系统 */
  followingSystem: boolean
  t: TFn
}

type DictValue = string | number | ((...args: never[]) => string) | object

export type TFn = {
  (path: string, vars?: Record<string, string | number>): string
  /** 键是否存在（用于动态拼接的键，如 error.${code}） */
  has(path: string): boolean
  // 函数型词条（如 download.parseHint）直接取原始值
  raw<T = DictValue>(path: string): T
}

function resolvePath(dict: unknown, path: string): unknown {
  let cur: unknown = dict
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`))
}

const I18nContext = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  // 「跟随系统」必须是独立状态：它由 localStorage 是否为空决定，而
  // 选中与当前一致的语言时 setLocaleState 不会触发重渲染，若挂在
  // useMemo 里，下拉勾选与圆点会停留在旧状态。
  const [followingSystem, setFollowingSystem] = useState(() => storedLocale() === null)

  // 跟随系统语言变化（仅当用户没有显式选择时）。依赖 followingSystem：
  // 应用内从「显式语言」切回「跟随系统」时监听才会挂上。
  useEffect(() => {
    if (!followingSystem) return
    const onMaybeChange = () => {
      const next = systemLocale()
      setLocaleState((prev) => (prev !== next ? next : prev))
    }
    // Electron 里切系统语言不会派发 languagechange，窗口重聚焦时补偿检测
    window.addEventListener('focus', onMaybeChange)
    window.addEventListener('languagechange', onMaybeChange)
    return () => {
      window.removeEventListener('focus', onMaybeChange)
      window.removeEventListener('languagechange', onMaybeChange)
    }
  }, [followingSystem])

  // <html lang> 同步：影响浏览器内建的字体选择/无障碍朗读；
  // 同时把语言同步给主进程（系统通知/原生对话框文案跟随渲染层）
  useEffect(() => {
    document.documentElement.lang = locale
    syncLocaleSnapshot(locale)
    void window.instadown.setLocale(locale).catch(() => {
      /* 忽略：主进程未就绪时下次切换会补上 */
    })
  }, [locale])

  const setLocale = useCallback((l: Locale | null) => {
    if (l == null) {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* 忽略 */
      }
      setFollowingSystem(true)
      setLocaleState(systemLocale())
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, l)
      } catch {
        /* 忽略 */
      }
      setFollowingSystem(false)
      setLocaleState(l)
    }
  }, [])

  const t = useMemo<TFn>(() => {
    const dict = DICTS[locale]
    const fn = ((path: string, vars?: Record<string, string | number>) => {
      const v = resolvePath(dict, path)
      if (typeof v === 'string') return interpolate(v, vars)
      // 键缺失时回退到简中字典（两字典结构一致性由测试保证；
      // 这里兜底避免运行时白屏）
      const fallback = resolvePath(DICTS['zh-CN'], path)
      if (typeof fallback === 'string') return interpolate(fallback, vars)
      return path
    }) as TFn
    fn.raw = <T,>(path: string): T => resolvePath(dict, path) as T
    fn.has = (path: string): boolean => typeof resolvePath(dict, path) === 'string'
    return fn
  }, [locale])

  const value = useMemo<I18n>(
    () => ({ locale, setLocale, followingSystem, t }),
    [locale, setLocale, followingSystem, t]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>')
  return ctx
}

/**
 * 事件回调里的取词（不能安全调用 hook 的场景，如 subscription 回调）：
 * 直接读当前语言状态。Provider 挂载前调用时兜底返回简中字典值。
 */
export function i18nT(path: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[currentLocaleSnapshot]
  const v = resolvePath(dict, path)
  if (typeof v === 'string') return interpolate(v, vars)
  const fallback = resolvePath(DICTS['zh-CN'], path)
  return typeof fallback === 'string' ? interpolate(fallback, vars) : path
}

/** 当前语言快照：Provider 每次渲染同步，供 i18nT 使用 */
let currentLocaleSnapshot: Locale = initialLocale()
export function syncLocaleSnapshot(l: Locale): void {
  currentLocaleSnapshot = l
}
