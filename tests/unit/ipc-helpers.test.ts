import { describe, expect, it } from 'vitest'
import { toIpcHandler } from '../../src/main/ipc-helpers'

/**
 * 回归测试：IPC 边界必须剥离 Electron 的 event 参数。
 *
 * 背景：曾出现把所有业务函数直接交给 ipcMain.handle 的回归，导致业务函数
 * 收到 IpcMainInvokeEvent 而非真实参数，parse:url 抛
 * "raw.trim is not a function"，全部 IPC 能力失效。
 */

describe('toIpcHandler', () => {
  it('剥离首个 event 参数，业务函数只收到真实参数', async () => {
    const seen: unknown[] = []
    const fn = (url: string) => {
      seen.push(url)
      return `got:${url}`
    }
    const handler = toIpcHandler(fn)

    const fakeEvent = { sender: {}, type: 'ipc-main-invoke' }
    const result = await handler(fakeEvent, 'https://www.instagram.com/p/abc/')

    expect(seen).toEqual(['https://www.instagram.com/p/abc/'])
    expect(result).toBe('got:https://www.instagram.com/p/abc/')
    expect(seen[0]).not.toBe(fakeEvent)
  })

  it('无参数调用时不注入 event', async () => {
    const fn = (...args: unknown[]) => args.length
    const handler = toIpcHandler(fn)
    expect(await handler({ sender: {} })).toBe(0)
  })

  it('多参数透传（如 getUserMedia(username, maxId)）', async () => {
    const fn = (username: string, maxId?: string) => ({ username, maxId })
    const handler = toIpcHandler(fn)
    expect(await handler({}, 'natgeo', 'cursor1')).toEqual({ username: 'natgeo', maxId: 'cursor1' })
  })

  it('返回 Promise 与同步值均被归一为 Promise', async () => {
    expect(await toIpcHandler(() => 42)({})).toBe(42)
    expect(await toIpcHandler(async () => 'async')({})).toBe('async')
  })

  it('业务函数同步抛错时以 rejected Promise 呈现（Electron 会转成 IPC 错误）', async () => {
    const handler = toIpcHandler(() => {
      throw new Error('boom')
    })
    await expect(handler({})).rejects.toThrow('boom')
  })

  it('模拟真实的 "raw.trim is not a function" 崩溃场景', async () => {
    // 若 event 未被剥离，业务函数会把 event 当字符串用而抛 TypeError
    const parseUrl = (raw: string) => raw.trim().toLowerCase()
    const handler = toIpcHandler(parseUrl)
    const fakeEvent = { sender: { id: 1 } }
    await expect(handler(fakeEvent, '  ABC  ')).resolves.toBe('abc')
    // 直接传 event（旧 bug 的调用方式）会同步抛 TypeError —— 证明剥离是必要的
    expect(() => parseUrl(fakeEvent as unknown as string)).toThrow(TypeError)
  })
})
