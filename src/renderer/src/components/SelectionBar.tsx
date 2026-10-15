import { AnimatePresence, motion } from 'framer-motion'
import { Download, ListChecks, X } from 'lucide-react'
import { Button } from '@/components/ui/primitives'

/**
 * 批量多选操作面板（悬浮于网格之上）。
 *
 * 可读性要求（浅色/深色都要清晰）：
 * - 面板必须**不透明**：此前用 `bg-surface/95` + backdrop-blur，网格的
 *   缩略图会透上来，导致面板上的文字对比度骤降（用户反馈"字体不清晰"）。
 * - 强调色不能只用 rose-400：它在浅色底上对比不足（约 2.6:1），
 *   改为浅色 rose-600 / 深色 rose-400 两套。
 * - 描边 + 阴影双层，保证在浅色与深色页面上都能与背景分离。
 */
export function SelectionBar({
  count,
  total,
  onDownload,
  onSelectAll,
  onClear
}: {
  count: number
  total: number
  onDownload: () => void
  onSelectAll: () => void
  onClear: () => void
}) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="pointer-events-auto absolute inset-x-0 bottom-4 z-30 mx-auto flex w-fit items-center gap-1.5 rounded-2xl border border-app-strong bg-surface px-3 py-2 shadow-2xl shadow-black/25 ring-1 ring-black/5 dark:ring-white/5"
        >
          <span className="flex items-baseline gap-1 px-1.5 text-sm text-app">
            <span className="text-muted">已选</span>
            <span className="text-base font-semibold tabular-nums text-rose-600 dark:text-rose-400">
              {count}
            </span>
            <span className="text-muted">/ {total}</span>
          </span>

          <div className="mx-1 h-5 w-px bg-app-strong" />

          <Button variant="primary" size="sm" onClick={onDownload}>
            <Download className="h-4 w-4" /> 下载所选
          </Button>
          <Button variant="secondary" size="sm" onClick={onSelectAll} title="全选 (Ctrl+A)">
            <ListChecks className="h-4 w-4" /> 全选
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear} title="清除选择 (Esc)">
            <X className="h-4 w-4" /> 清除
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
