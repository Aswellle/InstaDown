/**
 * IPC 边界辅助函数（纯逻辑，不依赖 Electron，便于单元测试）。
 *
 * Electron 的 ipcMain.handle 回调签名是 (event, ...args)，而业务处理函数
 * 只关心 ...args。若把业务函数直接交给 ipcMain.handle，业务函数会把
 * IpcMainInvokeEvent 当作第一个参数——历史上这导致 parse:url 收到 event
 * 对象并抛 "raw.trim is not a function"，使全部 IPC 能力失效。
 */

/** 把业务处理函数适配为 ipcMain.handle 回调：剥离首个 event 参数并包装为 Promise。 */
export function toIpcHandler<A extends unknown[], R>(
  fn: (...args: A) => R | Promise<R>
): (event: unknown, ...args: A) => Promise<R> {
  return (_event: unknown, ...args: A) =>
    // 用 Promise.resolve().then 包裹，确保同步抛错也转为 rejected Promise，
    // 否则 Electron 无法将其作为 IPC 错误回传渲染进程。
    Promise.resolve().then(() => fn(...args))
}
