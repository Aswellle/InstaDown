import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 本地文件管理（docs/10）：{root}/{username}/{YYYY-MM-DD}/{images|videos}/{name.ext}
 *  纯 Node 实现，不依赖 Electron，便于单元测试。 */

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g

/** Windows 保留设备名（CON/NUL/COM1-9/LPT1-9…）：作为目录名或去掉
 *  扩展名的文件名时，大量 Win32 API 拒绝或行为异常。命中时加后缀规避。 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  const safe = WINDOWS_RESERVED.test(cleaned) ? `${cleaned}_` : cleaned
  return (safe || 'file').slice(0, 120)
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function dateFolder(ts: number): string {
  // IG taken_at 是秒级时间戳；< 1e12 视为秒并转换为毫秒
  const ms = ts && ts < 1e12 ? ts * 1000 : ts || Date.now()
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 规划最终文件路径；重名自动追加 -2、-3…（docs/10 重名处理） */
export function planPath(opts: {
  root: string
  author: string
  takenAt?: number | null
  type: 'image' | 'video'
  base: string
  ext: string
}): string {
  const kindDir = opts.type === 'video' ? 'videos' : 'images'
  const dir = join(
    opts.root,
    sanitizeFilename(opts.author) || 'unknown',
    dateFolder(opts.takenAt ?? Date.now()),
    kindDir
  )
  ensureDir(dir)
  const ext = opts.ext.replace(/^\./, '')
  let candidate = `${sanitizeFilename(opts.base)}.${ext}`
  let n = 1
  while (existsSync(join(dir, candidate))) {
    n += 1
    candidate = `${sanitizeFilename(opts.base)}-${n}.${ext}`
  }
  return join(dir, candidate)
}

export function extFromUrl(url: string, type: 'image' | 'video'): string {
  const m = /\.(jpe?g|png|webp|heic|mp4|mov|m4v)(?:\?|$)/i.exec(url)
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg')
  return type === 'video' ? 'mp4' : 'jpg'
}
