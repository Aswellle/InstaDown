import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowUpDown,
  Check,
  CheckSquare,
  CircleHelp,
  Download,
  Film,
  Grid2X2,
  Image as ImageIcon,
  Minimize2,
  RefreshCw,
  Search,
  Square,
  User as UserIcon,
  X,
} from 'lucide-react'
import type { MediaRow } from '@shared/types'
import { cn, formatDate, formatDuration } from '@/lib/utils'
import { Button, Checkbox, Input } from '@/components/ui/primitives'
import { SmartImage } from '@/components/ui/smart-image'

/**
 * 全屏媒体库（独立的视觉模块）。
 *
 * 与侧边栏（单列、适合快速瞄一眼最近下载）互补：全屏视图提供
 * 网格布局 + 类型/作者/日期检索 + 排序 + 多选批量下载，
 * 空间利用率高，能快速触达大量内容中的目标。
 * 点击媒体在**应用内**查看/播放（MediaViewer），全程不跳浏览器。
 */

type TypeFilter = 'all' | 'image' | 'video'
type SortKey = 'date-desc' | 'date-asc' | 'author' | 'size-desc'

const SORT_LABEL: Record<SortKey, string> = {
  'date-desc': '最新优先',
  'date-asc': '最早优先',
  author: '按作者',
  'size-desc': '尺寸优先'
}

export function LibraryFullscreen({
  open,
  onClose,
  onGoHome,
  items,
  loading,
  onOpenItem,
  onDownloadMany,
  onRefresh
}: {
  open: boolean
  onClose: () => void
  /** 返回主页面（清空解析结果回到初始页） */
  onGoHome: () => void
  items: MediaRow[]
  loading: boolean
  /** 应用内查看（大图/播放），不跳浏览器 */
  onOpenItem: (item: MediaRow) => void
  onDownloadMany: (items: MediaRow[]) => void
  onRefresh: () => void
}) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [author, setAuthor] = useState<string>('all')
  const [sort, setSort] = useState<SortKey>('date-desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [authorsOpen, setAuthorsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setSelected(new Set())
      setAuthorsOpen(false)
      setHelpOpen(false)
    }
  }, [open])

  // Esc 逐级退出：先关帮助/下拉，再清多选，最后关面板
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (helpOpen) setHelpOpen(false)
      else if (authorsOpen) setAuthorsOpen(false)
      else if (selected.size > 0) setSelected(new Set())
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, selected.size, authorsOpen, helpOpen, onClose])

  const authors = useMemo(() => {
    const counts = new Map<string, number>()
    for (const it of items) {
      const a = it.author || '未知作者'
      counts.set(a, (counts.get(a) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = items
    if (author !== 'all') list = list.filter((i) => (i.author || '未知作者') === author)
    if (typeFilter !== 'all') list = list.filter((i) => i.type === typeFilter)
    if (q) {
      list = list.filter(
        (i) =>
          (i.author || '').toLowerCase().includes(q) ||
          (i.shortcode || '').toLowerCase().includes(q) ||
          (i.caption || '').toLowerCase().includes(q)
      )
    }
    const sorted = [...list]
    switch (sort) {
      case 'date-asc':
        sorted.sort((a, b) => a.created_at - b.created_at)
        break
      case 'author':
        sorted.sort(
          (a, b) => (a.author || '').localeCompare(b.author || '') || b.created_at - a.created_at
        )
        break
      case 'size-desc':
        sorted.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))
        break
      default:
        sorted.sort((a, b) => b.created_at - a.created_at)
    }
    return sorted
  }, [items, search, typeFilter, author, sort])

  const toggleSelect = (id: string, additive: boolean) => {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllFiltered = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((i) => i.id)))
  }

  const imgCount = items.filter((i) => i.type === 'image').length
  const vidCount = items.filter((i) => i.type === 'video').length

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[55] flex flex-col bg-app"
        >
          {/* ───────────── 顶栏：标题 + 统计 + 搜索 + 过滤 + 排序 ───────────── */}
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-app px-4">
            {/* 退出入口：醒目的返回按钮（回到主页面）—— 全屏模块必须有
                清晰的"回去"路径，只靠右上角收起/Esc 用户会迷路 */}
            <button
              onClick={onGoHome}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-app px-3 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-app"
              title="返回主页面（同时收起全屏库）"
            >
              <ArrowLeft className="h-4 w-4" /> 返回主页
            </button>

            <Grid2X2 className="h-5 w-5 shrink-0 text-rose-500" />
            <div className="shrink-0">
              <div className="text-sm font-semibold text-app">媒体库</div>
              <div className="text-[11px] text-subtle">
                {items.length} 项 · 图片 {imgCount} · 视频 {vidCount}
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索作者 / shortcode / 文件名…"
                className="h-9 pl-9"
              />
            </div>

            {/* 类型过滤 */}
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-app p-0.5">
              {(
                [
                  ['all', '全部', null],
                  ['image', '图片', ImageIcon],
                  ['video', '视频', Film]
                ] as Array<[TypeFilter, string, typeof ImageIcon | null]>
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  onClick={() => setTypeFilter(value)}
                  className={cn(
                    'flex h-7 items-center gap-1 rounded-md px-2.5 text-xs transition-colors',
                    typeFilter === value
                      ? 'bg-rose-500 text-white'
                      : 'text-muted hover:bg-surface-hover hover:text-app'
                  )}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {label}
                </button>
              ))}
            </div>

            {/* 作者过滤（下拉） */}
            <div className="relative shrink-0">
              <button
                onClick={() => setAuthorsOpen((v) => !v)}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-lg border border-app px-2.5 text-xs transition-colors hover:bg-surface-hover',
                  author !== 'all' && 'border-rose-500/60 text-app'
                )}
                title="按作者过滤"
              >
                <UserIcon className="h-3.5 w-3.5" />
                <span className="max-w-28 truncate">
                  {author === 'all' ? '全部作者' : author}
                </span>
              </button>
              <AnimatePresence>
                {authorsOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-10 z-10 max-h-80 w-56 overflow-y-auto rounded-xl border border-app bg-surface py-1 shadow-2xl"
                  >
                    <AuthorOption
                      label={`全部作者（${items.length}）`}
                      active={author === 'all'}
                      onClick={() => {
                        setAuthor('all')
                        setAuthorsOpen(false)
                      }}
                    />
                    {authors.map(([name, count]) => (
                      <AuthorOption
                        key={name}
                        label={`${name}（${count}）`}
                        active={author === name}
                        onClick={() => {
                          setAuthor(name)
                          setAuthorsOpen(false)
                        }}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 排序（循环切换） */}
            <button
              onClick={() => {
                const order: SortKey[] = ['date-desc', 'date-asc', 'author', 'size-desc']
                const i = order.indexOf(sort)
                setSort(order[(i + 1) % order.length])
              }}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-app px-2.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-app"
              title="切换排序方式"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {SORT_LABEL[sort]}
            </button>

            <div className="flex shrink-0 items-center gap-1">
              {/* 快捷键/操作提示（隐藏操作的可见化） */}
              <Button variant="ghost" size="icon" onClick={() => setHelpOpen(true)} title="操作说明（快捷键）">
                <CircleHelp className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onRefresh} title="刷新媒体库">
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button variant="secondary" size="sm" onClick={onClose} title="收起全屏库，回到之前页面 (Esc)">
                <Minimize2 className="h-4 w-4" /> 收起
              </Button>
            </div>
          </div>

          {/* ───────────── 内容区 ───────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-subtle">
                加载中…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-subtle">
                <Grid2X2 className="mb-3 h-10 w-10" />
                <p className="text-sm">
                  {items.length === 0 ? '媒体库为空，下载的媒体会出现在这里' : '没有匹配的内容'}
                </p>
                {items.length > 0 && (
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => { setSearch(''); setTypeFilter('all'); setAuthor('all') }}>
                    清除过滤条件
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 p-4">
                {filtered.map((item, idx) => (
                  <FullscreenCard
                    key={item.id}
                    item={item}
                    index={idx}
                    selected={selected.has(item.id)}
                    selectionMode={selected.size > 0}
                    onToggle={(additive) => toggleSelect(item.id, additive)}
                    onOpen={() => onOpenItem(item)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ───────────── 底部批量操作栏 ───────────── */}
          <AnimatePresence>
            {(selected.size > 0 || filtered.length > 0) && (
              <motion.div
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="flex h-12 shrink-0 items-center gap-3 border-t border-app px-4"
              >
                <button
                  onClick={selectAllFiltered}
                  className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-app"
                  title="全选当前筛选结果 (再点取消)"
                >
                  {selected.size === filtered.length && filtered.length > 0 ? (
                    <CheckSquare className="h-4 w-4 text-rose-500" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  {selected.size === filtered.length && filtered.length > 0 ? '取消全选' : '全选结果'}
                </button>
                <span className="text-xs text-subtle">
                  {selected.size > 0 ? `已选 ${selected.size} / ${filtered.length}` : `共 ${filtered.length} 项`}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {selected.size > 0 && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        onDownloadMany(filtered.filter((i) => selected.has(i.id)))
                        setSelected(new Set())
                      }}
                    >
                      <Download className="h-4 w-4" />
                      下载所选（{selected.size}）
                    </Button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 操作说明（快捷键/鼠标操作可见化） */}
          <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function AuthorOption({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
        active ? 'bg-rose-500/10 text-app' : 'text-muted hover:bg-surface-hover hover:text-app'
      )}
    >
      <Check className={cn('h-3.5 w-3.5', active ? 'text-rose-500' : 'opacity-0')} />
      <span className="truncate">{label}</span>
    </button>
  )
}

/** 操作说明弹层：把快捷键与鼠标操作从"隐藏知识"变成可见提示 */
function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  const rows: Array<[string, string]> = [
    ['单击卡片', '打开应用内查看器（图片/视频都在应用内，不跳浏览器）'],
    ['Ctrl/Shift + 单击', '多选卡片（再点取消）；多选态下单击即切换选中'],
    ['底部「全选结果」', '选中当前筛选出的全部内容，可一键批量下载'],
    ['← → 方向键', '查看器内上一张 / 下一张'],
    ['Enter', '查看器内下载当前媒体'],
    ['Esc', '逐级退出：帮助/下拉 → 清除多选 → 关闭查看器 → 收起全屏库'],
    ['筛选 + 排序', '类型（全部/图片/视频）、作者下拉、四种排序循环切换'],
  ]
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-app bg-surface p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-app">操作说明</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-subtle hover:bg-surface-hover hover:text-app"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {rows.map(([key, desc]) => (
            <div key={key} className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0 rounded-md border border-app bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-app">
                {key}
              </span>
              <span className="text-xs leading-relaxed text-muted">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function FullscreenCard({
  item,
  index,
  selected,
  selectionMode,
  onToggle,
  onOpen
}: {
  item: MediaRow
  index: number
  selected: boolean
  selectionMode: boolean
  onToggle: (additive: boolean) => void
  onOpen: () => void
}) {
  const thumb = item.thumb_url || item.url
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.012, 0.2), ease: 'easeOut' }}
      style={{ contentVisibility: 'auto' }}
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-xl border bg-surface transition-colors',
        selected ? 'border-rose-500 ring-2 ring-rose-500/40' : 'border-app hover:border-app-strong'
      )}
      onClick={(e) => {
        // 多选态下单击即切换选中；普通态单击打开查看器
        if (selectionMode || e.ctrlKey || e.metaKey || e.shiftKey) {
          onToggle(e.ctrlKey || e.metaKey || e.shiftKey)
        } else {
          onOpen()
        }
      }}
    >
      <div className="aspect-square w-full bg-surface-hover">
        {/* 视频缩略场景显示封面帧（thumb_url 或远端 poster），点击后才进查看器播放；
            直接嵌播放器会因 CDN 链接过期一片报错，且多个自动播放互相抢资源 */}
        <SmartImage src={thumb} className="h-full w-full object-cover" />
      </div>

      {/* 类型角标（固定深色底 → 字面量白，勿用主题色） */}
      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-1 text-[10px] text-white backdrop-blur-sm">
        {item.type === 'video' ? (
          <>
            <Film className="h-3 w-3" />
            {item.duration ? <span>{formatDuration(item.duration)}</span> : null}
          </>
        ) : (
          <ImageIcon className="h-3 w-3" />
        )}
      </div>

      {/* 选中态勾选框 */}
      <div
        className={cn(
          'absolute right-2 top-2 transition-opacity',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <Checkbox checked={selected} />
      </div>

      {/* 底部信息（固定深色遮罩 → 字面量白） */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-6">
        <div className="truncate text-[11px] font-medium text-white">
          {item.author || '未知作者'}
        </div>
        <div className="truncate text-[10px] text-white/70">
          {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
          {formatDate(item.created_at)}
        </div>
      </div>
    </motion.div>
  )
}
