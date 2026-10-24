import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../src/main/db/database'
import { Repos } from '../../src/main/db/repos'
import { TaskManager, type EnqueueItem } from '../../src/main/services/queue'
import type { Transport } from '../../src/main/services/downloader'
import type { TaskEvent } from '@shared/types'

/** 立即完成的传输 */
const autoTransport: Transport = async (opts) => {
  opts.onResponse?.({ status: 200, total: 100 })
  for (let i = 0; i < 4; i++) opts.onData(Buffer.alloc(25, i))
  return { status: 200, total: 100 }
}

/** 门控传输：等待 release() 才完成；统计最大并发 */
function makeGatedTransport(delayMs = 40) {
  let inFlight = 0
  let maxSeen = 0
  const transport: Transport = async (opts) => {
    inFlight++
    maxSeen = Math.max(maxSeen, inFlight)
    await new Promise((r) => setTimeout(r, delayMs))
    inFlight--
    opts.onResponse?.({ status: 200, total: 100 })
    opts.onData(Buffer.alloc(100, 1))
    return { status: 200, total: 100 }
  }
  return { transport, maxSeen: () => maxSeen }
}

function items(dir: string, n = 1): EnqueueItem[] {
  return Array.from({ length: n }, (_, i) => ({
    mediaId: `m${i}`,
    url: 'https://cdn.example/x.mp4',
    author: 'natgeo',
    type: 'video' as const,
    shortcode: 'AbC12',
    indexNo: i + 1,
    takenAt: 1700000000,
    destPath: join(dir, `f${i}.mp4`)
  }))
}

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('TaskManager 状态机', () => {
  let dir: string
  let db: DatabaseSync
  let repos: Repos

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'instadown-queue-'))
    db = openDatabase(':memory:')
    repos = new Repos(db)
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('下载成功：状态流转 + 历史 + 文件', async () => {
    const events: TaskEvent[] = []
    const tm = new TaskManager(repos, autoTransport, (e) => events.push(e))
    const [task] = tm.enqueue(items(dir, 1))
    await waitFor(() => tm.get(task.id)!.status === 'SUCCESS')
    expect(existsSync(task.dest_path!)).toBe(true)
    expect(statSync(task.dest_path!).size).toBe(100)
    const history = repos.listHistory()
    expect(history).toHaveLength(1)
    expect(history[0].task_id).toBe(task.id)
    expect(events.some((e) => e.kind === 'status' && e.status === 'DOWNLOADING')).toBe(true)
    expect(events.some((e) => e.kind === 'progress')).toBe(true)
  })

  it('并发不超过限制', async () => {
    const gated = makeGatedTransport()
    const tm = new TaskManager(repos, gated.transport)
    tm.concurrency = 3
    const created = tm.enqueue(items(dir, 5))
    await waitFor(() => created.every((t) => tm.get(t.id)!.status === 'SUCCESS'))
    expect(gated.maxSeen()).toBe(3)
  })

  it('暂停后续传并成功', async () => {
    const gate: Array<() => void> = []
    let started = 0
    const transport: Transport = async (opts) => {
      started++
      if (started === 1) {
        opts.onResponse?.({ status: 200, total: 200 })
        opts.onData(Buffer.alloc(80, 1))
        await new Promise<void>((r) => gate.push(r))
        return { status: 200, total: 200 }
      }
      opts.onResponse?.({ status: 206, total: 200 })
      opts.onData(Buffer.alloc(120, 2))
      return { status: 206, total: 200 }
    }
    const tm = new TaskManager(repos, transport)
    const [task] = tm.enqueue(items(dir, 1))
    await waitFor(() => started === 1 && tm.get(task.id)!.downloaded > 0)
    tm.pause(task.id)
    gate[0]()
    await waitFor(() => tm.get(task.id)!.status === 'PAUSED')
    expect(existsSync(`${task.dest_path!}.part`)).toBe(true)
    expect(statSync(`${task.dest_path!}.part`).size).toBe(80)

    tm.resume(task.id)
    await waitFor(() => tm.get(task.id)!.status === 'SUCCESS')
    expect(statSync(task.dest_path!).size).toBe(200)
  })

  it('失败自动重试直至成功', async () => {
    let calls = 0
    const transport: Transport = async (opts) => {
      calls++
      if (calls <= 2) throw new Error('boom')
      opts.onResponse?.({ status: 200, total: 10 })
      opts.onData(Buffer.alloc(10, 9))
      return { status: 200, total: 10 }
    }
    const tm = new TaskManager(repos, transport)
    const [task] = tm.enqueue(items(dir, 1))
    await waitFor(() => tm.get(task.id)!.status === 'SUCCESS', 15000)
    expect(calls).toBe(3)
  })

  it('取消后状态为 CANCELED', async () => {
    const gate = new Promise<void>(() => {})
    const transport: Transport = async (opts) => {
      opts.onResponse?.({ status: 200, total: 200 })
      opts.onData(Buffer.alloc(10, 1))
      await gate
      return { status: 200, total: 200 }
    }
    const tm = new TaskManager(repos, transport)
    const [task] = tm.enqueue(items(dir, 1))
    await waitFor(() => tm.get(task.id)!.status === 'DOWNLOADING')
    tm.cancel(task.id)
    await waitFor(() => tm.get(task.id)!.status === 'CANCELED')
  })

  it('restore 装载未完成任务', async () => {
    const db2 = openDatabase(':memory:')
    const repos2 = new Repos(db2)
    repos2.insertTask({
      id: 't-old',
      media_id: 'm',
      url: 'https://cdn/x',
      author: 'a',
      type: 'image',
      shortcode: 's',
      index_no: 1,
      status: 'DOWNLOADING',
      progress: 0.5,
      speed: 0,
      downloaded: 50,
      total: 100,
      dest_path: join(dir, 'restored.mp4'),
      error: null,
      created_at: 1,
      updated_at: 1
    })
    const tm = new TaskManager(repos2, autoTransport)
    tm.restore()
    await waitFor(() => tm.get('t-old')!.status === 'SUCCESS')
    expect(existsSync(join(dir, 'restored.mp4'))).toBe(true)
  })

  it('取消下载清理半成品 .part 文件', async () => {
    const gate: Array<() => void> = []
    const transport: Transport = async (opts) => {
      opts.onResponse?.({ status: 200, total: 200 })
      opts.onData(Buffer.alloc(50, 1))
      await new Promise<void>((r) => gate.push(r))
      return { status: 200, total: 200 }
    }
    const tm = new TaskManager(repos, transport)
    const [task] = tm.enqueue(items(dir, 1))
    await waitFor(() => tm.get(task.id)!.status === 'DOWNLOADING')
    const part = `${task.dest_path}.part`
    await waitFor(() => existsSync(part))
    tm.cancel(task.id)
    gate.pop()?.()
    await waitFor(() => tm.get(task.id)!.status === 'CANCELED')
    // 状态在 cancel() 中同步置位，.part 清理在传输中止后的异步路径执行
    await waitFor(() => !existsSync(part))
  })

  it('restore 装载最近失败任务，且跨重启后可重试', async () => {
    const db3 = openDatabase(':memory:')
    const repos3 = new Repos(db3)
    const failedRow = {
      id: 't-failed',
      media_id: 'm2',
      url: 'https://cdn/x',
      author: 'a',
      type: 'image' as const,
      shortcode: 's',
      index_no: 1,
      status: 'FAILED' as const,
      progress: 0,
      speed: 0,
      downloaded: 0,
      total: 0,
      dest_path: join(dir, 'failed.jpg'),
      error: 'HTTP 500',
      created_at: 1,
      updated_at: 2
    }
    repos3.insertTask(failedRow)
    const tm = new TaskManager(repos3, autoTransport)
    tm.restore()
    // 装载后可见、保持 FAILED、不自动开始
    expect(tm.snapshot().map((t) => t.id)).toContain('t-failed')
    expect(tm.get('t-failed')!.status).toBe('FAILED')
    // 重试后完成（此前：不在内存 Map → retry 静默 no-op）
    tm.retry('t-failed')
    await waitFor(() => tm.get('t-failed')!.status === 'SUCCESS')
    expect(existsSync(join(dir, 'failed.jpg'))).toBe(true)
  })

  it('retry 对 DB-only 的失败行同样生效', async () => {
    const db4 = openDatabase(':memory:')
    const repos4 = new Repos(db4)
    repos4.insertTask({
      id: 't-db-only',
      media_id: 'm3',
      url: 'https://cdn/x',
      author: 'a',
      type: 'image' as const,
      shortcode: 's',
      index_no: 1,
      status: 'FAILED' as const,
      progress: 0,
      speed: 0,
      downloaded: 0,
      total: 0,
      dest_path: join(dir, 'dbonly.jpg'),
      error: 'HTTP 500',
      created_at: 1,
      updated_at: 2
    })
    const tm = new TaskManager(repos4, autoTransport)
    // 注意：不调用 restore —— 模拟内存 Map 不含该行的场景
    tm.retry('t-db-only')
    await waitFor(() => tm.get('t-db-only')!.status === 'SUCCESS')
    expect(existsSync(join(dir, 'dbonly.jpg'))).toBe(true)
  })
})

describe('Repos CRUD', () => {
  it('media 去重 / task 更新 / settings 读写', () => {
    const d = openDatabase(':memory:')
    const r = new Repos(d)
    const now = Date.now()
    const media = {
      id: 'm1', platform: 'instagram', shortcode: 's', author: 'a', url: 'u',
      thumb_url: null, type: 'image' as const, width: 1, height: 1, duration: null,
      caption: null, taken_at: null, created_at: now
    }
    r.upsertMedia(media)
    r.upsertMedia({ ...media })
    expect(r.getMediaByAuthor('a')).toHaveLength(1)

    r.insertTask({
      id: 't1', media_id: 'm1', url: 'u', author: 'a', type: 'image', shortcode: 's',
      index_no: 1, status: 'WAITING', progress: 0, speed: 0, downloaded: 0, total: 0,
      dest_path: null, error: null, created_at: now, updated_at: now
    })
    r.updateTask('t1', { status: 'FAILED', error: 'x' })
    expect(r.getTask('t1')?.status).toBe('FAILED')
    r.deleteTask('t1')
    expect(r.getTask('t1')).toBeNull()

    r.setSetting('k', 'v')
    expect(r.getSetting('k')).toBe('v')
    r.setSetting('k', 'v2')
    expect(r.getSetting('k')).toBe('v2')
  })
})
