import { create } from 'zustand'
import type { AppSettings } from '@shared/types'

interface SettingsState {
  settings: AppSettings | null
  workerReady: boolean
  load: () => Promise<void>
  save: (patch: Partial<AppSettings>) => Promise<void>
  setWorkerReady: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  workerReady: false,
  load: async () => set({ settings: await window.instadown.getSettings() }),
  save: async (patch) => set({ settings: await window.instadown.setSettings(patch) }),
  setWorkerReady: (v) => set({ workerReady: v })
}))
