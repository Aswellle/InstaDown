import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 回归测试：drag-region 内的交互元素必须加 no-drag。
 *
 * 背景：Electron 的 `-webkit-app-region: drag` 会把该区域当作窗口拖拽手柄，
 * **吞掉所有鼠标事件**（hover / click / focus）。若把 button/input 直接放在
 * drag-region 内而不加 `no-drag`，真机上点击完全无反应，也没有 hover 样式变化。
 *
 * 危险点：自动化测试用 JS 直接调 `el.click()` 会绕过原生命中检测，
 * 因此这类 bug 能通过全部自动化测试却在真人使用时 100% 失效
 * （曾导致左上角"下载历史/媒体库"与右上角"设置"按钮全部不可用）。
 */

const RENDERER_SRC = join(process.cwd(), 'src', 'renderer', 'src')

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...collectSourceFiles(p))
    else if (/\.tsx$/.test(name)) out.push(p)
  }
  return out
}

/**
 * 检查文件中的 drag-region 容器：返回其中缺少 no-drag 的交互元素描述。
 * 采用简化的 JSX 扫描：找到带 drag-region 的容器起止范围，
 * 在其中查找 button/input/select/textarea/<a 且同一 className 不含 no-drag 的元素。
 */
function findUnprotectedInteractive(file: string, source: string): string[] {
  const issues: string[] = []
  const lines = source.split('\n')
  const interactive = /<(button|input|select|textarea|a)\b/

  // 收集 drag-region 容器：从出现处起，按标签缩进/闭合大致界定范围
  for (let i = 0; i < lines.length; i++) {
    if (!/drag-region/.test(lines[i])) continue
    // 该容器可能是自闭合或需要向后找若干行（同缩进的闭合标签）
    const indent = lines[i].match(/^\s*/)?.[0].length ?? 0
    let end = i + 1
    for (let j = i + 1; j < lines.length; j++) {
      const cur = lines[j]
      const curIndent = cur.match(/^\s*/)?.[0].length ?? 0
      if (/^\s*<\//.test(cur) && curIndent <= indent) {
        end = j
        break
      }
      if (end === j) end = j
    }

    for (let j = i + 1; j <= Math.min(end, lines.length - 1); j++) {
      const line = lines[j]
      if (!interactive.test(line)) continue
      // 该元素自身的 className 是否含 no-drag（同行或后续 3 行内）
      const window = lines.slice(j, j + 4).join(' ')
      const hasNoDrag = /no-drag/.test(window)
      // 被 no-drag 祖先包裹的情况：向上找最近的 className 含 no-drag 的容器
      let insideNoDrag = false
      for (let k = j - 1; k >= Math.max(0, i); k--) {
        if (/no-drag/.test(lines[k])) {
          const kIndent = lines[k].match(/^\s*/)?.[0].length ?? 0
          const jIndent = lines[j].match(/^\s*/)?.[0].length ?? 0
          if (kIndent < jIndent) {
            insideNoDrag = true
            break
          }
        }
      }
      if (!hasNoDrag && !insideNoDrag) {
        issues.push(`${file.replace(process.cwd(), '.')}:${j + 1} ${line.trim().slice(0, 70)}`)
      }
    }
  }
  return issues
}

describe('drag-region 交互元素保护（防"点击无反应"回归）', () => {
  const files = collectSourceFiles(RENDERER_SRC)

  it('存在可扫描文件', () => {
    expect(files.length).toBeGreaterThan(3)
  })

  it('drag-region 内的交互元素都有 no-drag', () => {
    const issues: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!/drag-region/.test(src)) continue
      issues.push(...findUnprotectedInteractive(f, src))
    }
    expect(issues).toEqual([])
  })

  it('自检：检测器能识别未保护的交互元素', () => {
    const bad = `
      <div className="drag-region flex">
        <button className="rounded p-2" onClick={x}>A</button>
      </div>
    `
    const good = `
      <div className="drag-region flex">
        <button className="no-drag rounded p-2" onClick={x}>A</button>
      </div>
    `
    const wrapped = `
      <div className="drag-region flex">
        <div className="no-drag">
          <button className="rounded p-2">A</button>
        </div>
      </div>
    `
    expect(findUnprotectedInteractive('t.tsx', bad).length).toBe(1)
    expect(findUnprotectedInteractive('t.tsx', good)).toEqual([])
    expect(findUnprotectedInteractive('t.tsx', wrapped)).toEqual([])
  })
})
