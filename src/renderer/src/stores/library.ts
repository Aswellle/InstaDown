import { create } from 'zustand'
import type { MediaCollection, MediaItem, ProfileUser, AppError } from '@shared/types'
import { classifyIgUrl } from '@shared/ig-url'
import { AppErrorException } from '@/lib/app-error'
import type { MessageKey } from '@/i18n/zh-CN'

export interface ProfilePage {
  user: ProfileUser
  items: MediaItem[]
  cursor: string | null
  loadingMore: boolean
}

export type LibraryView =
  | { mode: 'empty' }
  | { mode: 'loading'; hint: MessageKey }
  | { mode: 'post'; collection: MediaCollection }
  | { mode: 'profile'; page: ProfilePage }
  | { mode: 'error'; error: AppError; canRetry: boolean; lastInput?: string }

interface LibraryState {
  view: LibraryView
  selected: Set<string>
  order: string[]
  lastToggled: string | null
  /** Stories 等必须经由账号的功能：解析前的风险确认（含待解析输入） */
  accountConfirm: { input: string; kind: 'story' | 'highlight' } | null
  parse: (input: string) => Promise<void>
  /** 确认经由账号访问后继续 */
  confirmAccountUse: () => Promise<void>
  cancelAccountUse: () => void
  /** 实际执行解析（风险确认通过后的公共路径） */
  doParse: (url: string) => Promise<void>
  loadProfilePage: (username: string, cursor?: string) => Promise<void>
  loadMore: () => Promise<void>
  toggle: (id: string, opts?: { ctrl?: boolean; shift?: boolean }) => void
  selectAll: () => void
  clearSelection: () => void
  /** 回到主页（清空解析结果与选择） */
  goHome: () => void
  reset: () => void
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  view: { mode: 'empty' },
  selected: new Set(),
  order: [],
  lastToggled: null,
  accountConfirm: null,

  parse: async (input) => {
    const url = input.trim()
    if (!url) return
    // Stories / Highlights 只能经由登录账号查看（IG 官方机制），且自动化
    // 访问会对账号产生风控暴露 —— 设置开启提醒时，先征得用户确认再继续。
    const info = classifyIgUrl(url)
    if (info.kind === 'story' || info.kind === 'highlight') {
      try {
        const s = await window.instadown.getSettings()
        if (s.warnAccountUse) {
          set({ accountConfirm: { input: url, kind: info.kind } })
          return
        }
      } catch {
        /* 设置读取失败：按不提醒处理，继续原流程 */
      }
    }
    await get().doParse(url)
  },

  confirmAccountUse: async () => {
    const pending = get().accountConfirm
    if (!pending) return
    set({ accountConfirm: null })
    await get().doParse(pending.input)
  },

  cancelAccountUse: () => set({ accountConfirm: null }),

  doParse: async (url) => {
    set({
      view: { mode: 'loading', hint: 'home.parsing' },
      selected: new Set(),
      order: [],
      lastToggled: null
    })
    const res = await window.instadown.parseUrl(url)
    if ('error' in res) {
      set({ view: { mode: 'error', error: res.error, canRetry: true, lastInput: url } })
      return
    }
    if (res.kind === 'collection') {
      set({ view: { mode: 'post', collection: res.collection } })
    } else {
      set({
        view: {
          mode: 'profile',
          page: { user: res.user, items: [], cursor: null, loadingMore: true }
        }
      })
      await get().loadProfilePage(res.user.username)
    }
  },

  loadProfilePage: async (username, cursor) => {
    const res = await window.instadown.getUserMedia(username, cursor)
    if ('error' in res) {
      const prev = get().view
      const keepItems = prev.mode === 'profile' ? prev.page.items : []
      if (keepItems.length > 0) {
        // 追加失败：保留已加载内容并向上抛出提示。
        // cursor 必须原样保留 —— 置 null 会让"再加载"按钮消失，
        // 一次瞬时网络错误就永久终止该主页的分页浏览。
        set({
          view: {
            mode: 'profile',
            page: { ...(prev as { page: ProfilePage }).page, loadingMore: false }
          }
        })
        // 只带错误码，文案由渲染层按当前语言解析（store 不该持有文案）
        throw new AppErrorException(res.error.code, res.error.message)
      }
      set({ view: { mode: 'error', error: res.error, canRetry: true, lastInput: username } })
      return
    }
    const view = get().view
    const prevItems = view.mode === 'profile' ? view.page.items : []
    const seen = new Set(prevItems.map((i) => i.id))
    const merged = [...prevItems, ...res.items.filter((i) => !seen.has(i.id))]
    set({
      view: {
        mode: 'profile',
        page: {
          user: res.user,
          items: merged,
          cursor: res.nextCursor ?? null,
          loadingMore: false
        }
      }
    })
  },

  loadMore: async () => {
    const view = get().view
    if (view.mode !== 'profile' || !view.page.cursor || view.page.loadingMore) return
    const { user, cursor } = view.page
    set((s) =>
      s.view.mode === 'profile'
        ? { view: { mode: 'profile', page: { ...s.view.page, loadingMore: true } } }
        : {}
    )
    try {
      await get().loadProfilePage(user.username, cursor ?? undefined)
    } catch (e) {
      set((s) =>
        s.view.mode === 'profile'
          ? { view: { mode: 'profile', page: { ...s.view.page, loadingMore: false } } }
          : {}
      )
      throw e
    }
  },

  toggle: (id, opts) => {
    const { selected, order, lastToggled, view } = get()
    const items = currentItems(view)
    if (!items.length) return
    const next = new Set(selected)
    if (opts?.shift && lastToggled && next.has(lastToggled)) {
      const a = order.indexOf(lastToggled)
      const b = order.indexOf(id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        for (let i = lo; i <= hi; i++) next.add(items[i].id)
        set({ selected: next, lastToggled: id })
        return
      }
    }
    if (next.has(id) && !opts?.ctrl) {
      next.delete(id)
    } else {
      next.add(id)
    }
    set({ selected: next, order: items.map((i) => i.id), lastToggled: id })
  },

  selectAll: () => {
    const items = currentItems(get().view)
    set({ selected: new Set(items.map((i) => i.id)), order: items.map((i) => i.id) })
  },

  clearSelection: () => set({ selected: new Set(), lastToggled: null }),

  goHome: () =>
    set({ view: { mode: 'empty' }, selected: new Set(), order: [], lastToggled: null }),

  reset: () =>
    set({ view: { mode: 'empty' }, selected: new Set(), order: [], lastToggled: null })
}))

export function currentItems(view: LibraryView): MediaItem[] {
  if (view.mode === 'post') return view.collection.items
  if (view.mode === 'profile') return view.page.items
  return []
}
