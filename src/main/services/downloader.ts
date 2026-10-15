/**
 * 下载传输层契约（docs/06）。纯类型 + 纯函数，无 Electron 依赖。
 * netTransport（依赖 Electron net）见 net-transport.ts，由主进程装配注入。
 */

export interface TransferStart {
  url: string
  offset: number
  signal: AbortSignal
  headers?: Record<string, string>
  onData: (chunk: Buffer) => void
  /** 响应头到达时回调（status / 完整资源大小），用于进度百分比 */
  onResponse?: (info: { status: number; total: number | null }) => void
}

export interface TransferResult {
  status: number
  /** 服务器声明的完整资源大小；未知为 null */
  total: number | null
}

export type Transport = (opts: TransferStart) => Promise<TransferResult>

/** 指数退避：1s / 4s / 16s（封顶） */
export function backoffDelay(attempt: number): number {
  return Math.round(1000 * 4 ** Math.min(attempt, 2))
}
