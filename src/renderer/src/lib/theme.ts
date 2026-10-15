import { useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/types'
import { useSettingsStore } from '@/stores/settings'

/**
 * 主题应用：把 ThemeMode 解析为实际的 light/dark 并切换 <html class="dark">。
 * - 'light'  → 移除 .dark
 * - 'dark'   → 添加 .dark
 * - 'system' → 跟随 prefers-color-scheme，并监听系统变化实时切换
 */

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  return window.matchMedia(SYSTEM_DARK_QUERY).matches
}

/** 把 ThemeMode 解析为布尔值（'system' 时读取系统偏好） */
export function resolveIsDark(theme: ThemeMode): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return systemPrefersDark()
}

export function useApplyTheme(): void {
  const theme: ThemeMode = useSettingsStore((s) => s.settings?.theme ?? 'light')

  useEffect(() => {
    const root = document.documentElement
    const mql = window.matchMedia(SYSTEM_DARK_QUERY)

    const apply = () => {
      const dark = resolveIsDark(theme)
      root.classList.toggle('dark', dark)
      root.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()

    if (theme !== 'system') return
    // 系统主题变化时实时跟随
    const onChange = () => apply()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme])
}

/**
 * 返回当前是否为深色（响应式：主题设置或系统偏好变化时更新）。
 * 供需要按主题渲染 JS 属性/样式的组件使用（如 sonner Toaster 的 theme 属性）。
 */
export function useIsDark(): boolean {
  const theme: ThemeMode = useSettingsStore((s) => s.settings?.theme ?? 'light')
  const [isDark, setIsDark] = useState(() => resolveIsDark(theme))

  useEffect(() => {
    setIsDark(resolveIsDark(theme))
    if (theme !== 'system') return
    const mql = window.matchMedia(SYSTEM_DARK_QUERY)
    const onChange = () => setIsDark(systemPrefersDark())
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme])

  return isDark
}

/** 供主进程/渲染进程共享的主题颜色常量（窗口控制面板、原生窗口底色） */
export const THEME_COLORS = {
  light: { bg: '#ffffff', symbol: '#52525b' },
  dark: { bg: '#09090b', symbol: '#a1a1aa' }
} as const
