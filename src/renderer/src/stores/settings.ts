import { create } from 'zustand'
import type { AppSettings } from '@shared/types'

interface SettingsState {
  settings: AppSettings | null
  workerReady: boolean
  /** worker 崩溃重启预算耗尽（收到 'down'）后置真，复活成功清除 */
  workerDown: boolean
  load: () => Promise<void>
  save: (patch: Partial<AppSettings>) => Promise<void>
  setWorkerReady: (v: boolean) => void
  setWorkerDown: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  workerReady: false,
  workerDown: false,
  load: async () => set({ settings: await window.instadown.getSettings() }),
  save: async (patch) => set({ settings: await window.instadown.setSettings(patch) }),
  setWorkerReady: (v) => set({ workerReady: v }),
  setWorkerDown: (v) => set({ workerDown: v })
}))
