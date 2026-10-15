import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Clock,
  Download,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X
} from 'lucide-react'
import type { TaskSnapshot } from '@shared/types'
import { useTaskStore } from '@/stores/tasks'
import { Badge, Button, Progress } from '@/components/ui/primitives'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn, formatBytes, formatSpeed } from '@/lib/utils'

const STATUS_BADGE: Record<TaskSnapshot['status'], { tone: 'waiting' | 'downloading' | 'paused' | 'success' | 'failed' | 'canceled'; label: string }> = {
  WAITING: { tone: 'waiting', label: '等待中' },
  DOWNLOADING: { tone: 'downloading', label: '下载中' },
  PAUSED: { tone: 'paused', label: '已暂停' },
  SUCCESS: { tone: 'success', label: '完成' },
  FAILED: { tone: 'failed', label: '失败' },
  CANCELED: { tone: 'canceled', label: '已取消' }
}

/** 底部常驻任务栏（docs/09：浏览器下载管理器形态） */
export function TaskDock() {
  const tasks = useTaskStore((s) => s.tasks)
  const expanded = useTaskStore((s) => s.expanded)
  const setExpanded = useTaskStore((s) => s.setExpanded)
  const remove = useTaskStore((s) => s.remove)

  const active = tasks.filter((t) => ['WAITING', 'DOWNLOADING'].includes(t.status))
  const done = tasks.filter((t) => t.status === 'SUCCESS').length
  const failed = tasks.filter((t) => ['FAILED', 'CANCELED'].includes(t.status)).length
  const totalSpeed = active.reduce((acc, t) => acc + (t.speed || 0), 0)
  const overall =
    active.length > 0
      ? active.reduce((acc, t) => acc + t.progress, 0) / Math.max(1, active.length)
      : 0

  const hasCompleted = tasks.some((t) => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'CANCELED')
  const completedCount = tasks.filter((t) => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'CANCELED').length
  const [confirmClear, setConfirmClear] = useState(false)
  const clearCompleted = () => {
    const completed = tasks.filter((t) => t.status === 'SUCCESS' || t.status === 'FAILED' || t.status === 'CANCELED')
    for (const t of completed) remove(t.id)
    setConfirmClear(false)
  }

  return (
    <div className="shrink-0 border-t border-app bg-app">
      {/* 汇总条 */}
      <button
        className="flex h-11 w-full items-center gap-3 px-4 text-left hover:bg-surface-hover"
        onClick={() => setExpanded(!expanded)}
      >
        <Download className="h-4 w-4 text-rose-400" />
        <span className="text-sm text-app">
          任务
          <span className="ml-1.5 text-muted">
            {active.length > 0 ? `${active.length} 个进行中` : '空闲'}
            {done > 0 && ` · ${done} 已完成`}
            {failed > 0 && <span className="text-rose-400"> · {failed} 未成功</span>}
          </span>
        </span>
        {active.length > 0 && (
          <span className="text-xs text-subtle">{formatSpeed(totalSpeed)}</span>
        )}
        {(active.length > 0 || done > 0) && (
          <div className="hidden max-w-48 flex-1 sm:block">
            <Progress value={active.length > 0 ? overall : 1} className="h-1" />
          </div>
        )}
        <span className="ml-auto flex items-center gap-2">
          {hasCompleted && (
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} title="清除所有已完成/失败/取消的任务">
              <Trash2 className="h-3.5 w-3.5" />
              <span className="ml-1">清除已完成</span>
            </Button>
          )}
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </span>
      </button>

      {/* 任务列表 */}
      <AnimatePresence initial={false}>
        {expanded && tasks.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="max-h-60 space-y-0.5 overflow-y-auto px-2 pb-2">
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 清除已完成：涉及移除任务记录（不可从 UI 恢复），需确认 */}
      <ConfirmDialog
        open={confirmClear}
        title="清除已完成的任务？"
        message={`将移除 ${completedCount} 条已完成/失败/取消的任务记录。此操作不可撤销；已下载到磁盘的文件不受影响。`}
        confirmLabel="清除"
        onConfirm={clearCompleted}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}

function TaskRow({ task }: { task: TaskSnapshot }) {
  // 逐字段选择：selector 返回稳定引用。返回对象字面量会让每帧产生新引用，
  // 触发无限重渲染（React error #185 → 黑屏）。
  const pause = useTaskStore((s) => s.pause)
  const resume = useTaskStore((s) => s.resume)
  const cancel = useTaskStore((s) => s.cancel)
  const retry = useTaskStore((s) => s.retry)
  const remove = useTaskStore((s) => s.remove)
  const s = STATUS_BADGE[task.status]
  const indeterminate = task.status === 'DOWNLOADING' && task.total === 0
  const running = task.status === 'DOWNLOADING'

  return (
    <motion.div
      layout="position"
      className={cn(
        'group flex items-center gap-3 rounded-lg px-2 py-1.5',
        'hover:bg-surface'
      )}
    >
      <div className="w-44 min-w-0 shrink-0">
        <div className="truncate text-xs font-medium text-app">
          {task.author}
          {task.shortcode ? ` · ${task.shortcode}` : ''}
          {task.indexNo > 1 ? ` #${task.indexNo}` : ''}
        </div>
        <div className="truncate text-[10px] text-subtle">{task.destPath}</div>
      </div>

      <Badge tone={s.tone} className="shrink-0">{s.label}</Badge>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* 进行中显示实时进度；完成后保留满格进度条与总量 —— 用户要求
            "达成完全下载也会保留下载进度条的效果"，一眼确认已落盘 */}
        {(running || task.status === 'SUCCESS') && (
          <Progress
            value={task.status === 'SUCCESS' ? 1 : task.progress}
            indeterminate={indeterminate}
            className={task.status === 'SUCCESS' ? '[&>div]:bg-emerald-500' : undefined}
          />
        )}
        <span className="w-28 shrink-0 text-right text-[11px] tabular-nums text-muted">
          {task.total > 0
            ? `${task.status === 'SUCCESS' ? 100 : Math.round(task.progress * 100)}% · ${formatBytes(task.downloaded)}/${formatBytes(task.total)}`
            : formatBytes(task.downloaded)}
          {task.speed > 0 && running && <span className="text-subtle"> · {formatSpeed(task.speed)}</span>}
        </span>
        {task.status === 'FAILED' && task.error && (
          <span className="truncate text-[11px] text-rose-400/90" title={task.error}>
            {task.error}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {task.status === 'WAITING' || task.status === 'DOWNLOADING' ? (
          <Button variant="ghost" size="icon" title="暂停" onClick={() => pause(task.id)}>
            <Pause className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {task.status === 'PAUSED' && (
          <Button variant="ghost" size="icon" title="继续" onClick={() => resume(task.id)}>
            <Play className="h-3.5 w-3.5" />
          </Button>
        )}
        {(task.status === 'FAILED' || task.status === 'CANCELED') && (
          <Button variant="ghost" size="icon" title="重试" onClick={() => retry(task.id)}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        {task.status === 'SUCCESS' && (
          <Button
            variant="ghost"
            size="icon"
            title="打开所在文件夹"
            onClick={() => void window.instadown.revealFile(task.destPath)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        )}
        {['WAITING', 'DOWNLOADING', 'PAUSED'].includes(task.status) && (
          <Button variant="ghost" size="icon" title="取消" onClick={() => cancel(task.id)}>
            <CircleX className="h-3.5 w-3.5" />
          </Button>
        )}
        {['SUCCESS', 'FAILED', 'CANCELED'].includes(task.status) && (
          <Button variant="ghost" size="icon" title="移除记录" onClick={() => remove(task.id)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* 静态状态图标（非 hover 时可见） */}
      <div className="shrink-0">
        {task.status === 'SUCCESS' && <CircleCheck className="h-4 w-4 text-emerald-500" />}
        {task.status === 'WAITING' && <Clock className="h-4 w-4 text-subtle" />}
      </div>
    </motion.div>
  )
}
