import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/primitives'
import { useI18n } from '@/i18n'

/**
 * 破坏性操作确认框（模态）。
 *
 * 用于清空历史 / 清空缓存 / 退出登录 / 删除任务等不可轻易撤销的操作，
 * 防止误触或好奇点击造成无法挽回的结果。Enter 确认、Esc 取消；
 * 焦点默认落在"确认"上（Enter 直接执行是此类对话框的通行惯例），
 * 鼠标用户则会先看到醒目的红色按钮而非一划就点到的默认位置。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = true,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** true = 红色确认按钮（删除/清空类）；false = 常规主色 */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onConfirm, onCancel])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onCancel()
          }}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl border border-app bg-surface p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div
                className={
                  danger
                    ? 'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500/10'
                    : 'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/10'
                }
              >
                <AlertTriangle
                  className={danger ? 'h-4 w-4 text-rose-500' : 'h-4 w-4 text-sky-500'}
                />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-app">{title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">{message}</p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onCancel}>
                {cancelLabel}
              </Button>
              <Button
                autoFocus
                variant={danger ? 'primary' : 'secondary'}
                size="sm"
                className={danger ? 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700' : undefined}
                onClick={onConfirm}
              >
                {confirmLabel ?? t('common.confirm')}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
