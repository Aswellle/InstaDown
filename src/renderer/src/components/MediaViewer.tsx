import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Download, Keyboard } from 'lucide-react'
import type { MediaItem } from '@shared/types'
import { Dialog } from '@/components/ui/dialog'
import { Badge, Button } from '@/components/ui/primitives'
import { SmartImage } from '@/components/ui/smart-image'
import { SmartVideo } from '@/components/ui/smart-video'
import { formatDate, formatDuration } from '@/lib/utils'

/**
 * 应用内媒体查看器（docs/01）：图片/视频都在应用内完成浏览与下载，
 * 全程不跳系统浏览器。
 *
 * 快捷键（页脚有可见提示，不要求用户记忆）：
 * ← → 翻页 · Enter 下载当前 · Esc 关闭
 *
 * hideDownload：查看"已下载到本机"的媒体（下载历史）时使用 ——
 * 文件已在磁盘上，下载动作无意义，隐藏按钮与 Enter 提示。
 */
export function MediaViewer({
  items,
  initialIndex,
  onClose,
  onDownload,
  hideDownload = false
}: {
  items: MediaItem[]
  initialIndex: number
  onClose: () => void
  onDownload: (item: MediaItem) => void
  hideDownload?: boolean
}) {
  const [index, setIndex] = useState(initialIndex)
  const [showKeys, setShowKeys] = useState(false)
  const item = items[index] ?? null

  const goPrev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : i)), [])
  const goNext = useCallback(() => setIndex((i) => (i < items.length - 1 ? i + 1 : i)), [items.length])

  useEffect(() => setIndex(initialIndex), [initialIndex])

  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      // 视频播放器聚焦时不劫持方向键（用户可能在拖进度条）
      if ((e.target as HTMLElement)?.tagName === 'VIDEO') return
      if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'Enter' && !hideDownload) {
        e.preventDefault()
        onDownload(item)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, goPrev, goNext, onDownload, hideDownload])

  return (
    <Dialog open={!!item} onClose={onClose} wide>
      {item && (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.15 }}
          className="flex flex-col"
        >
          <div className="relative flex flex-1 items-center justify-center bg-black/80 p-2">
            {item.type === 'video' ? (
              <SmartVideo
                src={item.url}
                poster={item.thumb_url}
                className="max-h-[70vh] max-w-full rounded-lg"
              />
            ) : (
              <SmartImage
                src={item.url}
                className="max-h-[70vh] max-w-full rounded-lg object-contain"
                fallbackClassName="h-40 w-40 rounded-lg"
                loading="eager"
              />
            )}
            {/* 左右悬浮翻页箭头：不必移动鼠标到底部 */}
            {items.length > 1 && index > 0 && (
              <button
                onClick={goPrev}
                title="上一张 (←)"
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/90 opacity-0 transition-opacity hover:bg-black/70 focus:opacity-100 group-hover:opacity-100 [div:hover>&]:opacity-100"
              >
                ‹
              </button>
            )}
            {items.length > 1 && index < items.length - 1 && (
              <button
                onClick={goNext}
                title="下一张 (→)"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/90 opacity-0 transition-opacity hover:bg-black/70 [div:hover>&]:opacity-100"
              >
                ›
              </button>
            )}
          </div>
          {items.length > 1 && (
            <div className="flex items-center justify-center gap-4 border-t border-app/50 py-1.5">
              <Button variant="ghost" size="sm" onClick={goPrev} disabled={index === 0}>‹ 上一张</Button>
              <span className="text-xs text-subtle">{index + 1} / {items.length}</span>
              <Button variant="ghost" size="sm" onClick={goNext} disabled={index === items.length - 1}>下一张 ›</Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-app px-5 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone="neutral">{item.type === 'video' ? '视频' : '图片'}</Badge>
              {item.width && item.height && (
                <span>{item.width}×{item.height}</span>
              )}
              {item.duration ? <span>{formatDuration(item.duration)}</span> : null}
              {item.taken_at ? <span>{formatDate(item.taken_at)}</span> : null}
              {/* 快捷键提示：隐藏操作的可见化（悬停展开完整说明） */}
              <span
                className="group/keys relative flex cursor-default items-center gap-1 text-subtle"
                title={hideDownload ? '← → 翻页 · Esc 关闭' : '← → 翻页 · Enter 下载 · Esc 关闭'}
              >
                <Keyboard className="h-3.5 w-3.5 cursor-pointer" onClick={() => setShowKeys((v) => !v)} />
              </span>
              {showKeys && (
                <span className="text-[11px] text-subtle">
                  {hideDownload ? '← → 翻页 · Esc 关闭' : '← → 翻页 · Enter 下载 · Esc 关闭'}
                </span>
              )}
            </div>
            {!hideDownload && (
              <Button variant="primary" size="sm" onClick={() => onDownload(item)}>
                <Download className="h-4 w-4" /> 下载此媒体
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </Dialog>
  )
}
