// CDP 端到端探针：在真实渲染进程里调用 window.instadown API
const PORT = process.argv[2] || '9224'
const EXPR = process.argv[3]

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  // 优先取渲染进程（登录窗口等其它页面会抢占第一个 page target）
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

  const r = await send('Runtime.evaluate', {
    expression: EXPR,
    awaitPromise: true,
    returnByValue: true,
    timeout: 90000
  })
  const result = r.result?.result
  if (r.result?.exceptionDetails) {
    console.log('EXCEPTION:', JSON.stringify(r.result.exceptionDetails).slice(0, 800))
  } else {
    console.log('RESULT:', JSON.stringify(result?.value, null, 1).slice(0, 3000))
  }
  ws.close()
}
main().catch((e) => {
  console.error('PROBE-ERR', e.message)
  process.exit(1)
})
