/**
 * 纯格式化工具（无 DOM / 无 Electron 依赖）。
 * 放在 shared 下以便主进程、渲染进程与测试共用。
 */

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return ''
  return `${formatBytes(bps)}/s`
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n ?? 0)
}

/**
 * 格式化日期。自动识别时间戳单位：
 * - >= 1e12 视为毫秒（如 Date.now()，本应用的 created_at）
 * - 否则视为秒（如 Instagram 的 taken_at）
 * 历史上这里一律按秒处理，导致毫秒时间戳显示成 58756-02-08。
 */
export function formatDate(ts: number | null | undefined): string {
  if (!ts) return ''
  const ms = ts >= 1e12 ? ts : ts * 1000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
