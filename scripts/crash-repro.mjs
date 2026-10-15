/**
 * 崩溃复现探针：连接 Electron 渲染进程，订阅异常/控制台/崩溃事件，
 * 并模拟真实 UI 操作（填输入框 + 点解析）复现用户报告的"黑屏崩溃"。
 *
 * 用法: node scripts/crash-repro.mjs <port> <url>
 */
const PORT = process.argv[2] || '9229'
const URL_TO_PARSE = process.argv[3] || ''

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  console.log('target:', page.title, page.url)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const events = []

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
      return
    }
    // 收集所有事件
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      events.push({
        type: 'EXCEPTION',
        text: d.text,
        desc: d.exception?.description?.slice(0, 500),
        url: d.url,
        line: d.lineNumber,
        col: d.columnNumber
      })
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type)
      events.push({ type: 'CONSOLE.' + msg.params.type, args: args.map(String).slice(0, 5) })
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry
      events.push({ type: 'LOG.' + e.level, text: e.text?.slice(0, 300), source: e.source })
    } else if (msg.method === 'Inspector.targetCrashed') {
      events.push({ type: 'TARGET_CRASHED' })
    } else if (msg.method === 'Page.frameDetached') {
      events.push({ type: 'FRAME_DETACHED' })
    }
  })

  await new Promise((r) => ws.addEventListener('open', r))
  const send = (method, params) =>
    new Promise((res) => {
      const mid = ++id
      pending.set(mid, res)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })

  await send('Runtime.enable', {})
  await send('Log.enable', {})
  await send('Page.enable', {})
  await send('Inspector.enable', {})

  // 模拟真实 UI：填入受控输入框并点击"解析"
  const script = `
    (async () => {
      const input = document.querySelector('input[placeholder]');
      if (!input) return { step: 'no-input' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(URL_TO_PARSE)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('解析'));
      if (!btns.length) return { step: 'no-button', inputValue: input.value };
      btns[0].click();
      return { step: 'clicked', inputValue: input.value };
    })()
  `
  const r = await send('Runtime.evaluate', {
    expression: script,
    awaitPromise: true,
    returnByValue: true
  })
  console.log('ui-action:', JSON.stringify(r.result?.result?.value))
  if (r.result?.exceptionDetails) {
    console.log('ui-action-exception:', JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  }

  // 观察 12 秒
  await new Promise((r) => setTimeout(r, 12000))

  // 检查页面是否还活着 + DOM 状态
  const alive = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      rootChildren: document.getElementById('root')?.children.length ?? -1,
      bodyLen: document.body.innerText.length,
      hasError: document.body.innerText.includes('解析失败') || document.body.innerText.includes('错误'),
      text: document.body.innerText.slice(0, 200)
    })`,
    returnByValue: true
  })
  console.log('after-12s DOM:', alive.result?.result?.value)
  if (alive.result?.exceptionDetails) {
    console.log('after-12s exception:', JSON.stringify(alive.result.exceptionDetails).slice(0, 400))
  }

  console.log('\n=== 捕获的事件 ===')
  if (events.length === 0) console.log('(无异常/错误事件)')
  for (const e of events) console.log(JSON.stringify(e))

  ws.close()
}
main().catch((e) => {
  console.error('PROBE-ERR', e.message)
  process.exit(1)
})
