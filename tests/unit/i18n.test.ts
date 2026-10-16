import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 双字典结构一致性（t() 用同一条键路径查两本字典，任何一边缺键都会
 * 在运行时静默回退到简中，表现为"界面半中半英"）。
 *
 * 以源码文本方式加载字典（与 selector-stability 等测试一致 —— 单测项目
 * 的 tsconfig 不含 renderer 目录，避免直接 import）：
 *   1. 剥掉 import/export 语句后用 new Function 求值出字典对象
 *   2. 对比两本字典的键结构、占位符与叶子类型
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

function loadDict(rel: string): Record<string, unknown> {
  const src = readFileSync(join(ROOT, rel), 'utf-8')
  const stripped = src
    .replace(/^import[\s\S]*?from\s+'[^']+'\s*$/m, '')
    .replace(/export const (\w+) =/, 'const $1 =')
    .replace(/\} as const/, '}') // 去掉 as const 断言（new Function 不认 TS 语法）
    .replace(/export type[\s\S]*$/, '')
  // eslint-disable-next-line no-new-func
  const fn = new Function(`${stripped}; return ${/const (\w+) =/.exec(stripped)![1]}`)
  return fn() as Record<string, unknown>
}

const zh = loadDict('src/renderer/src/i18n/zh-CN.ts')
const en = loadDict('src/renderer/src/i18n/en.ts')

function flatten(obj: unknown, prefix = ''): string[] {
  if (obj == null || typeof obj !== 'object') return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k)
  )
}

function leaves(obj: unknown, prefix = ''): Array<[string, string]> {
  if (obj == null || typeof obj !== 'object') return [[prefix, String(obj)]]
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k)
  )
}

describe('i18n 双字典', () => {
  it('en 与 zh-CN 的键结构完全一致', () => {
    const zhKeys = flatten(zh).sort()
    const enKeys = flatten(en).sort()
    const missingInEn = zhKeys.filter((k) => !enKeys.includes(k))
    const missingInZh = enKeys.filter((k) => !zhKeys.includes(k))
    expect(missingInEn, 'en 缺少的键').toEqual([])
    expect(missingInZh, 'zh-CN 多出的键').toEqual([])
  })

  it('两边叶子都是非空字符串', () => {
    for (const [name, dict] of [['zh-CN', zh], ['en', en]] as const) {
      for (const [path, val] of leaves(dict)) {
        expect(typeof val, `${name}.${path} 应为字符串`).toBe('string')
        expect(val.trim().length, `${name}.${path} 不应为空`).toBeGreaterThan(0)
      }
    }
  })

  it('插值占位符在两种语言中一致（防变量名漂移）', () => {
    const zhMap = new Map(leaves(zh))
    const enMap = new Map(leaves(en))
    const varsOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    for (const [key, zhVal] of zhMap) {
      const enVal = enMap.get(key)
      if (enVal == null) continue
      expect(varsOf(enVal), `${key} 插值变量应一致`).toBe(varsOf(zhVal))
    }
  })

  it('en 的语言名保留原文字（简体中文 不翻译）', () => {
    expect((en.settings as Record<string, string>).languageZh).toBe('简体中文')
  })
})
