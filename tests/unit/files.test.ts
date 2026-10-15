import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename, dirname } from 'node:path'
import { sanitizeFilename, planPath, extFromUrl, dateFolder } from '../../src/main/services/files'

describe('sanitizeFilename', () => {
  it('替换 Windows 非法字符', () => {
    expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })
  it('控制字符替换为下划线并截断', () => {
    expect(sanitizeFilename('ab\x00cd')).toBe('ab_cd')
    expect(sanitizeFilename('x'.repeat(200)).length).toBeLessThanOrEqual(120)
  })
  it('空值兜底', () => {
    expect(sanitizeFilename('???')).toBe('___')
  })
})

describe('planPath', () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'instadown-test-'))
  })
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('按 用户名/日期/类型 归档（秒级时间戳）', () => {
    const takenAt = new Date('2026-10-12T10:00:00').getTime() / 1000
    const p = planPath({ root, author: 'natgeo', takenAt, type: 'image', base: 'natgeo_AbC', ext: 'jpg' })
    expect(p).toContain('natgeo')
    expect(p).toContain('images')
    expect(p).toMatch(/natgeo_AbC\.jpg$/)
    expect(dirname(dirname(p))).toContain(dateFolder(takenAt))
  })

  it('重名自动追加序号', () => {
    const dir = join(root, 'dup', '2026-01-01', 'videos')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'v.mp4'), 'x')
    const first = planPath({ root, author: 'dup', takenAt: new Date('2026-01-01').getTime(), type: 'video', base: 'v', ext: 'mp4' })
    expect(basename(first)).toBe('v-2.mp4')
    writeFileSync(first, 'x')
    const second = planPath({ root, author: 'dup', takenAt: new Date('2026-01-01').getTime(), type: 'video', base: 'v', ext: 'mp4' })
    expect(basename(second)).toBe('v-3.mp4')
    expect(existsSync(first)).toBe(true)
  })
})

describe('extFromUrl', () => {
  it('从 URL 推断扩展名', () => {
    expect(extFromUrl('https://cdn/x.mp4?se=1', 'video')).toBe('mp4')
    expect(extFromUrl('https://cdn/y.jpg?se=2', 'image')).toBe('jpg')
    expect(extFromUrl('https://cdn/y.jpeg', 'image')).toBe('jpg')
    expect(extFromUrl('https://cdn/no-ext', 'video')).toBe('mp4')
    expect(extFromUrl('https://cdn/no-ext', 'image')).toBe('jpg')
  })
})
