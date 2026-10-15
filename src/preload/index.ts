import { contextBridge, ipcRenderer } from 'electron'

/**
 * preload 桥（docs/dev/02 §4）：最小暴露面，全部经 ipcRenderer.invoke。
 */

const api = {
  parseUrl: (url: string) => ipcRenderer.invoke('parse:url', url),
  getUserMedia: (username: string, maxId?: string) => ipcRenderer.invoke('user:media', username, maxId),
  searchUser: (username: string) => ipcRenderer.invoke('user:search', username),

  addDownload: (items: unknown[]) => ipcRenderer.invoke('download:add', items),
  getTasks: () => ipcRenderer.invoke('tasks:list'),
  pauseTask: (id: string) => ipcRenderer.invoke('tasks:pause', id),
  resumeTask: (id: string) => ipcRenderer.invoke('tasks:resume', id),
  cancelTask: (id: string) => ipcRenderer.invoke('tasks:cancel', id),
  retryTask: (id: string) => ipcRenderer.invoke('tasks:retry', id),
  removeTask: (id: string) => ipcRenderer.invoke('tasks:remove', id),

  getHistory: () => ipcRenderer.invoke('history:list'),
  getLibrary: (author?: string) => ipcRenderer.invoke('library:list', author),

  // 图片本地缓存（IG CDN 链接会过期；缓存后从磁盘读取）
  cacheImages: (urls: string[]) => ipcRenderer.invoke('image:cache', urls),
  getImageCacheStats: () => ipcRenderer.invoke('image:cacheStats'),
  clearImageCache: () => ipcRenderer.invoke('image:clearCache'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  chooseDirectory: () => ipcRenderer.invoke('settings:chooseDir'),
  setSessionCookie: (value: string | null) => ipcRenderer.invoke('settings:session:set', value),
  hasSessionCookie: () => ipcRenderer.invoke('settings:session:has'),

  // Instagram 登录窗口（打开官方登录页，成功后加密保存 Cookie）
  igLogin: () => ipcRenderer.invoke('ig:login'),
  igResetAndLogin: () => ipcRenderer.invoke('ig:resetAndLogin'),
  igLogout: () => ipcRenderer.invoke('ig:logout'),
  igLoginStatus: () => ipcRenderer.invoke('ig:loginStatus'),
  // 诊断（临时）：返回登录页探针原始结果，供 CDP 冒烟测试
  igProbeLoginPage: () => ipcRenderer.invoke('ig:probeLoginPage'),

  // 原生窗口外观（Windows 窗口控制按钮区随主题）
  setNativeTheme: (mode: 'light' | 'dark') => ipcRenderer.invoke('window:setNativeTheme', mode),

  readClipboard: () => ipcRenderer.invoke('clipboard:readText'),
  revealFile: (path: string) => ipcRenderer.invoke('file:reveal', path),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  openFile: (path: string) => ipcRenderer.invoke('file:open', path),
  openDownloadDir: () => ipcRenderer.invoke('file:openDownloadDir'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  notifyDownloadComplete: (filename: string, destPath: string) =>
    ipcRenderer.send('notification:download-complete', { filename, destPath }),

  onTaskEvent: (cb: (ev: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: unknown) => cb(ev)
    ipcRenderer.on('task:event', listener)
    return () => ipcRenderer.removeListener('task:event', listener)
  },
  onWorkerStatus: (cb: (status: 'ready' | 'down') => void) => {
    const listener = (_e: Electron.IpcRendererEvent, status: 'ready' | 'down') => cb(status)
    ipcRenderer.on('worker:status', listener)
    return () => ipcRenderer.removeListener('worker:status', listener)
  }
}

contextBridge.exposeInMainWorld('instadown', api)

export type InstadownApi = typeof api
