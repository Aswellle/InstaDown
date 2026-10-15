/**
 * 主题色常量：窗口底色 + Windows 窗口控制按钮（WCO）符号色。
 *
 * 主进程（原生窗口外观：setBackgroundColor / setTitleBarOverlay）与渲染进程
 * 共用同一份，避免两侧漂移 —— 历史上只改渲染层不改原生层时出现过
 * "界面已黑、窗口控制区仍白"的不同步。
 */
export const THEME_COLORS = {
  light: { bg: '#ffffff', symbol: '#52525b' },
  dark: { bg: '#09090b', symbol: '#a1a1aa' }
} as const

export function themeColorsFor(dark: boolean): { bg: string; symbol: string } {
  return dark ? THEME_COLORS.dark : THEME_COLORS.light
}
