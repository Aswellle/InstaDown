import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings } from '@shared/types'
import type { Repos } from '../db/repos'

/** 设置存储（SQLite）+ 会话 Cookie（safeStorage 加密，仅本地，docs/11） */

const DEFAULTS: AppSettings = {
  downloadDir: '', // 启动时按 Pictures/InstaVault 计算
  concurrency: 3,
  autoClipboard: true,
  theme: 'light', // 默认浅色（用户可在设置中改为深色/跟随系统）
  anonymousFirst: true, // 无登录优先：公开内容一律匿名获取（账号安全最高优先）
  warnAccountUse: true, // 经由账号的功能执行前提醒风险
  autoCacheImages: true // 自动缓存浏览过的图片，防 CDN 链接过期
}

export class SettingsService {
  private cookieFile: string

  constructor(private repos: Repos) {
    this.cookieFile = join(app.getPath('userData'), 'session.bin')
    if (!this.get().downloadDir) {
      const pictures = safePicturesDir()
      this.repos.setSetting('downloadDir', join(pictures, 'InstaVault'))
    }
  }

  get(): AppSettings {
    const theme = this.repos.getSetting('theme')
    return {
      downloadDir: this.repos.getSetting('downloadDir') ?? DEFAULTS.downloadDir,
      concurrency: clampInt(this.repos.getSetting('concurrency'), 1, 6, DEFAULTS.concurrency),
      autoClipboard: (this.repos.getSetting('autoClipboard') ?? 'true') === 'true',
      theme: theme === 'dark' || theme === 'system' || theme === 'light' ? theme : DEFAULTS.theme,
      anonymousFirst: (this.repos.getSetting('anonymousFirst') ?? 'true') === 'true',
      warnAccountUse: (this.repos.getSetting('warnAccountUse') ?? 'true') === 'true',
      autoCacheImages: (this.repos.getSetting('autoCacheImages') ?? 'true') === 'true'
    }
  }

  set(patch: Partial<AppSettings>): AppSettings {
    if (patch.downloadDir) this.repos.setSetting('downloadDir', patch.downloadDir)
    if (patch.concurrency != null)
      this.repos.setSetting('concurrency', String(clampInt(patch.concurrency, 1, 6, DEFAULTS.concurrency)))
    if (patch.autoClipboard != null) this.repos.setSetting('autoClipboard', String(patch.autoClipboard))
    if (patch.theme === 'light' || patch.theme === 'dark' || patch.theme === 'system')
      this.repos.setSetting('theme', patch.theme)
    if (patch.anonymousFirst != null)
      this.repos.setSetting('anonymousFirst', String(patch.anonymousFirst))
    if (patch.warnAccountUse != null)
      this.repos.setSetting('warnAccountUse', String(patch.warnAccountUse))
    if (patch.autoCacheImages != null)
      this.repos.setSetting('autoCacheImages', String(patch.autoCacheImages))
    return this.get()
  }

  // ------------------------------------------------------------ profile
  /** 已登录 IG 账号资料（仅本地，供 UI 展示） */
  getProfile(): { username: string; avatar: string } | null {
    const raw = this.repos.getSetting('igProfile')
    if (!raw) return null
    try {
      const p = JSON.parse(raw) as { username?: string; avatar?: string }
      return { username: p.username ?? '', avatar: p.avatar ?? '' }
    } catch {
      return null
    }
  }

  setProfile(p: { username: string; avatar: string } | null): void {
    if (!p) {
      this.repos.setSetting('igProfile', '')
      return
    }
    this.repos.setSetting('igProfile', JSON.stringify(p))
  }

  // ------------------------------------------------------------ session
  /** 是否已有可用会话。注意不能只看文件存在：退出登录时会写入空内容。 */
  hasSession(): boolean {
    const s = this.getSession()
    return !!s && s.length > 0
  }

  getSession(): string | null {
    try {
      if (!existsSync(this.cookieFile)) return null
      const buf = readFileSync(this.cookieFile)
      if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf)
      return buf.toString('utf8')
    } catch {
      return null
    }
  }

  setSession(value: string | null): void {
    if (!value) {
      if (existsSync(this.cookieFile)) {
        writeFileSync(this.cookieFile, '')
      }
      return
    }
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(value)
      : Buffer.from(value, 'utf8')
    writeFileSync(this.cookieFile, data)
  }
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, Math.round(n)))
}

function safePicturesDir(): string {
  try {
    const p = app.getPath('pictures')
    if (p) return p
  } catch {
    /* 无 Pictures 目录时回退 */
  }
  try {
    return join(app.getPath('documents'), 'Pictures')
  } catch {
    return app.getPath('home')
  }
}
