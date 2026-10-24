import type { MediaCollection, ProfileUser } from '@shared/types'
import type { Repos } from '../db/repos'
import { mediaRowsFromItems } from './media-rows'

/**
 * 主页归档服务（原 ipc.ts 内联的 profileMediaViaDom 下沉而来）。
 *
 * 路径：从已登录浏览器渲染出的主页提取 shortcode（IG 已对网页端关闭
 * feed 端点），再逐个走公开 embed 解析拿原始媒体。
 *
 * cursor 采用 "dom:<page>" 前缀格式，与 IG 原生 max_id（形如 "34123_51"）
 * 的地址空间显式隔离 —— 两种格式混入 parseInt 会得到 NaN→0，
 * 造成静默重放第 0 页（重复条目/重复下载）。
 */

const PER_PAGE = 10
const CURSOR_PREFIX = 'dom:'

/** DOM 抓取能力的最小接口（ig-login.ts 提供；测试注入假实现） */
export interface DomProfileSource {
  listProfileShortcodes(
    username: string,
    scrollRounds: number
  ): Promise<{ ok: boolean; shortcodes: string[]; error?: string }>
  fetchProfileInBrowser(username: string): Promise<Partial<ProfileUser> | null>
}

/** worker 调用的最小接口（WorkerManager 满足；测试注入假实现） */
export interface WorkerSource {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
}

export type ProfileMediaResult =
  | { ok: true; user: ProfileUser; items: MediaCollection['items']; nextCursor: string | null }
  | { ok: false; reason: 'not-logged-in' | 'not-found' | 'load-failed' }

export function encodeDomCursor(page: number): string {
  return `${CURSOR_PREFIX}${page}`
}

/** "dom:3" → 3；空/缺失 → 0；任何其它格式（如 IG 原生 max_id）→ 0 */
export function parseDomCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0
  const m = /^dom:(\d+)$/.exec(cursor)
  return m ? parseInt(m[1], 10) : 0
}

export class ProfileArchive {
  constructor(
    private worker: WorkerSource,
    private repos: Repos,
    private dom: DomProfileSource
  ) {}

  async getProfileMedia(
    username: string,
    cursor?: string | null
  ): Promise<ProfileMediaResult> {
    const page = parseDomCursor(cursor)
    const listed = await this.dom.listProfileShortcodes(username, page * 2)
    if (!listed.ok || listed.shortcodes.length === 0) return { ok: false, reason: 'load-failed' }

    const slice = listed.shortcodes.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
    if (slice.length === 0) return { ok: false, reason: 'not-found' }

    const user = await this.resolveUser(username, listed.shortcodes.length)

    // 逐个解析（公开 embed 路径）。worker 是单进程串行 + 内置 1.5s 限流，
    // 并发发起不会更快，因此按序请求；单帖失败不影响整页。
    const items: MediaCollection['items'] = []
    for (const shortcode of slice) {
      try {
        const r = await this.worker.call<MediaCollection>('resolve_post', { shortcode })
        for (const m of r.items) items.push(m)
        for (const row of mediaRowsFromItems(r.items, { author: username, shortcode })) {
          this.repos.upsertMedia(row)
        }
      } catch {
        /* 单帖失败跳过 */
      }
    }
    if (items.length === 0) return { ok: false, reason: 'load-failed' }

    const hasMore = listed.shortcodes.length > (page + 1) * PER_PAGE
    return { ok: true, user, items, nextCursor: hasMore ? encodeDomCursor(page + 1) : null }
  }

  /** 用户资料：优先 worker（Python 公开页面），失败或字段为空时回退到
   *  已登录浏览器（IG 会对 Python 指纹返回空壳页，浏览器路径更稳）。 */
  private async resolveUser(username: string, posts: number): Promise<ProfileUser> {
    let user: ProfileUser
    try {
      const r = await this.worker.call<{ user: ProfileUser }>('get_user', { username })
      user = r.user
    } catch {
      user = {
        user_id: '',
        username,
        full_name: '',
        avatar: '',
        followers: 0,
        posts,
        is_private: false,
        is_verified: false
      }
    }
    if (!user.full_name && !user.avatar) {
      const browserUser = await this.dom.fetchProfileInBrowser(username).catch(() => null)
      if (browserUser) {
        user = { ...user, ...browserUser, posts: user.posts || browserUser.posts || 0 }
      }
    }
    return user
  }
}
