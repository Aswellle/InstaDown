import { net, session } from 'electron'
import type { Transport } from './downloader'

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** 生产传输实现：Electron net 流式 + Range 断点续传 */
export const netTransport: Transport = (opts) =>
  new Promise((resolve, reject) => {
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    const request = net.request({
      url: opts.url,
      method: 'GET',
      session: session.defaultSession,
      useSessionCookies: false
    })
    request.setHeader('User-Agent', DEFAULT_UA)
    request.setHeader('Accept', '*/*')
    if (opts.offset > 0) request.setHeader('Range', `bytes=${opts.offset}-`)
    for (const [k, v] of Object.entries(opts.headers ?? {})) request.setHeader(k, v)

    request.on('response', (res) => {
      const status = res.statusCode ?? 0
      let total: number | null = null
      const rangeHeader = res.headers['content-range']
      if (typeof rangeHeader === 'string') {
        const t = parseInt(rangeHeader.split('/')[1] ?? '', 10)
        if (Number.isFinite(t)) total = t
      } else {
        const len = res.headers['content-length']
        const t = parseInt(String(len ?? ''), 10)
        if (Number.isFinite(t)) total = t
      }
      try {
        opts.onResponse?.({ status, total })
      } catch {
        /* 上报失败不影响下载 */
      }
      res.on('data', (chunk: Buffer) => {
        if (opts.signal.aborted) return
        try {
          opts.onData(chunk)
        } catch (e) {
          request.abort()
          done(() => reject(e as Error))
        }
      })
      res.on('end', () => done(() => resolve({ status, total })))
      res.on('error', (e: Error) => done(() => reject(e)))
    })
    request.on('error', (e) => done(() => reject(e)))
    opts.signal.addEventListener('abort', () => request.abort(), { once: true })
    request.end()
  })
