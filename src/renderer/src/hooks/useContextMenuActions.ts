import { useCallback } from 'react'
import { toast } from 'sonner'
import type { MediaItem } from '@shared/types'
import { useTaskStore } from '@/stores/tasks'
import { useLibraryStore } from '@/stores/library'

export function useContextMenuActions() {
  const downloadItems = useCallback(async (targets: MediaItem[]) => {
    if (targets.length === 0) return
    const view = useLibraryStore.getState().view
    let author = 'instagram'
    let shortcode = ''
    if (view.mode === 'post') {
      author = view.collection.author.username || 'instagram'
      shortcode = view.collection.source.shortcode ?? ''
    } else if (view.mode === 'profile') {
      author = view.page.user.username
    }
    const payload = targets.map((m, i) => ({
      id: m.id,
      type: m.type,
      url: m.url,
      thumbUrl: m.thumb_url ?? null,
      author,
      shortcode,
      indexNo: shortcode ? i + 1 : 1,
      takenAt: m.taken_at ?? null,
      width: m.width ?? null,
      height: m.height ?? null,
      duration: m.duration ?? null
    }))
    try {
      const { taskIds } = await window.instadown.addDownload(payload)
      toast.success(`已加入下载队列：${taskIds.length} 项`)
    } catch (e) {
      toast.error(`加入队列失败：${(e as Error).message}`)
    }
  }, [])

  const onCopyLink = useCallback(async (item: MediaItem) => {
    try {
      await navigator.clipboard.writeText(item.url)
      toast.success('链接已复制到剪贴板')
    } catch {
      toast.error('复制失败')
    }
  }, [])

  const onDownloadItem = useCallback(
    (item: MediaItem) => {
      void downloadItems([item])
    },
    [downloadItems]
  )

  const onOpenInBrowser = useCallback((item: MediaItem) => {
    window.open(item.url, '_blank', 'noopener,noreferrer')
  }, [])

  const onRevealFile = useCallback((item: MediaItem) => {
    const task = useTaskStore
      .getState()
      .tasks.find((t) => t.mediaId === item.id && t.status === 'SUCCESS')
    if (task?.destPath) {
      void window.instadown.revealFile(task.destPath)
    } else {
      toast.error('未找到文件路径')
    }
  }, [])

  return { onCopyLink, onDownloadItem, onOpenInBrowser, onRevealFile }
}
