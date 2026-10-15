import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db/database'
import { Repos } from './db/repos'
import { WorkerManager } from './services/worker-manager'
import { SettingsService } from './services/settings'
import { TaskManager } from './services/queue'
import { netTransport } from './services/net-transport'
import { registerIpc } from './ipc'
import { registerImageScheme, serveImageCache } from './services/image-cache'

/**
 * 主进程入口：窗口生命周期 + 服务装配（docs/02、03）。
 * 单实例锁；渲染进程沙箱化；所有服务仅存在于主进程。
 */

process.env.APP_ROOT = join(__dirname, '../..')

// 图片本地缓存协议必须在 app ready 之前注册
registerImageScheme()

const isDev = !app.isPackaged
let win: BrowserWindow | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void bootstrap()
}

async function bootstrap(): Promise<void> {
  const repos = new Repos(openDatabase(join(app.getPath('userData'), 'instadown.db')))
  const worker = new WorkerManager()
  const settings = new SettingsService(repos)
  const tasks = new TaskManager(repos, netTransport, () => {}, () => Date.now(), (filename, destPath) => {
    win?.webContents.send('notification:download-complete', { filename, destPath })
  })

  registerIpc({ win: () => win, worker, repos, settings, tasks })

  worker.on('ready', () => win?.webContents.send('worker:status', 'ready'))
  worker.on('down', () => win?.webContents.send('worker:status', 'down'))
  worker.on('log', (_level: string, message: string) => {
    if (isDev) console.log(`[worker] ${message}`)
  })

  app.whenReady().then(async () => {
    serveImageCache()
    createWindow(settings)

    // 服务延迟启动：不阻塞首帧
    setTimeout(() => {
      tasks.concurrency = settings.get().concurrency
      tasks.restore()
      worker
        .start()
        .then(() => worker.setSession(settings.getSession()))
        .catch((e) => {
          console.error('[main] worker start failed:', (e as Error).message)
          win?.webContents.send('worker:status', 'down')
        })
    }, 50)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(settings)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    void worker.stop()
  })
}

/** 按设置解析初始主题（避免深色偏好下启动瞬间白闪，或反之） */
function initialThemeColors(settings: SettingsService): { bg: string; symbol: string } {
  const theme = settings.get().theme
  const dark =
    theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? { bg: '#09090b', symbol: '#a1a1aa' } : { bg: '#ffffff', symbol: '#52525b' }
}

function createWindow(settings: SettingsService): void {
  const colors = initialThemeColors(settings)
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: colors.bg,
    autoHideMenuBar: true,
    // 开发/免安装运行时的任务栏图标（打包后由 electron-builder 嵌入）
    icon: join(process.env.APP_ROOT ?? __dirname, 'build/icon.ico'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: colors.bg, symbolColor: colors.symbol, height: 40 }
        : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))

  // 外链走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
