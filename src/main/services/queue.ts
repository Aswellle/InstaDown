import { createWriteStream, existsSync, statSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { ensureDir } from './files'
import { backoffDelay, type Transport } from './downloader'
import type { Repos, TaskRow } from '../db/repos'
import type { TaskEvent } from '@shared/types'

/**
 * 任务队列 + 状态机（docs/06、07）：
 * WAITING → DOWNLOADING → SUCCESS / FAILED；支持 PAUSED（断点续传）与自动重试。
 * 默认并发 3；任务异步执行，不阻塞 UI。
 */

const MAX_ATTEMPTS = 3

export interface EnqueueItem {
  mediaId: string
  url: string
  author: string
  type: 'image' | 'video'
  shortcode: string
  indexNo: number
  takenAt?: number | null
  destPath: string
}

type AbortReason = 'pause' | 'cancel'

class TaskAbort extends Error {
  constructor(public reason: AbortReason) {
    super(reason)
  }
}

export class TaskManager {
  private rows = new Map<string, TaskRow>()
  private waiting: string[] = []
  private active = new Set<string>()
  private controllers = new Map<string, { c: AbortController; reason: AbortReason }>()
  private attempts = new Map<string, number>()
  private byteMarks = new Map<string, { t: number; b: number }>()
  private speedEma = new Map<string, number>()
  private _concurrency = 3

  constructor(
    private repos: Repos,
    private transport: Transport,
    private emit: (ev: TaskEvent) => void = () => {},
    private now: () => number = () => Date.now(),
    private onDownloadComplete: (filename: string, destPath: string) => void = () => {}
  ) {}

  /** 替换事件出口（如接入节流后的 IPC 发送器） */
  setEmitter(fn: (ev: TaskEvent) => void): void {
    this.emit = fn
  }

  get concurrency(): number {
    return this._concurrency
  }

  set concurrency(v: number) {
    this._concurrency = Math.min(6, Math.max(1, Math.round(v) || 3))
    this.pump()
  }

  /** 启动恢复：未完成任务装载进队列（WAITING 自动开始，PAUSED 保持） */
  restore(): void {
    this.repos.resetDownloadingToWaiting()
    for (const row of this.repos.listResumable()) {
      this.rows.set(row.id, row)
      if (row.status === 'PAUSED') continue
      this.repos.updateTask(row.id, { status: 'WAITING', speed: 0, error: null })
      row.status = 'WAITING'
      this.waiting.push(row.id)
      this.emit({ kind: 'status', id: row.id, status: 'WAITING' })
    }
    this.pump()
  }

  snapshot(): TaskRow[] {
    return [...this.rows.values()].sort((a, b) => b.created_at - a.created_at)
  }

  get(id: string): TaskRow | null {
    return this.rows.get(id) ?? this.repos.getTask(id)
  }

  enqueue(items: EnqueueItem[]): TaskRow[] {
    const created: TaskRow[] = []
    for (const item of items) {
      const now = this.now()
      const row: TaskRow = {
        id: `t${now}_${Math.random().toString(36).slice(2, 8)}`,
        media_id: item.mediaId,
        url: item.url,
        author: item.author,
        type: item.type,
        shortcode: item.shortcode,
        index_no: item.indexNo,
        status: 'WAITING',
        progress: 0,
        speed: 0,
        downloaded: 0,
        total: 0,
        dest_path: item.destPath,
        error: null,
        created_at: now,
        updated_at: now
      }
      this.repos.insertTask(row)
      this.rows.set(row.id, row)
      this.attempts.set(row.id, 0)
      this.waiting.push(row.id)
      created.push(row)
      this.emit({ kind: 'created', id: row.id, status: 'WAITING', destPath: row.dest_path ?? undefined })
    }
    this.pump()
    return created
  }

  pause(id: string): void {
    const row = this.rows.get(id)
    if (!row) return
    if (row.status === 'WAITING') {
      this.waiting = this.waiting.filter((x) => x !== id)
      row.status = 'PAUSED'
      this.repos.updateTask(id, { status: 'PAUSED', speed: 0 })
      this.emit({ kind: 'status', id, status: 'PAUSED' })
      return
    }
    if (row.status === 'DOWNLOADING') {
      const entry = this.controllers.get(id)
      if (entry) {
        entry.reason = 'pause'
        entry.c.abort()
      }
    }
  }

  resume(id: string): void {
    const row = this.rows.get(id)
    if (!row || row.status !== 'PAUSED') return
    row.status = 'WAITING'
    this.repos.updateTask(id, { status: 'WAITING', speed: 0, error: null })
    this.waiting.push(id)
    this.emit({ kind: 'status', id, status: 'WAITING' })
    this.pump()
  }

  cancel(id: string): void {
    const row = this.rows.get(id)
    if (!row) return
    this.waiting = this.waiting.filter((x) => x !== id)
    if (row.status === 'DOWNLOADING') {
      const entry = this.controllers.get(id)
      if (entry) {
        entry.reason = 'cancel'
        entry.c.abort()
      }
    }
    row.status = 'CANCELED'
    row.speed = 0
    this.repos.updateTask(id, { status: 'CANCELED', speed: 0 })
    this.emit({ kind: 'status', id, status: 'CANCELED' })
    this.pump()
  }

  retry(id: string): void {
    const row = this.rows.get(id)
    if (!row || !['FAILED', 'CANCELED', 'PAUSED'].includes(row.status)) return
    this.attempts.set(id, 0)
    row.status = 'WAITING'
    row.error = null
    row.progress = 0
    this.repos.updateTask(id, { status: 'WAITING', error: null, progress: 0, speed: 0 })
    this.waiting.push(id)
    this.emit({ kind: 'status', id, status: 'WAITING' })
    this.pump()
  }

  remove(id: string): void {
    const row = this.rows.get(id)
    if (!row) return
    if (row.status === 'DOWNLOADING') {
      const entry = this.controllers.get(id)
      if (entry) {
        entry.reason = 'cancel'
        entry.c.abort()
      }
    }
    this.waiting = this.waiting.filter((x) => x !== id)
    this.rows.delete(id)
    this.repos.deleteTask(id)
    this.emit({ kind: 'removed', id })
  }

  private pump(): void {
    while (this.active.size < this._concurrency && this.waiting.length > 0) {
      const id = this.waiting.shift()!
      const row = this.rows.get(id)
      if (!row || row.status !== 'WAITING') continue
      void this.begin(id)
    }
  }

  private async begin(id: string): Promise<void> {
    const row = this.rows.get(id)
    if (!row) return
    this.active.add(id)
    row.status = 'DOWNLOADING'
    row.error = null
    this.repos.updateTask(id, { status: 'DOWNLOADING', speed: 0, error: null })
    this.emit({ kind: 'status', id, status: 'DOWNLOADING' })
    try {
      const size = await this.runTransfer(row)
      row.status = 'SUCCESS'
      row.progress = 1
      row.downloaded = size
      row.total = size
      row.speed = 0
      this.repos.updateTask(id, {
        status: 'SUCCESS',
        progress: 1,
        downloaded: size,
        total: size,
        speed: 0
      })
      this.repos.insertHistory({
        task_id: id,
        media_id: row.media_id,
        author: row.author,
        path: row.dest_path ?? '',
        size,
        created_at: this.now()
      })
      this.emit({ kind: 'status', id, status: 'SUCCESS', destPath: row.dest_path ?? undefined })
      const filename = row.dest_path!.split(/[\\/]/).pop() ?? row.dest_path!
      this.onDownloadComplete(filename, row.dest_path!)
    } catch (e) {
      if (e instanceof TaskAbort) {
        if (e.reason === 'pause') {
          row.status = 'PAUSED'
          row.speed = 0
          this.repos.updateTask(id, { status: 'PAUSED', speed: 0 })
          this.emit({ kind: 'status', id, status: 'PAUSED' })
        }
        // cancel 已在 cancel() 中处理
      } else {
        row.status = 'FAILED'
        row.speed = 0
        row.error = (e as Error)?.message ?? 'download failed'
        this.repos.updateTask(id, { status: 'FAILED', speed: 0, error: row.error })
        this.emit({ kind: 'status', id, status: 'FAILED', error: row.error })
      }
    } finally {
      this.active.delete(id)
      this.controllers.delete(id)
      this.speedEma.delete(id)
      this.byteMarks.delete(id)
      this.pump()
    }
  }

  /** 单任务传输：Range 断点续传 + 自动重试（.part 临时文件，成功后原子 rename） */
  private async runTransfer(row: TaskRow): Promise<number> {
    const dest = row.dest_path!
    const partPath = `${dest}.part`
    ensureDir(dirname(dest))
    const controller = new AbortController()
    this.controllers.set(row.id, { c: controller, reason: 'pause' })

    let attempts = 0
    for (;;) {
      let offset = existsSync(partPath) ? statSync(partPath).size : 0
      try {
        let knownTotal = 0
        const result = await this.transferOnce(row, partPath, offset, controller, (absolute, total) => {
          if (total != null) knownTotal = total
          this.report(row, absolute, knownTotal)
        })
        if (result.status !== 200 && result.status !== 206) {
          throw new Error(`HTTP ${result.status}`)
        }
        if (result.status === 200 && offset > 0) {
          // 服务器忽略 Range：截断 .part 从头下载
          knownTotal = 0
          const retry = await this.transferOnce(row, partPath, 0, controller, (absolute, total) => {
            if (total != null) knownTotal = total
            this.report(row, absolute, knownTotal)
          })
          if (retry.status !== 200 && retry.status !== 206) {
            throw new Error(`HTTP ${retry.status}`)
          }
          offset = 0
          void retry
        }
        renameSync(partPath, dest)
        // 以磁盘上的最终文件大小为权威值：断点续传时 createWriteStream 以 'a'
        // 追加写入，文件已包含 offset，再叠加 offset 会重复计数。
        return statSync(dest).size
      } catch (e) {
        if (e instanceof TaskAbort) throw e
        attempts += 1
        if (attempts >= MAX_ATTEMPTS) throw e
        if (row.status === 'CANCELED') throw new TaskAbort('cancel')
        await new Promise((r) => setTimeout(r, backoffDelay(attempts - 1)))
        if (this.controllers.get(row.id)?.reason === 'cancel') throw new TaskAbort('cancel')
      }
    }
  }

  private transferOnce(
    row: TaskRow,
    partPath: string,
    offset: number,
    controller: AbortController,
    onProgress: (absolute: number, total: number | null) => void
  ): Promise<{ status: number; total: number | null }> {
    return new Promise((resolve, reject) => {
      const signal = controller.signal
      const stream = createWriteStream(partPath, { flags: offset > 0 ? 'a' : 'w' })
      let writeError: Error | null = null
      let finished = false
      let downloaded = 0
      stream.on('error', (e) => (writeError = e))

      const abortReason = () => this.controllers.get(row.id)?.reason ?? 'pause'
      const finish = (fn: () => void) => {
        if (finished) return
        finished = true
        stream.end(() => (stream.close(), fn()))
      }

      const onAbort = () => finish(() => reject(new TaskAbort(abortReason())))
      signal.addEventListener('abort', onAbort, { once: true })

      this.transport({
        url: row.url,
        offset,
        signal,
        headers: { Referer: 'https://www.instagram.com/' },
        onData: (chunk) =>
          new Promise<void>((res, rej) => {
            if (writeError) return rej(writeError)
            downloaded += chunk.length
            try {
              onProgress(offset + downloaded, null)
            } catch {
              /* progress 失败不中断下载 */
            }
            if (stream.write(chunk)) res()
            else stream.once('drain', () => res())
          }),
        onResponse: (info) => {
          if (info.total != null) onProgress(offset + downloaded, info.total)
        }
      })
        .then((result) => {
          if (writeError) {
            finish(() => reject(writeError))
            return
          }
          if (signal.aborted) {
            finish(() => reject(new TaskAbort(abortReason())))
            return
          }
          finish(() => {
            signal.removeEventListener('abort', onAbort)
            resolve({ status: result.status, total: result.total })
          })
        })
        .catch((e) => {
          finish(() => {
            if (signal.aborted) reject(new TaskAbort(abortReason()))
            else reject(e)
          })
        })
    })
  }

  private report(row: TaskRow, absolute: number, total: number): void {
    const now = this.now()
    const mark = this.byteMarks.get(row.id)
    if (!mark || now - mark.t >= 250) {
      if (mark) {
        const dts = (now - mark.t) / 1000
        const instant = dts > 0 ? (absolute - mark.b) / dts : 0
        const prev = this.speedEma.get(row.id) ?? 0
        this.speedEma.set(row.id, prev === 0 ? instant : prev * 0.6 + instant * 0.4)
      }
      this.byteMarks.set(row.id, { t: now, b: absolute })
    }
    const speed = this.speedEma.get(row.id) ?? 0
    const progress = total > 0 ? Math.min(1, absolute / total) : 0
    row.downloaded = absolute
    row.progress = progress
    row.speed = speed
    if (total > 0) row.total = total
    this.repos.updateTask(row.id, {
      progress,
      downloaded: absolute,
      speed,
      ...(total > 0 ? { total } : {})
    })
    this.emit({
      kind: 'progress',
      id: row.id,
      progress,
      speed,
      downloaded: absolute,
      total
    })
  }
}
