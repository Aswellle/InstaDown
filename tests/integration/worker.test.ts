import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { WorkerManager, findPython } from '../../src/main/services/worker-manager'

/**
 * 集成测试：spawn 真实 Python Worker，验证 JSON-RPC 协议、握手与方法分发。
 */
describe('Python Worker 协议（真实进程）', () => {
  let wm: WorkerManager

  beforeAll(async () => {
    await findPython() // 环境预检
    wm = new WorkerManager()
    await wm.start()
  }, 20000)

  afterAll(async () => {
    await wm.stop()
  })

  it('握手', async () => {
    const r = await wm.call<{ protocol: number; provider: string }>('handshake')
    expect(r.protocol).toBe(2)
    expect(r.provider).toBe('instagram')
  })

  it('classify_url 分类', async () => {
    const post = await wm.call<{ kind: string; shortcode: string }>('classify_url', {
      url: 'https://www.instagram.com/p/B1LbfVPlwIA/'
    })
    expect(post.kind).toBe('post')
    const user = await wm.call<{ kind: string; username: string }>('classify_url', {
      url: 'natgeo'
    })
    expect(user).toEqual({ kind: 'profile', username: 'natgeo' })
  })

  it('shortcode ⇄ media_id 双向转换', async () => {
    const a = await wm.call<{ media_id: string }>('shortcode_to_media_id', {
      shortcode: 'B1LbfVPlwIA'
    })
    expect(a.media_id).toBe('2110901750722920960')
    // media_id 以字符串传输（超过 JS Number.MAX_SAFE_INTEGER）
    const b = await wm.call<{ shortcode: string }>('media_id_to_shortcode', {
      media_id: '2110901750722920960'
    })
    expect(b.shortcode).toBe('B1LbfVPlwIA')
  })

  it('未知方法返回 E_INTERNAL', async () => {
    await expect(wm.call('no_such_method', {})).rejects.toMatchObject({
      code: 'E_INTERNAL'
    })
  })

  it('worker 崩溃后自动重启', async () => {
    // 强杀子进程，等待自动重启后再次握手成功
    ;(wm as unknown as { proc: { kill: () => void } }).proc?.kill()
    await new Promise((r) => setTimeout(r, 2500))
    const r = await wm.call<{ protocol: number }>('handshake')
    expect(r.protocol).toBe(2)
  }, 20000)
})
