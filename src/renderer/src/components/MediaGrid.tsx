import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleCheck,
  Copy,
  Download,
  ExternalLink,
  Film,
  FolderOpen,
  ImageIcon,
  Loader2,
  Play
} from 'lucide-react'
import type { MediaItem } from '@shared/types'
import { useTaskStore } from '@/stores/tasks'
import { Checkbox } from '@/components/ui/primitives'
import { SmartImage } from '@/components/ui/smart-image'
import { cn, formatDate, formatDuration } from '@/lib/utils'
import { AnimatePresence, motion } from 'framer-motion'
import { useI18n } from '@/i18n'

export function MediaGrid({
  items,
  selected,
  onToggle,
  onOpen,
  onCopyLink,
  onDownloadItem,
  onOpenInBrowser,
  onRevealFile
}: {
  items: MediaItem[]
  selected: Set<string>
  onToggle: (id: string, e: React.MouseEvent) => void
  onOpen: (item: MediaItem) => void
  onCopyLink: (item: MediaItem) => void
  onDownloadItem: (item: MediaItem) => void
  onOpenInBrowser: (item: MediaItem) => void
  onRevealFile: (item: MediaItem) => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; item: MediaItem } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // 关闭菜单
  const closeMenu = () => setMenu(null)

  // 点击外部关闭
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    const onScroll = () => closeMenu()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [menu]) // eslint-disable-line react-hooks/exhaustive-deps

  // 选中变化时关闭
  useEffect(() => {
    closeMenu()
  }, [selected])

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3 pb-4">
      {items.map((item, i) => (
        <MediaCard
          key={item.id}
          item={item}
          index={i}
          selected={selected.has(item.id)}
          onToggle={onToggle}
          onOpen={onOpen}
          onContextMenu={(e, item) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, item })
          }}
        />
      ))}

      <AnimatePresence>
        {menu && (
          <ContextMenu
            ref={menuRef}
            x={menu.x}
            y={menu.y}
            item={menu.item}
            onClose={closeMenu}
            onCopyLink={onCopyLink}
            onDownloadItem={onDownloadItem}
            onOpenInBrowser={onOpenInBrowser}
            onRevealFile={onRevealFile}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function MediaCard({
  item,
  index,
  selected,
  onToggle,
  onOpen,
  onContextMenu
}: {
  item: MediaItem
  index: number
  selected: boolean
  onToggle: (id: string, e: React.MouseEvent) => void
  onOpen: (item: MediaItem) => void
  onContextMenu: (e: React.MouseEvent, item: MediaItem) => void
}) {
  // 选择器只返回稳定引用（tasks 数组本身）；派生 Map 在 useMemo 中做。
  // 直接在 selector 里 new Map(...) 会每帧返回新引用，触发无限重渲染
  // （React error #185 → 整树卸载 → 黑屏）。
  const tasks = useTaskStore((s) => s.tasks)
  const taskStatusById = useMemo(() => {
    const m = new Map<string | null, string>()
    for (const t of tasks) m.set(t.mediaId, t.status)
    return m
  }, [tasks])
  const thumb = item.thumb_url || item.url
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.015, 0.25), ease: 'easeOut' }}
      style={{ contentVisibility: 'auto' }}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-xl border bg-surface transition-colors',
        selected ? 'border-rose-500 ring-2 ring-rose-500/40' : 'border-app hover:border-app-strong'
      )}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        onToggle(item.id, e)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onOpen(item)
      }}
      onContextMenu={(e) => onContextMenu(e, item)}
    >
      <div className="aspect-square w-full bg-surface-hover">
        <SmartImage src={thumb} className="h-full w-full object-cover" />
      </div>

      {/* 类型角标 */}
      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-1 text-[10px] text-white backdrop-blur-sm">
        {item.type === 'video' ? (
          <>
            <Play className="h-3 w-3" />
            {item.duration ? <span>{formatDuration(item.duration)}</span> : <Film className="h-3 w-3" />}
          </>
        ) : (
          <ImageIcon className="h-3 w-3" />
        )}
      </div>

      {/* 勾选框 */}
      <div
        className={cn(
          'absolute right-2 top-2 transition-opacity',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <Checkbox checked={selected} />
      </div>

      {/* 底部信息 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6">
        <div className="truncate text-[11px] text-white/90">
          {item.width && item.height ? `${item.width}×${item.height}` : ''}
          {item.taken_at ? ` · ${formatDate(item.taken_at)}` : ''}
        </div>
      </div>

      {/* 下载状态指示 */}
      {(() => {
        const st = taskStatusById.get(item.id)
        if (!st) return null
        if (st === 'SUCCESS')
          return (
            <div className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-emerald-500/20 p-1 backdrop-blur">
              <CircleCheck className="h-3.5 w-3.5 text-emerald-400" />
            </div>
          )
        if (st === 'DOWNLOADING' || st === 'WAITING')
          return (
            <div className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-sky-500/20 p-1 backdrop-blur">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
            </div>
          )
        return null
      })()}
    </motion.div>
  )
}

// ─── Context Menu ────────────────────────────────────────────────


interface ContextMenuProps {
  x: number
  y: number
  item: MediaItem
  onClose: () => void
  onCopyLink: (item: MediaItem) => void
  onDownloadItem: (item: MediaItem) => void
  onOpenInBrowser: (item: MediaItem) => void
  onRevealFile: (item: MediaItem) => void
}

const ContextMenu = forwardRef<HTMLDivElement, ContextMenuProps>(function ContextMenu(
  { x, y, item, onClose, onCopyLink, onDownloadItem, onOpenInBrowser, onRevealFile },
  ref
) {
  const { t } = useI18n()
  const tasks = useTaskStore((s) => s.tasks)
  const taskStatusById = useMemo(() => {
    const m = new Map<string | null, string>()
    for (const t of tasks) m.set(t.mediaId, t.status)
    return m
  }, [tasks])
  const isDownloaded = taskStatusById.get(item.id) === 'SUCCESS'

  const handleClick = (action: () => void) => {
    action()
    onClose()
  }

  // 防止菜单超出视口
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 180),
    zIndex: 9999
  }

  return (
    <div
      ref={ref}
      style={menuStyle}
      className="min-w-[160px] overflow-hidden rounded-lg border border-app-strong bg-surface-hover py-1 shadow-xl shadow-black/40"
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem icon={Copy} label={t("grid.copyLink")} onClick={() => handleClick(() => onCopyLink(item))} />
      <MenuItem icon={Download} label={t("viewer.downloadThis")} onClick={() => handleClick(() => onDownloadItem(item))} />
      <MenuItem icon={ExternalLink} label={t("grid.openInBrowser")} onClick={() => handleClick(() => onOpenInBrowser(item))} />
      {isDownloaded && (
        <>
          <div className="mx-2 my-1 border-t border-app-strong" />
          <MenuItem icon={FolderOpen} label={t("grid.revealFile")} onClick={() => handleClick(() => onRevealFile(item))} />
        </>
      )}
    </div>
  )
})

function MenuItem({
  icon: Icon,
  label,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-app transition-colors hover:bg-surface-active/70 active:bg-surface-active"
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5 text-muted" />
      {label}
    </button>
  )
}
