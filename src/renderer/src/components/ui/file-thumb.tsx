import { useEffect, useState } from 'react'
import { FileVideo, File as FileIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fileKindOf, localFileUrl } from '@/lib/local-file'

/**
 * 本地文件缩略图：下载历史里直观展示每一项是什么。
 *
 * - 图片：经 `instadown-file://` 协议直接读盘显示（主进程只放行
 *   存在且扩展名可渲染的文件，防任意读取）。
 * - 视频：读取首帧在现代浏览器里并不可靠（受编码/关键帧影响），
 *   统一显示视频文件图标，避免一片黑块。
 * - 加载失败或非图片：回退到文件类型图标。
 */

export function FileThumb({ path, className }: { path: string; className?: string }) {
  const kind = fileKindOf(path)
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [path])

  if (kind === 'video') {
    return (
      <div
        className={cn('flex items-center justify-center bg-surface-hover text-muted', className)}
      >
        <FileVideo className="h-5 w-5" />
      </div>
    )
  }

  if (kind === 'image' && !failed) {
    return (
      <img
        src={localFileUrl(path)}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn('h-full w-full object-cover', className)}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      className={cn('flex items-center justify-center bg-surface-hover text-muted', className)}
    >
      <FileIcon className="h-5 w-5" />
    </div>
  )
}
