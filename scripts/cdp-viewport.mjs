// 通过 CDP 调整窗口尺寸并读回布局，用于验证窄窗口下的顶栏表现
const PORT = process.argv[2] || '9224'
const W = Number(process.argv[3] || 1024)
const H = Number(process.argv[4] || 680)
const EXPR = process.argv[5] || ''

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page =
    list.find((t) => t.type === 'page' && t.url.includes('renderer')) ||
    list.find((t) => t.type === 'page')
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

  await send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: 1,
    mobile: false
  })
  if (EXPR) {
    const r = await send('Runtime.evaluate', {
      expression: EXPR,
      awaitPromise: true,
      returnByValue: true,
      timeout: 60000
    })
    console.log('RESULT:', JSON.stringify(r.result?.result?.value, null, 1).slice(0, 4000))
  }
  await send('Emulation.clearDeviceMetricsOverride')
  ws.close()
}

main()
