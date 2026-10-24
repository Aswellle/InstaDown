import { app, BrowserWindow, nativeTheme, Notification, shell } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db/database'
import { Repos } from './db/repos'
import { WorkerManager } from './services/worker-manager'
import { SettingsService } from './services/settings'
import { TaskManager } from './services/queue'
import { netTransport } from './services/net-transport'
import { registerIpc } from './ipc'
import { registerImageScheme, serveImageCache } from './services/image-cache'
import { themeColorsFor } from '@shared/theme'
import { uiLocale } from './services/ui-locale'

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
  // 下载完成通知：由主进程直接创建（渲染层没有、也不需要这个通道；
  // 通知文案的语言取自 ui-locale，跟随渲染层选择）
  const tasks = new TaskManager(repos, netTransport, () => {}, () => Date.now(), (filename, destPath) => {
    if (!Notification.isSupported()) return
    const notif = new Notification({
      title: uiLocale() === 'zh-CN' ? '下载完成' : 'Download complete',
      body: filename
    })
    notif.on('click', () => {
      if (destPath) shell.showItemInFolder(destPath)
    })
    notif.show()
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

/** 按设置解析初始主题（避免深色偏好下启动瞬间白闪，或反之）。
 *  themeSource 与配色同源解析：'system' 交给系统，light/dark 钉死 ——
 *  Windows 的窗口控制按钮（WCO）深浅色由 nativeTheme 驱动，只设
 *  titleBarOverlay 颜色会出现"渲染层已黑、控制区仍白"的不同步。 */
function initialThemeColors(settings: SettingsService): { bg: string; symbol: string } {
  const theme = settings.get().theme
  nativeTheme.themeSource = theme === 'dark' || theme === 'light' ? theme : 'system'
  return themeColorsFor(nativeTheme.shouldUseDarkColors)
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

  // 外链走系统浏览器；仅放行 http(s)，其余协议（file:/smb:/自定义协议）直接拒绝
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
