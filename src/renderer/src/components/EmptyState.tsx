import { Aperture, MousePointerClick, Download, FolderTree } from 'lucide-react'
import { motion } from 'framer-motion'

const STEPS = [
  { icon: Aperture, title: '粘贴链接', desc: '帖子 / Reels / 主页链接，或直接输入用户名' },
  { icon: MousePointerClick, title: '预览并选择', desc: '点击卡片选择，Shift 连选，双击放大预览' },
  { icon: Download, title: '批量下载', desc: '最高质量原档保存，断点续传 · 自动归类' },
  { icon: FolderTree, title: '本地管理', desc: '按 用户名/日期/类型 归档，可随时回访' }
]

export function EmptyState({ onExample }: { onExample: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 pb-16">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center text-center"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-400 shadow-lg shadow-rose-500/20">
          <Aperture className="h-8 w-8 text-white" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-app">本地优先的 Instagram 媒体归档</h1>
        <p className="mt-2 max-w-md text-sm text-muted">
          支持图片、Carousel 多图、Reels 视频与 Stories（需登录会话）。
          全部解析在本地完成，不上传任何数据。
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-subtle">
          试试：
          <Chip onClick={() => onExample('instagram')}>instagram</Chip>
          <Chip onClick={() => onExample('https://www.instagram.com/instagram/')}>@instagram 主页</Chip>
          <Chip onClick={() => onExample('https://www.instagram.com/p/B1LbfVPlwIA/')}>示例帖子</Chip>
        </div>
      </motion.div>

      <div className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {STEPS.map((s, i) => (
          <motion.div
            key={s.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.08 + i * 0.06 }}
            className="flex items-start gap-3 rounded-xl border border-app bg-surface/50 p-3.5"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
              <s.icon className="h-4.5 w-4.5 text-rose-400" />
            </div>
            <div>
              <div className="text-sm font-medium text-app">
                {i + 1}. {s.title}
              </div>
              <div className="mt-0.5 text-xs text-subtle">{s.desc}</div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-app-strong px-2.5 py-1 text-xs text-muted transition-colors hover:border-rose-500/60 hover:text-rose-300"
    >
      {children}
    </button>
  )
}
