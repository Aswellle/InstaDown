import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate, formatDuration, formatSpeed } from '@shared/format'

/**
 * 回归测试：格式化工具的单位处理。
 *
 * 背景：历史面板曾把毫秒时间戳当秒处理（`new Date(ts * 1000)`），
 * 导致 created_at = Date.now() 显示成 `58756-02-08`。
 */

describe('formatDate', () => {
  it('毫秒时间戳（Date.now() 形态）', () => {
    // 2026-10-15 本地时间
    const ms = new Date(2026, 9, 15, 12, 0, 0).getTime()
    expect(ms).toBeGreaterThan(1e12)
    expect(formatDate(ms)).toBe('2026-10-15')
  })

  it('秒时间戳（Instagram taken_at 形态）', () => {
    const sec = Math.floor(new Date(2026, 9, 15, 12, 0, 0).getTime() / 1000)
    expect(sec).toBeLessThan(1e12)
    expect(formatDate(sec)).toBe('2026-10-15')
  })

  it('毫秒与秒指向同一日期', () => {
    const d = new Date(2024, 0, 5, 8, 30, 0)
    expect(formatDate(d.getTime())).toBe(formatDate(Math.floor(d.getTime() / 1000)))
    expect(formatDate(d.getTime())).toBe('2024-01-05')
  })

  it('不产生非法年份（回归：58756-02-08）', () => {
    const out = formatDate(Date.now())
    const year = parseInt(out.slice(0, 4), 10)
    expect(year).toBeGreaterThan(2000)
    expect(year).toBeLessThan(2100)
  })

  it('空值/非法值返回空串', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
    expect(formatDate(0)).toBe('')
    expect(formatDate(Number.NaN)).toBe('')
  })
})

describe('formatBytes', () => {
  it('人类可读单位', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    // 1 以下保留一位小数（1024/1024 = 1.0 KB）
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    // 大于等于 10 时取整
    expect(formatBytes(10 * 1024)).toBe('10 KB')
    expect(formatBytes(8_428_060)).toBe('8.0 MB')
  })

  it('非法输入兜底', () => {
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})

describe('formatSpeed / formatDuration', () => {
  it('速度', () => {
    expect(formatSpeed(0)).toBe('')
    expect(formatSpeed(1024)).toBe('1.0 KB/s')
  })

  it('时长', () => {
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(12.34)).toBe('0:12')
    expect(formatDuration(90)).toBe('1:30')
    expect(formatDuration(125)).toBe('2:05')
  })
})
