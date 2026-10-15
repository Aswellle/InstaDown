import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/main/db/database'
import { Repos } from '../../src/main/db/repos'
import { TaskManager, type EnqueueItem } from '../../src/main/services/queue'
import type { Transport, TransferStart } from '../../src/main/services/downloader'

/**
 * 集成测试：本地 HTTP 服务器（支持 Range / 慢速分块 / 5xx 注入）+ fetch 传输实现，
 * 验证 docs/06 的断点续传 / 自动重试 / 服务器忽略 Range 的回退。
 */

const SIZE = 4096
const CHUNK = 256
function patternByte(i: number): number {
  return (i * 31 + 7) % 256
}

async function fetchTransport(opts: TransferStart) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.offset > 0) headers.Range = `bytes=${opts.offset}-`
  const res = await fetch(opts.url, { headers, signal: opts.signal })
  const cr = res.headers.get('content-range')
  let total: number | null = null
  if (cr) total = parseInt(cr.split('/')[1] ?? '', 10)
  else {
    const cl = res.headers.get('content-length')
    if (cl) total = parseInt(cl, 10)
  }
  opts.onResponse?.({ status: res.status, total })
  if (res.body) {
    for await (const chunk of res.body) {
      if (opts.signal.aborted) break
      opts.onData(Buffer.from(chunk as Uint8Array))
    }
  }
  return { status: res.status, total }
}

let flakyCount = 0

function makeServer(): Server {
  return createServer((req, res) => {
    const url = req.url ?? ''
    const slow = url.includes('slow')
    const send = (start: number, status: number) => {
      const len = SIZE - start
      res.writeHead(status, {
        'Content-Type': 'application/octet-stream',
        ...(status === 206
          ? { 'Content-Range': `bytes ${start}-${SIZE - 1}/${SIZE}` }
          : {}),
        'Content-Length': String(len)
      })
      let sent = 0
      const writeChunk = () => {
        const n = Math.min(CHUNK, len - sent)
        if (n <= 0) return res.end()
        const buf = Buffer.alloc(n)
        for (let i = 0; i < n; i++) buf[i] = patternByte(start + sent + i)
        sent += n
        if (slow) setTimeout(() => (res.write(buf), writeChunk()), 20)
        else (res.write(buf), writeChunk())
      }
      writeChunk()
    }
    if (url.startsWith('/range') || url.startsWith('/norestore')) {
      const honorRange = url.startsWith('/range')
      const range = req.headers.range
      if (honorRange && range) {
        const m = /bytes=(\d+)-/.exec(range)
        send(m ? parseInt(m[1], 10) : 0, 206)
      } else {
        send(0, 200)
      }
      return
    }
    if (url.startsWith('/flaky')) {
      const n = flakyCount++
      if (n < 2) {
        res.writeHead(500)
        res.end('boom')
        return
      }
      res.writeHead(200, { 'Content-Length': '16' })
      res.end(Buffer.alloc(16, 3))
      return
    }
    res.writeHead(404)
    res.end()
  })
}

function waitFor(cond: () => boolean, ms = 15000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (cond()) return resolve()
      if (Date.now() - start > ms) return reject(new Error('waitFor timeout'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('下载引擎（本地 HTTP 集成）', () => {
  let server: Server
  let base: string
  let dir: string

  beforeAll(async () => {
    server = makeServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('no port')
    base = `http://127.0.0.1:${addr.port}`
    dir = mkdtempSync(join(tmpdir(), 'instadown-dl-'))
  }, 20000)
  afterAll(() => {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function manager() {
    const repos = new Repos(openDatabase(':memory:'))
    const tm = new TaskManager(repos, fetchTransport, () => {})
    return { repos, tm }
  }

  function item(name: string, url: string): EnqueueItem {
    return {
      mediaId: `m-${name}`,
      url,
      author: 'user',
      type: 'video',
      shortcode: 'Ab12',
      indexNo: 1,
      takenAt: 1700000000,
      destPath: join(dir, name)
    }
  }

  it('完整下载，内容与服务器一致', async () => {
    const { tm } = manager()
    const [t] = tm.enqueue([item('full.mp4', `${base}/range`)])
    await waitFor(() => tm.get(t.id)!.status === 'SUCCESS')
    const data = readFileSync(t.dest_path!)
    expect(data.length).toBe(SIZE)
    expect(data[0]).toBe(patternByte(0))
    expect(data[SIZE - 1]).toBe(patternByte(SIZE - 1))
  })

  it('暂停后断点续传（Range 恢复）', async () => {
    const { tm } = manager()
    const [t] = tm.enqueue([item('resume.mp4', `${base}/range?slow=1`)])
    await waitFor(() => tm.get(t.id)!.downloaded > 512)
    tm.pause(t.id)
    await waitFor(() => tm.get(t.id)!.status === 'PAUSED')
    expect(existsSync(`${t.dest_path!}.part`)).toBe(true)
    const partial = statSync(`${t.dest_path!}.part`).size
    expect(partial).toBeGreaterThan(0)

    tm.resume(t.id)
    await waitFor(() => tm.get(t.id)!.status === 'SUCCESS')
    const data = readFileSync(t.dest_path!)
    expect(data.length).toBe(SIZE)
    expect(data[partial]).toBe(patternByte(partial))
    expect(data[SIZE - 1]).toBe(patternByte(SIZE - 1))
    // 回归：断点续传后记录的 downloaded/total 必须等于真实文件大小，
    // 不能把 resume offset 重复计数（曾出现 downloaded = offset + fileSize）。
    const done = tm.get(t.id)!
    expect(done.downloaded).toBe(SIZE)
    expect(done.total).toBe(SIZE)
  })

  it('服务器忽略 Range 时从头重传', async () => {
    const { tm } = manager()
    const [t] = tm.enqueue([item('norestore.mp4', `${base}/norestore?slow=1`)])
    await waitFor(() => tm.get(t.id)!.downloaded > 512)
    tm.pause(t.id)
    await waitFor(() => tm.get(t.id)!.status === 'PAUSED')
    tm.resume(t.id)
    await waitFor(() => tm.get(t.id)!.status === 'SUCCESS')
    const data = readFileSync(t.dest_path!)
    expect(data.length).toBe(SIZE)
    for (let i = 0; i < SIZE; i += 97) expect(data[i]).toBe(patternByte(i))
  })

  it('5xx 自动重试后成功', async () => {
    flakyCount = 0
    const { tm } = manager()
    const [t] = tm.enqueue([item('flaky.mp4', `${base}/flaky`)])
    await waitFor(() => tm.get(t.id)!.status === 'SUCCESS', 30000)
    expect(readFileSync(t.dest_path!).length).toBe(16)
  })

  it('取消：不留最终文件', async () => {
    const { tm } = manager()
    const [t] = tm.enqueue([item('cancel.mp4', `${base}/range?slow=1&cancel=1`)])
    await waitFor(() => tm.get(t.id)!.status === 'DOWNLOADING')
    tm.cancel(t.id)
    await waitFor(() => tm.get(t.id)!.status === 'CANCELED')
    expect(existsSync(t.dest_path!)).toBe(false)
  })
}, 90000)
