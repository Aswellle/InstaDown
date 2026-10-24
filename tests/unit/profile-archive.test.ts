import { describe, expect, it } from 'vitest'
import {
  ProfileArchive,
  encodeDomCursor,
  parseDomCursor,
  type DomProfileSource,
  type WorkerSource
} from '../../src/main/services/profile-archive'
import type { Repos } from '../../src/main/db/repos'
import type { MediaCollection, MediaItem, ProfileUser } from '../../src/shared/types'

/** DOM 路径分页契约：cursor 采用 "dom:<page>" 前缀，与 IG 原生 max_id 隔离 */

function fakeItem(id: string): MediaItem {
  return {
    id,
    type: 'image',
    url: `https://cdn.example/${id}.jpg`,
    thumb_url: null,
    width: 100,
    height: 100,
    duration: null,
    taken_at: 1_700_000_000
  }
}

function makeUser(username: string): ProfileUser {
  return {
    user_id: '1',
    username,
    full_name: 'Example',
    avatar: 'https://cdn.example/a.jpg',
    followers: 1,
    posts: 1,
    is_private: false,
    is_verified: false
  }
}

interface Opts {
  shortcodes?: string[]
  domOk?: boolean
  userFails?: boolean
  failShortcodes?: string[]
  browserUser?: Partial<ProfileUser> | null
}

function makeDeps(opts: Opts = {}) {
  const shortcodes =
    opts.shortcodes ?? Array.from({ length: 25 }, (_, i) => `sc${String(i).padStart(2, '0')}`)
  const upserted: MediaCollection['items'] = []
  const listCalls: Array<{ username: string; rounds: number }> = []

  const dom: DomProfileSource & { listCalls: typeof listCalls } = {
    listCalls,
    async listProfileShortcodes(username, rounds) {
      listCalls.push({ username, rounds })
      if (opts.domOk === false) return { ok: false, shortcodes: [], error: 'load failed' }
      return { ok: true, shortcodes }
    },
    async fetchProfileInBrowser() {
      return opts.browserUser ?? null
    }
  }

  const worker: WorkerSource = {
    async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      if (method === 'get_user') {
        if (opts.userFails) throw new Error('worker get_user failed')
        return { user: makeUser(String(params?.username)) } as T
      }
      if (method === 'resolve_post') {
        const sc = String(params?.shortcode)
        if (opts.failShortcodes?.includes(sc)) throw new Error('resolve failed')
        return { items: [fakeItem(sc)], author: { username: 'x' }, source: { kind: 'post', shortcode: sc } } as T
      }
      throw new Error(`unexpected method: ${method}`)
    }
  }

  const repos = {
    upsertMedia: (m: MediaCollection['items'][number]) => upserted.push(m)
  } as unknown as Repos

  return { dom, worker, repos, upserted }
}

describe('parseDomCursor / encodeDomCursor', () => {
  it('解析 dom: 前缀页码', () => {
    expect(parseDomCursor('dom:3')).toBe(3)
    expect(parseDomCursor('dom:0')).toBe(0)
  })

  it('空值与非法格式（含 IG 原生 max_id）回到第 0 页', () => {
    expect(parseDomCursor(undefined)).toBe(0)
    expect(parseDomCursor(null)).toBe(0)
    expect(parseDomCursor('')).toBe(0)
    expect(parseDomCursor('34123_51')).toBe(0)
    expect(parseDomCursor('dom:x')).toBe(0)
  })

  it('编码往返', () => {
    expect(encodeDomCursor(4)).toBe('dom:4')
    expect(parseDomCursor(encodeDomCursor(12))).toBe(12)
  })
})

describe('ProfileArchive.getProfileMedia', () => {
  it('首页：取前 10 条，还有更多时返回 dom:1 游标', async () => {
    const d = makeDeps()
    const arc = new ProfileArchive(d.worker, d.repos, d.dom)
    const r = await arc.getProfileMedia('alice')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items).toHaveLength(10)
    expect(r.items[0].id).toBe('sc00')
    expect(r.nextCursor).toBe('dom:1')
    // 第 0 页不额外滚动
    expect(d.dom.listCalls[0].rounds).toBe(0)
  })

  it('第二页：切片 11-20，滚动深度随页数增长', async () => {
    const d = makeDeps()
    const arc = new ProfileArchive(d.worker, d.repos, d.dom)
    const r = await arc.getProfileMedia('alice', 'dom:1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items[0].id).toBe('sc10')
    expect(r.items).toHaveLength(10)
    expect(r.nextCursor).toBe('dom:2')
    expect(d.dom.listCalls[0].rounds).toBe(2)
  })

  it('恰好取尽时游标为 null（不再出现加载更多）', async () => {
    const d = makeDeps({ shortcodes: Array.from({ length: 20 }, (_, i) => `s${i}`) })
    const arc = new ProfileArchive(d.worker, d.repos, d.dom)
    const r = await arc.getProfileMedia('alice', 'dom:1')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items[0].id).toBe('s10')
    expect(r.nextCursor).toBeNull()
  })

  it('越界页返回 not-found 而非重放第 0 页', async () => {
    const d = makeDeps()
    const arc = new ProfileArchive(d.worker, d.repos, d.dom)
    const r = await arc.getProfileMedia('alice', 'dom:5')
    expect(r).toEqual({ ok: false, reason: 'not-found' })
  })

  it('DOM 列表失败返回 load-failed', async () => {
    const d = makeDeps({ domOk: false })
    const arc = new ProfileArchive(d.worker, d.repos, d.dom)
    const r = await arc.getProfileMedia('alice')
    expect(r).toEqual({ ok: false, reason: 'load-failed' })
  })

  it('单帖解析失败只跳过该帖', async () => {
    const d = makeDeps({ failShortcodes: ['sc02'] })
    const arc = new ProfileArchive(d.worker, d.repos, d.dom)
    const r = await arc.getProfileMedia('alice')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.items).toHaveLength(9)
    expect(d.upserted).toHaveLength(9)
  })

  it('整页全部解析失败返回 load-failed', async () => {
    const d = makeDeps({ failShortcodes: Array.from({ length: 25 }, (_, i) => `sc${String(i).padStart(2, '0')}`) })
    const arc = new ProfileArchive(d.worker, d.repos, d.dom)
    const r = await arc.getProfileMedia('alice')
    expect(r).toEqual({ ok: false, reason: 'load-failed' })
  })

  it('worker 资料失败且为空时用浏览器兜底合并字段', async () => {
    const d = makeDeps({
      userFails: true,
      browserUser: { full_name: 'From Browser', avatar: 'https://cdn.example/b.jpg' }
    })
    const arc = new ProfileArchive(d.worker, d.repos, d.dom)
    const r = await arc.getProfileMedia('alice')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.user.full_name).toBe('From Browser')
    expect(r.user.username).toBe('alice')
  })
})
