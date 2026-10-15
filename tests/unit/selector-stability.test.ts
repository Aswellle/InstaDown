import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 回归测试：禁止「不稳定 selector」反模式。
 *
 * 背景：Zustand v5 用 Object.is 比较 selector 返回值。若 selector 每次渲染都返回
 * 新引用（对象/数组字面量、new Map/Set、map/filter 等），React 会判定状态持续变化
 * 并陷入无限重渲染，最终抛 React error #185（Maximum update depth exceeded），
 * 导致整个 React 树被卸载 —— 表现为「黑屏崩溃」。
 *
 * 曾出现的实例：
 *   useTaskStore((s) => new Map(s.tasks.map(...)))            // MediaGrid 每张卡片
 *   useTaskStore((s) => ({ pause: s.pause, ... }))            // TaskDock
 *
 * 正确写法：selector 只取原始值（s.x），派生数据用 useMemo 在组件内完成。
 */

const RENDERER_SRC = join(process.cwd(), 'src', 'renderer', 'src')

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...collectSourceFiles(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** 匹配 selector 内返回新引用的写法 */
function findUnstableSelectors(source: string): string[] {
  const violations: string[] = []
  const lines = source.split('\n')
  lines.forEach((line, i) => {
    // 形如 useXxxStore((s) => ...)，且同一行出现新建引用
    const hasStoreSelector = /use[A-Za-z]*Store\s*\(\s*\(?\s*\w+\s*\)?\s*=>/.test(line)
    if (!hasStoreSelector) return
    const unstable =
      /=>\s*\(\{/.test(line) || // 返回对象字面量
      /=>\s*\[/.test(line) || // 返回数组字面量
      /=>\s*new\s+(Map|Set|Array|Object)\b/.test(line) // 返回新建容器
    if (unstable) {
      violations.push(`${line.trim()} (line ${i + 1})`)
    }
  })
  return violations
}

describe('Zustand selector 稳定性（防黑屏回归）', () => {
  const files = collectSourceFiles(RENDERER_SRC)

  it('渲染层源码存在可扫描文件', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('不存在返回新引用的不稳定 selector', () => {
    const allViolations: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const violations = findUnstableSelectors(src)
      for (const v of violations) {
        allViolations.push(`${file.replace(process.cwd(), '.')}: ${v}`)
      }
    }
    expect(allViolations).toEqual([])
  })

  it('自检：检测器能识别反模式', () => {
    const bad = `
      const x = useTaskStore((s) => new Map(s.tasks.map((t) => [t.id, t.status])))
      const y = useTaskStore((s) => ({ a: s.a, b: s.b }))
      const z = useStore((s) => [s.a, s.b])
    `
    expect(findUnstableSelectors(bad).length).toBe(3)
    const good = `
      const tasks = useTaskStore((s) => s.tasks)
      const fn = useTaskStore((s) => s.doSomething)
    `
    expect(findUnstableSelectors(good)).toEqual([])
  })
})
