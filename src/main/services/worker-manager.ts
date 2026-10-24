import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppError } from '@shared/types'

/**
 * Python Worker 管理器（docs/dev/02 §3）：
 * 行分隔 JSON-RPC over stdio，握手 10s，崩溃自动重启（退避），请求排队。
 */

let workerDir: string
try {
  workerDir = join(dirname(fileURLToPath(import.meta.url)), '../../worker')
} catch {
  workerDir = join(process.cwd(), 'worker')
}

export function resolveWorkerDir(): string {
  // 打包后 import.meta.url 位于 out/main，worker 位于 resources/worker
  const candidates = [
    join(process.resourcesPath ?? '', 'worker'),
    join(dirname(fileURLToPath(import.meta.url)), '../../worker'),
    join(process.cwd(), 'worker')
  ]
  for (const c of candidates) {
    if (c && existsSync(join(c, 'main.py'))) return c
  }
  return workerDir
}

async function tryPython(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(cmd, args, { windowsHide: true }) as ChildProcessWithoutNullStreams
    } catch {
      return resolve(null)
    }
    let ok = false
    const timer = setTimeout(() => {
      child.kill()
      resolve(ok ? `${cmd} ${args.join(' ')}`.trim() : null)
    }, 5000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    // 同上：探测进程瞬间退出时写入端可能 EPIPE
    child.stdin.on('error', () => {})
    child.stdout.on('data', (d) => {
      if (String(d).includes('ok')) ok = true
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(ok ? `${cmd} ${args.join(' ')}`.trim() : null)
    })
    child.stdin.end('print("ok")\n')
  })
}

export async function findPython(): Promise<string> {
  const envPy = process.env.INSTADOWN_PYTHON
  if (envPy && existsSync(envPy)) return envPy
  const candidates: Array<[string, string[]]> = [
    ['python', []],
    ['python3', []],
    ['py', ['-3']]
  ]
  for (const [cmd, args] of candidates) {
    const found = await tryPython(cmd, args)
    if (found) return found
  }
  throw Object.assign(new Error('python not found'), { code: 'E_WORKER_DOWN' })
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

const REQUEST_TIMEOUT = 120_000 // 主页媒体解析可能较慢
const HANDSHAKE_TIMEOUT = 10_000

export class WorkerManager extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private command: string | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private started = false
  private starting: Promise<void> | null = null
  private restarts = 0
  private sessionCookie: string | null = null

  constructor(private dir = resolveWorkerDir()) {
    super()
  }

  get ready(): boolean {
    return this.started && !!this.proc
  }

  async start(): Promise<void> {
    if (this.ready) return
    if (this.starting) return this.starting
    this.starting = this.doStart().finally(() => (this.starting = null))
    return this.starting
  }

  /** 用户触发的手动复活：重置退避预算后重新拉起（重试耗尽后的恢复入口） */
  revive(): Promise<void> {
    this.restarts = 0
    return this.start()
  }

  private async doStart(): Promise<void> {
    if (!this.command) this.command = await findPython()
    const [cmd, ...baseArgs] = this.command.split(' ')
    const script = join(this.dir, 'main.py')
    const proc = spawn(cmd, [...baseArgs, script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    }) as ChildProcessWithoutNullStreams
    this.proc = proc

    // 子进程死亡到 exit 回调之间存在窗口：向断管写入触发 EPIPE，
    // 无监听的 error 事件会以未捕获异常击穿主进程。忽略写入错误，
    // 由 exit 回调走既有的 rejectAll / 重启路径接管。
    proc.stdin.on('error', () => {})

    let buffer = ''
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line) this.handleFrame(line)
      }
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      // Worker 日志仅用于诊断，不包含敏感信息
      this.emit('log', 'debug', d.trim())
    })
    proc.on('exit', (code) => {
      this.proc = null
      this.started = false
      this.rejectAll(new WorkerDownError(`worker exited (code=${code})`))
      if (this.restarts < 5) {
        const delay = Math.min(1000 * 2 ** this.restarts, 15000)
        this.restarts += 1
        this.emit('log', 'warn', `worker exited, restarting in ${delay}ms`)
        setTimeout(() => this.start().catch(() => {}), delay)
      } else {
        this.emit('down')
      }
    })

    // 握手/会话同步失败必须清理刚拉起的进程：留着它不仅泄漏，
    // 其 exit 回调稍后还会把 this.proc 置空、践踏下一次 start() 的状态。
    try {
      await this.call('handshake', undefined, HANDSHAKE_TIMEOUT)
      if (this.sessionCookie) {
        // worker 已活但 set_session 失败不应连带杀进程：仅跳过
        await this.call('set_session', { cookie: this.sessionCookie }).catch(() => {})
      }
    } catch (e) {
      if (this.proc === proc) this.proc = null
      this.started = false
      proc.kill()
      throw e
    }
    this.started = true
    this.restarts = 0
    this.emit('ready')
  }

  private handleFrame(line: string): void {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(line)
    } catch {
      return
    }
    if ('event' in frame) {
      const data = frame.data as { level?: string; message?: string } | undefined
      this.emit('log', data?.level ?? 'info', data?.message ?? '')
      return
    }
    const id = frame.id as number | null
    if (id == null) return
    const p = this.pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(id)
    if (frame.ok) p.resolve(frame.result)
    else {
      const err = frame.error as { code?: string; message?: string }
      p.reject(
        Object.assign(new Error(err?.message ?? 'worker error'), {
          code: err?.code ?? 'E_INTERNAL'
        })
      )
    }
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  call<T = unknown>(method: string, params?: Record<string, unknown>, timeout: number = REQUEST_TIMEOUT): Promise<T> {
    if (!this.proc) return Promise.reject(new WorkerDownError('worker not started'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new WorkerDownError(`worker request timeout: ${method}`))
      }, timeout)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      const frame = JSON.stringify({ id, method, params: params ?? {} })
      this.proc!.stdin.write(frame + '\n')
    })
  }

  async setSession(cookie: string | null): Promise<void> {
    this.sessionCookie = cookie
    if (this.ready) await this.call('set_session', { cookie }).catch(() => {})
  }

  toAppError(e: unknown): AppError {
    const err = e as { code?: string; message?: string }
    return {
      code: (err?.code as AppError['code']) ?? 'E_INTERNAL',
      message: err?.message ?? 'unknown error'
    }
  }

  async stop(): Promise<void> {
    this.restarts = 99 // 阻止自动重启
    const proc = this.proc
    this.proc = null
    this.started = false
    this.rejectAll(new WorkerDownError('worker stopped'))
    if (proc) {
      proc.kill()
      await new Promise<void>((r) => {
        proc.once('exit', () => r())
        setTimeout(r, 2000)
      })
    }
  }
}

export class WorkerDownError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerDownError'
  }
}
