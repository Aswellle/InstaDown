/**
 * 自动化截图：CDP 驱动应用完成 README 各场景截图。
 *
 * 前置条件：
 *  1. 应用以 --remote-debugging-port=9224 运行（脚本可自动拉起）
 *  2. 媒体库已有下载数据（media 表非空）
 *
 * 产出：assets/screenshots/*.png（浅色 + 深色两套）
 *
 * 用法：node scripts/auto-shots.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 9224
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:')
const OUT_DIR = join(ROOT, 'assets', 'screenshots')
const EXE = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const APP = join(ROOT, 'out', 'main', 'index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─────────────────────────── CDP 连接 ───────────────────────────
async function cdpList() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return res.json()
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m)
        this.pending.delete(m.id)
      }
    })
  }
  static async connect(target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((r) => ws.addEventListener('open', r))
    const cdp = new CDP(ws)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    return cdp
  }
  send(method, params = {}) {
    return new Promise(async (res) => {
      const mid = ++this.id
      this.pending.set(mid, res)
      this.ws.send(JSON.stringify({ id: mid, method, params }))
    })
  }
  /** 渲染进程内求值（awaitPromise，90s 上限） */
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      timeout: 90000
    })
    if (r.result?.exceptionDetails) {
      throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200))
    }
    return r.result?.result?.value
  }
  /** 真实鼠标点击（绕过 drag-region 陷阱） */
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 })
    await sleep(150)
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(400)
  }
  /** 键盘按键 */
  async pressKey(key, keyCode = 0) {
    const base = { key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }
  async screenshot() {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    if (!r?.result?.data) {
      throw new Error('captureScreenshot 无数据: ' + JSON.stringify(r).slice(0, 200))
    }
    return Buffer.from(r.result.data, 'base64')
  }
  async locate(selectorDesc, fn) {
    const v = await this.eval(`(() => { ${fn} })()`)
    if (!v || v.x === undefined) throw new Error(`定位失败: ${selectorDesc} → ${JSON.stringify(v)}`)
    return v
  }
  close() {
    try { this.ws.close() } catch { /* ignore */ }
  }
}

// ─────────────────────────── 场景辅助 ───────────────────────────
const INPUT_SEL = `document.querySelector('input[placeholder*="粘贴"]')`
const SET_VALUE = (v) => `(() => {
  const inp = ${INPUT_SEL}
  if (!inp) return null
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, ${JSON.stringify(v)})
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`

async function findButton(cdp, match) {
  return cdp.locate(match.title || match.text, `
    const btns = [...document.querySelectorAll('button')]
    const b = btns.find(b => ${match.title ? `(b.title||'').includes(${JSON.stringify(match.title)})` : match.textContains ? `b.textContent.includes(${JSON.stringify(match.textContains)})` : `b.textContent.trim() === ${JSON.stringify(match.text)}`})
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }
  `)
}

async function clickButton(cdp, match, label) {
  const pos = await findButton(cdp, match)
  if (!pos) throw new Error(`按钮未找到: ${label}`)
  await cdp.click(pos.x, pos.y)
  console.log(`  ✓ 点击 ${label}`)
}

/** 容错点击：找不到按钮仅警告（用于可跳过的收尾步骤） */
async function tryClick(cdp, match, label) {
  try {
    await clickButton(cdp, match, label)
    return true
  } catch {
    console.log(`  ⚠ 跳过 ${label}（按钮不存在，可能已处于目标状态）`)
    return false
  }
}

// ─────────────────────────── 场景流程 ───────────────────────────


/** 回到确定的干净状态：Esc 多次清层 + 关面板 + 回主页 */
async function resetToHome(cdp) {
  for (let i = 0; i < 4; i++) {
    await cdp.pressKey('Escape', 27)
    await sleep(250)
  }
  // 仅当面板真的开着才点切换按钮（按钮是 toggle：面板关着时点击会把它打开！）
  await cdp.eval(`(() => {
    const panelOpen = !!document.querySelector('.absolute.left-0.top-0.z-50')
    if (!panelOpen) return 'closed'
    const btns = [...document.querySelectorAll('button')]
    // 面板内自带关闭按钮（右上角 X）
    const x = panelOpen && document.querySelector('.absolute.left-0.top-0.z-50 button')
    return 'open'
  })()`)
  // 用面板自身的关系：Esc 已发，若仍开着再用顶部按钮 toggle 关
  const stillOpen = await cdp.eval(`!!document.querySelector('.absolute.left-0.top-0.z-50')`)
  if (stillOpen) {
    // 点两次同一个按钮 = 关（偶发 toggle 状态不明时，以面板存在性为准循环）
    for (let i = 0; i < 3; i++) {
      const open = await cdp.eval(`!!document.querySelector('.absolute.left-0.top-0.z-50')`)
      if (!open) break
      await clickButton(cdp, { title: '媒体库' }, '重置:切换面板')
      await sleep(500)
    }
  }
  await sleep(300)
  // 回主页（若不在主页）
  await cdp.eval(`(() => {
    const back = [...document.querySelectorAll('button')].find(b => (b.title||'').includes('返回主页'))
    if (back) back.click()
    return 'ok'
  })()`)
  await sleep(500)
}

/** 场景 1+2：主图（解析结果网格）与多选操作栏 */
async function shotMainAndSelection(cdp, writeShot, prefix) {
  // 输入一个多图帖子
  const url = process.env.SHOT_POST_URL || 'https://www.instagram.com/p/DeZnnO7CBKY/'
  await cdp.eval(SET_VALUE(url))
  await clickButton(cdp, { text: '解析' }, '解析')
  // 等网格出现（embed 解析通常 < 15s）
  let cards = 0
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    cards = (await cdp.eval(`document.querySelectorAll('[class*="aspect-square"]').length`)) || 0
    if (cards > 0) break
  }
  if (cards === 0) throw new Error('解析超时：网格未出现')
  await sleep(2500) // 等缩略图加载
  await writeShot(`${prefix}-01-grid.png`)

  // 多选：Shift 连选 3 张
  const rects = await cdp.eval(`(() => {
    return [...document.querySelectorAll('[class*="aspect-square"]')].slice(0,4).map(el => {
      const card = el.closest('div[class*="rounded-xl"]') || el
      const r = card.getBoundingClientRect()
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }
    })
  })()`)
  if (rects.length >= 2) {
    await cdp.click(rects[0].x, rects[0].y)
    await sleep(300)
    // Shift 连选
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 })
    await cdp.click(rects[Math.min(2, rects.length - 1)].x, rects[Math.min(2, rects.length - 1)].y)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 })
    await sleep(600)
  }
  await writeShot(`${prefix}-02-selection.png`)
  // 清除选择（Esc）
  await cdp.pressKey('Escape', 27)
  await sleep(300)
}

/** 场景 3：全屏媒体库 */
async function shotFullscreenLibrary(cdp, writeShot, prefix) {
  await resetToHome(cdp)
  await clickButton(cdp, { title: '媒体库' }, '媒体库按钮')
  // 等侧边栏真的渲染（特有文本"共 N 个文件"；全屏库不含它）
  let sideOpen = false
  for (let i = 0; i < 12; i++) {
    await sleep(400)
    sideOpen = await cdp.eval(`document.body.innerText.includes('个文件')`)
    if (sideOpen) break
  }
  if (!sideOpen) throw new Error('侧边栏未打开')
  await sleep(600) // 等侧栏滑入动画结束
  // 导航点击（非截图目标）用 JS click 保证可靠性：真实点击受动画/遮挡时序影响
  await cdp.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.title||'').includes('全屏媒体库'))
    if (!b) return 'no-btn'
    b.click()
    return 'ok'
  })()`)
  await sleep(400)
  // 关闭侧边栏（全屏库叠在其上但会挤压布局）
  await cdp.pressKey('Escape', 27)
  await sleep(600)
  // 等全屏库网格真实渲染：网格卡片实际可见（数量>10 且首卡片在视口内）
  let libReady = false
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    libReady = await cdp.eval(`(() => {
      const cards = [...document.querySelectorAll('[class*="aspect-square"]')]
      const vis = cards.filter(el => { const r = el.getBoundingClientRect(); return r.x > 0 && r.y > 60 && r.bottom < innerHeight })
      return vis.length >= 8
    })()`)
    if (libReady) break
  }
  if (!libReady) throw new Error('全屏库未渲染')
  await sleep(2000) // 等缩略图
  await writeShot(`${prefix}-03-library.png`)
  // 退出全屏库
  await resetToHome(cdp)
}

/** 场景 4：应用内查看器（post 视图双击卡片 → MediaViewer） */
async function shotViewer(cdp, writeShot, prefix) {
  await resetToHome(cdp)
  // 解析一个帖子，在 post 网格里双击卡片（MediaGrid 的双击=打开查看器）
  const url = process.env.SHOT_POST_URL || 'https://www.instagram.com/p/DeZnnO7CBKY/'
  await cdp.eval(SET_VALUE(url))
  await clickButton(cdp, { text: '解析' }, '解析')
  let cards = 0
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    cards = (await cdp.eval(`document.querySelectorAll('[class*="aspect-square"]').length`)) || 0
    if (cards > 0) break
  }
  if (cards === 0) throw new Error('查看器场景：解析超时')
  await sleep(2500)
  // 找到命中确认渲染的卡片中心，双击
  const spot = await cdp.eval(`(() => {
    for (const el of document.querySelectorAll('[class*="aspect-square"]')) {
      const card = el.closest('div[class*="rounded-xl"]')
      if (!card) continue
      const r = card.getBoundingClientRect()
      if (r.width < 50 || r.bottom < 100 || r.top > innerHeight - 60) continue
      const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2)
      const hit = document.elementFromPoint(cx, cy)
      if (hit) return { x: cx, y: cy }
    }
    return null
  })()`)
  if (!spot) throw new Error('查看器场景：无可点卡片')
  // 双击（两次快速 click，clickCount=2）
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spot.x, y: spot.y, button: 'none', clickCount: 0 })
  await sleep(200)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 })
  await sleep(80)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 2 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 2 })
  // 等查看器出现并加载大图
  let viewerReady = false
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    const st = await cdp.eval(`(() => {
      const img = document.querySelector('[role="dialog"] img')
      return { open: !!document.querySelector('[role="dialog"]'), loaded: img ? img.complete && img.naturalWidth > 0 : false }
    })()`)
    if (st?.open && st?.loaded) { viewerReady = true; break }
  }
  if (!viewerReady) throw new Error('查看器未能打开')
  await sleep(800)
  await writeShot(`${prefix}-04-viewer.png`)
  await resetToHome(cdp)
}

/** 场景 6：下载进行中（任务栏展开） */
async function shotDownloads(cdp, writeShot, prefix) {
  await resetToHome(cdp)
  // 通过 API 加入一批下载（复用当前网格选中或直接 re-download 库内媒体）
  const ok = await cdp.eval(`(async () => {
    const rows = await window.instadown.getLibrary()
    const picks = rows.slice(0, 5).map(r => ({
      id: r.id + '-re', type: r.type, url: r.url, thumbUrl: r.thumb_url,
      author: r.author || 'demo', shortcode: r.shortcode || '', indexNo: 1,
      takenAt: r.taken_at, width: r.width, height: r.height, duration: r.duration
    }))
    if (picks.length === 0) return false
    await window.instadown.addDownload(picks)
    return true
  })()`)
  if (!ok) { console.log('  ⚠ 库为空，跳过下载场景'); return }
  await sleep(1200)
  // 展开任务栏
  await clickButton(cdp, { textContains: '任务空闲' }, '任务栏')
  await sleep(800)
  await writeShot(`${prefix}-06-downloads.png`)
}

function makeWriter(cdp) {
  return async function writeShot(name) {
    const buf = await cdp.screenshot()
    const dest = join(OUT_DIR, name)
    writeFileSync(dest, buf)
    console.log(`  📸 ${name} (${Math.round(buf.length / 1024)} KB)`)
  }
}

// ─────────────────────────── 主流程 ───────────────────────────
async function ensureApp() {
  // 已有实例则复用
  try {
    const list = await cdpList()
    if (list.some((t) => t.type === 'page')) return false
  } catch { /* 未运行 */ }
  console.log('启动应用（调试端口 9224）…')
  const child = spawn(EXE, [APP, `--remote-debugging-port=${PORT}`], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
  // 等调试端口就绪
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    try {
      const list = await cdpList()
      if (list.some((t) => t.type === 'page' && t.url.includes('renderer'))) return true
    } catch { /* retry */ }
  }
  throw new Error('应用启动超时')
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const launched = await ensureApp()
  const list = await cdpList()
  const page = list.find((t) => t.type === 'page' && t.url.includes('renderer'))
  if (!page) throw new Error('未找到渲染进程 target')
  const cdp = await CDP.connect(page)
  const writeShot = makeWriter(cdp)

  const themes = ['light', 'dark']
  for (const theme of themes) {
    console.log(`\n── ${theme} 主题 ──`)
    // 切主题（通过设置持久化 + 等 .dark 类生效）
    await cdp.eval(`window.instadown.setSettings({ theme: ${JSON.stringify(theme)} }).then(() => 'ok')`)
    // 主题切换由 UI 层 useApplyTheme 响应设置 store —— 直接设置 DOM 类以确保生效
    await cdp.eval(`(() => {
      document.documentElement.classList.toggle('dark', ${theme === 'dark'})
      return document.documentElement.className
    })()`)
    await sleep(800)

    await shotMainAndSelection(cdp, writeShot, theme)
    await shotFullscreenLibrary(cdp, writeShot, theme)
    await shotViewer(cdp, writeShot, theme)
    if (theme === 'light') await shotDownloads(cdp, writeShot, theme) // 下载场景只需一套
  }

  cdp.close()
  console.log(`\n完成：${OUT_DIR}`)
  if (launched) console.log('（应用由脚本拉起，截图完成后仍保持运行）')
}

main().catch((e) => {
  console.error('截图失败:', e.message)
  process.exit(1)
})
