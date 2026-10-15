/**
 * Instagram URL / 用户名分类（渲染进程即时校验 + 主进程预检共用）。
 * Worker 侧的权威实现在 worker/urls.py，两侧规则保持一致。
 */
export type IgUrlKind =
  | 'post'
  | 'reel'
  | 'tv'
  | 'story'
  | 'highlight'
  | 'profile'
  | 'unknown'

export interface IgUrlInfo {
  kind: IgUrlKind
  shortcode?: string
  username?: string
}

const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,32}$/
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/

/** Instagram 域名保留路径段，不能视为用户名 */
const RESERVED = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts',
  'direct', 'about', 'developer', 'legal', 'privacy', 'terms', 'challenge'
])

function stripUrl(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '')
}

function isIgHost(host: string): boolean {
  return /^(?:[a-z0-9-]+\.)*(?:instagram\.com|instagr\.am|ig\.me)$/i.test(host)
}

export function isProbablyIgUrl(raw: string): boolean {
  const s = raw.trim()
  if (/^[A-Za-z0-9._]{1,30}$/.test(s)) return true // 裸用户名
  const m = s.replace(/^https?:\/\//i, '')
  const host = m.split(/[/?#]/)[0] ?? ''
  return isIgHost(host)
}

export function classifyIgUrl(raw: string): IgUrlInfo {
  const s = (raw ?? '').trim()
  if (!s) return { kind: 'unknown' }

  // 裸用户名（支持"用户名搜索"入口）
  if (USERNAME_RE.test(s) && !s.includes('.')) {
    if (!RESERVED.has(s.toLowerCase())) return { kind: 'profile', username: s.toLowerCase() }
    return { kind: 'unknown' }
  }

  let path = s
  if (!s.startsWith('http')) {
    const host = s.split(/[/?#]/)[0] ?? ''
    if (!isIgHost(host)) return { kind: 'unknown' }
    path = stripUrl(s).slice(host.length)
  } else {
    try {
      const u = new URL(s)
      if (!isIgHost(u.hostname)) return { kind: 'unknown' }
      path = u.pathname
    } catch {
      return { kind: 'unknown' }
    }
  }
  path = path.replace(/\/+$/, '')
  const segs = path.split('/').filter(Boolean)
  if (segs.length === 0) return { kind: 'unknown' }

  const [first, second, third] = segs

  if ((first === 'p' || first === 'tv') && second && SHORTCODE_RE.test(second)) {
    return { kind: first === 'tv' ? 'tv' : 'post', shortcode: second }
  }
  if ((first === 'reel' || first === 'reels') && second && SHORTCODE_RE.test(second)) {
    return { kind: 'reel', shortcode: second }
  }
  if (first === 'stories' && second === 'highlights' && third) {
    return { kind: 'highlight', username: third }
  }
  if (first === 'stories' && second && USERNAME_RE.test(second)) {
    return { kind: 'story', username: second.toLowerCase() }
  }
  if (segs.length === 1 && USERNAME_RE.test(first) && !RESERVED.has(first.toLowerCase())) {
    return { kind: 'profile', username: first.toLowerCase() }
  }
  if (segs.length >= 1 && segs.length <= 2 && USERNAME_RE.test(first) && !RESERVED.has(first.toLowerCase())) {
    return { kind: 'profile', username: first.toLowerCase() }
  }
  return { kind: 'unknown' }
}
