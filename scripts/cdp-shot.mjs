/**
 * 截图工具：连接 Electron 渲染进程并保存 PNG。
 * 用法: node scripts/cdp-shot.mjs <port> <output.png> [fullPage]
 */
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9232'
const OUT = process.argv[3] || 'shot.png'

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  await new Promise((r) => ws.addEventListener('open', r))
  const send = (method, params) =>
    new Promise((res) => {
      const mid = ++id
      pending.set(mid, res)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })

  await send('Page.enable', {})
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const data = shot.result?.data
  if (!data) {
    console.log('screenshot failed:', JSON.stringify(shot).slice(0, 300))
    ws.close()
    return
  }
  writeFileSync(OUT, Buffer.from(data, 'base64'))
  console.log('saved:', OUT)
  ws.close()
}
main().catch((e) => {
  console.error('SHOT-ERR', e.message)
  process.exit(1)
})
