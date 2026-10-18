import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 字典一致性与调用点覆盖。
 *
 * 两件事分开保证：
 *   1. 双字典结构一致（t() 用同一条键路径查两本字典，任何一边缺键都会
 *      在运行时静默回退到简中，表现为"界面半中半英"）。
 *   2. 组件里写死的 t('…') 键名都能在字典里解析 —— 曾出现账号面板
 *      引用 account.sessionValid（实际在 settings 下），缺键时 t()
 *      返回键路径本身，界面直接显示 account.sessionValid。
 *
 * 以源码文本方式加载字典（单测项目的 tsconfig 不含 renderer 目录，
 * 避免直接 import）：
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

/**
 * 调用点覆盖：扫源码里字面量形式的 t('…') / i18nT('…')，
 * 断言每个键都能在字典里解析。
 *
 * 动态拼接的键（`error.${code}`、`task.status_${status}`）不在此列 ——
 * 前者已改为 t.has() 判断，后者由 AppErrorCode / TaskStatus 联合类型约束，
 * 这里对带 ${ 的模板字面量直接跳过。
 */
const RENDERER_SRC = join(ROOT, 'src', 'renderer', 'src')

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...collectSourceFiles(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

function resolve(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

describe('i18n 调用点', () => {
  const files = collectSourceFiles(RENDERER_SRC).filter(
    (f) => !/[\\/]i18n[\\/](zh-CN|en)\.ts$/.test(f)
  )

  it('渲染层存在可扫描文件', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('所有字面量键名都能在字典中解析', () => {
    const missing: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf-8')
      for (const m of src.matchAll(/\b(?:t|i18nT)\(\s*['"]([\w.]+)['"]/g)) {
        const key = m[1]
        if (typeof resolve(zh, key) !== 'string') {
          const line = src.slice(0, m.index).split('\n').length
          missing.push(`${file.replace(ROOT + '/', '')}:${line} → ${key}`)
        }
      }
    }
    expect(missing, '字典中不存在的键').toEqual([])
  })

  it('自检：检测器能识别缺失的键', () => {
    const sample = `const x = t('account.noSuchKey')`
    const found = [...sample.matchAll(/\b(?:t|i18nT)\(\s*['"]([\w.]+)['"]/g)].map((m) => m[1])
    expect(found).toEqual(['account.noSuchKey'])
    expect(resolve(zh, found[0])).toBeUndefined()
  })
})
