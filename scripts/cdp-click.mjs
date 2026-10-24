/**
 * 真实鼠标点击验证：用 CDP Input.dispatchMouseEvent 发送原生鼠标事件。
 *
 * 关键：JS 的 el.click() 绕过 Electron 的原生命中检测（drag-region 吞事件），
 * 因此无法暴露"点击无反应"这类 bug。Input.dispatchMouseEvent 走真实输入管线，
 * 能正确复现/验证。
 *
 * 用法: node scripts/cdp-click.mjs <port> <x> <y> [label] [clickCount]
 *   clickCount=2 时发送原生双击（同一输入序列内，触发 dblclick）
 */
const PORT = process.argv[2] || '9250'
const X = parseInt(process.argv[3], 10)
const Y = parseInt(process.argv[4], 10)
const LABEL = process.argv[5] || ''
const CLICKS = parseInt(process.argv[6], 10) || 1

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('renderer'))
  if (!page) throw new Error('no renderer target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  })
  await new Promise((r) => ws.addEventListener('open', r))
  const send = (method, params) =>
    new Promise((res) => {
      const mid = ++id
      pending.set(mid, res)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })

  // 1) 先看该坐标下是什么元素（确认命中的是目标）
  const hit = await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.elementFromPoint(${X}, ${Y});
      if (!el) return 'none';
      const btn = el.closest('button') || el;
      return JSON.stringify({ tag: btn.tagName, title: btn.getAttribute('title') || '', text: (btn.textContent||'').trim().slice(0,20) });
    })()`,
    returnByValue: true
  })
  console.log(`[${LABEL}] hit-test @(${X},${Y}):`, hit.result?.result?.value)

  // 2) 真实鼠标移动（触发 hover）
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: X, y: Y, button: 'none', clickCount: 0 })
  await new Promise((r) => setTimeout(r, 250))

  // 3) 真实按下 + 抬起（完整点击；双击用同一 clickCount=2 序列）
  for (let c = 1; c <= CLICKS; c++) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: X, y: Y, button: 'left', clickCount: c })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: X, y: Y, button: 'left', clickCount: c })
    await new Promise((r) => setTimeout(r, 80))
  }
  await new Promise((r) => setTimeout(r, 900))

  console.log(`[${LABEL}] dispatched real click x${CLICKS}`)
  ws.close()
}
main().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})
