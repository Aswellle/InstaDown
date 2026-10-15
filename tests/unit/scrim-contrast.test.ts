import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 回归测试：深色遮罩上的文字不能用主题色 token。
 *
 * 背景：媒体卡片角标与底部信息条位于**固定深色遮罩**（`bg-black/65`、
 * `from-black/75`）之上。主题语义色（text-app / text-muted / text-subtle）
 * 在浅色模式下是深色文字，贴在深色遮罩上几乎不可见 —— 曾导致浅色模式
 * 下"图片标识对比度弱、可见度低"（用户反馈）。
 *
 * 正确做法：这些位置一律使用字面量 `text-white` / `text-white/90`。
 *
 * 同时校验：悬浮操作面板不能用半透明背景（`bg-surface/95` + backdrop-blur），
 * 否则网格缩略图会透上来，面板文字对比度骤降。
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

/** 深色遮罩的类名特征 */
const SCRIM = /(bg-black\/\d+|from-black\/\d+)/

describe('深色遮罩上的文字必须用字面量白色（浅色模式可读性回归）', () => {
  const files = collectSourceFiles(RENDERER_SRC)

  it('渲染层存在可扫描文件', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('遮罩容器内不出现主题色文字 token', () => {
    const violations: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const lines = src.split('\n')
      lines.forEach((line, i) => {
        if (!SCRIM.test(line)) return
        // 同一行同时出现主题色文字 token → 违规
        const bad = /(text-app|text-muted|text-subtle)/.exec(line)
        if (bad) {
          violations.push(`${file.replace(process.cwd(), '')}:${i + 1} → ${bad[0]}`)
        }
      })
    }
    expect(violations, `遮罩上用主题色文字，浅色模式下不可见：\n${violations.join('\n')}`).toEqual(
      []
    )
  })

  it('悬浮操作面板不使用半透明背景', () => {
    const bar = join(RENDERER_SRC, 'components', 'SelectionBar.tsx')
    const src = readFileSync(bar, 'utf8')
    // 允许在注释里提到历史写法，但 className 中不能出现
    const classNames = src.match(/className="[^"]*"/g) ?? []
    const offenders = classNames.filter((c) => /bg-(surface|app)\/\d+/.test(c))
    expect(offenders, `悬浮面板半透明会让背景透上来：${offenders.join(', ')}`).toEqual([])
  })
})
