import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  X,
  Trash2,
  FolderOpen,
  RotateCcw,
  Copy,
  History as HistoryIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import type { HistoryRow } from '@shared/types'
import { formatBytes, formatDate } from '@/lib/utils'
import { FileThumb } from '@/components/ui/file-thumb'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface HistoryPanelProps {
  open: boolean
  onClose: () => void
}

export function HistoryPanel({ open, onClose }: HistoryPanelProps) {
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const fetchHistory = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await window.instadown.getHistory()
      setHistory(rows)
    } catch {
      toast.error('获取历史记录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchHistory()
    }
  }, [open, fetchHistory])

  const handleReveal = useCallback(async (path: string) => {
    try {
      await window.instadown.revealFile(path)
    } catch {
      toast.error('无法打开文件夹')
    }
  }, [])

  const handleOpenFile = useCallback(async (path: string) => {
    try {
      await window.instadown.openFile(path)
    } catch {
      toast.error('无法打开文件')
    }
  }, [])

  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      toast.success('路径已复制')
    } catch {
      toast.error('复制失败')
    }
  }, [])

  const handleReDownload = useCallback(() => {
    toast.info('请重新解析原始链接以下载')
  }, [])

  const handleClearHistory = useCallback(async () => {
    try {
      await window.instadown.clearHistory()
      setHistory([])
      setConfirmClear(false)
      toast.success('历史记录已清空')
    } catch {
      toast.error('清空失败')
    }
  }, [])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* 用 absolute（相对主内容区）而非 fixed：fixed top-0 会盖住顶部
              标题栏与 Windows 原生窗口控制按钮，导致按钮样式/位置异常。 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-40 bg-overlay"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="absolute left-0 top-0 z-50 flex h-full w-80 flex-col border-r border-app bg-app"
          >
            {/* Header */}
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-app px-4">
              <HistoryIcon className="h-4 w-4 text-rose-400" />
              <span className="text-sm font-medium text-app">下载历史</span>
              <span className="text-xs text-subtle">{history.length} 条</span>
              <div className="ml-auto flex items-center gap-1">
                {history.length > 0 && (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-hover/60 hover:text-app"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    清空
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="rounded-md p-1 text-muted hover:bg-surface-hover/60 hover:text-app"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-sm text-subtle">
                  加载中…
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-subtle">
                  <HistoryIcon className="mb-2 h-8 w-8" />
                  <span className="text-sm">暂无下载记录</span>
                </div>
              ) : (
                <div className="space-y-1 p-2">
                  {history.map((row) => (
                    <HistoryItem
                      key={row.id}
                      row={row}
                      onOpen={handleOpenFile}
                      onReveal={handleReveal}
                      onCopy={handleCopyPath}
                      onReDownload={handleReDownload}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}

      {/* 清空历史：破坏性操作必须确认（防误触；文件本身不受影响） */}
      <ConfirmDialog
        open={confirmClear}
        title="清空下载历史？"
        message={`将删除全部 ${history.length} 条历史记录。此操作不可撤销；已下载到磁盘的文件不会被删除。`}
        confirmLabel="清空"
        onConfirm={() => void handleClearHistory()}
        onCancel={() => setConfirmClear(false)}
      />
    </AnimatePresence>
  )
}

function HistoryItem({
  row,
  onOpen,
  onReveal,
  onCopy,
  onReDownload
}: {
  row: HistoryRow
  onOpen: (path: string) => void
  onReveal: (path: string) => void
  onCopy: (path: string) => void
  onReDownload: () => void
}) {
  return (
    <div
      className="group flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-surface-hover"
      onClick={() => onOpen(row.path)}
    >
      {/* 缩略图：图片直接读盘显示，视频/其他显示类型图标 —— 一眼看出每项是什么 */}
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-surface-hover/60">
        <FileThumb path={row.path} className="h-10 w-10 rounded-md" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-app">
          {row.author ?? '未知作者'}
        </div>
        <div className="truncate text-[11px] text-subtle" title={row.path}>
          {row.path.split(/[\\/]/).pop()}
        </div>
        <div className="flex items-center gap-2 text-xs text-subtle">
          <span>{formatDate(row.created_at)}</span>
          <span>·</span>
          <span>{formatBytes(row.size)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onReveal(row.path) }}
          className="rounded p-1 text-muted hover:bg-surface-hover hover:text-app"
          title="在文件夹中显示"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onReDownload() }}
          className="rounded p-1 text-muted hover:bg-surface-hover hover:text-app"
          title="重新下载"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(row.path) }}
          className="rounded p-1 text-muted hover:bg-surface-hover hover:text-app"
          title="复制路径"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
