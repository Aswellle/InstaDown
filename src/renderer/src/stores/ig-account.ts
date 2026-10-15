import { create } from 'zustand'

/**
 * Instagram 账号登录状态（供顶栏/设置展示头像与用户名）。
 * 数据来自主进程的 igLoginStatus（profile 持久化在 SQLite）。
 */
export interface IgProfile {
  username: string
  avatar: string
}

interface IgAccountState {
  loggedIn: boolean
  profile: IgProfile | null
  loading: boolean
  refresh: () => Promise<void>
  /** 登录成功后就地更新（避免再请求一次主进程） */
  setLoggedIn: (profile: IgProfile | null) => void
}

export const useIgAccountStore = create<IgAccountState>((set) => ({
  loggedIn: false,
  profile: null,
  loading: true,

  refresh: async () => {
    try {
      const s = await window.instadown.igLoginStatus()
      set({ loggedIn: s.persisted, profile: s.profile ?? null, loading: false })
    } catch {
      set({ loggedIn: false, profile: null, loading: false })
    }
  },

  setLoggedIn: (profile) =>
    set({ loggedIn: !!profile, profile, loading: false })
}))
