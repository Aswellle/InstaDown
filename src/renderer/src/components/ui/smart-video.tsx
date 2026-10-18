import { useEffect, useState } from 'react'
import { VideoOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

/**
 * 容错视频播放器：源不可用（CDN 链接过期 / 编解码不支持 / 网络中断）时
 * 显示明确提示而非空白播放器。
 */
export function SmartVideo({
  src,
  poster,
  className,
  autoPlay = true
}: {
  src: string
  poster?: string | null
  className?: string
  /** 查看器内默认自动播放；网格缩略场景应传 false */
  autoPlay?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const { t } = useI18n()
  useEffect(() => setFailed(false), [src])

  if (failed) {
    return (
      <div
        className={cn(
          'flex h-64 w-96 flex-col items-center justify-center gap-2 rounded-lg bg-surface-hover text-subtle',
          className
        )}
      >
        <VideoOff className="h-8 w-8" />
        <span className="text-xs">{t('viewer.videoBroken')}</span>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-rose-500 underline"
        >
          {t('viewer.openOriginal')}
        </a>
      </div>
    )
  }

  return (
    <video
      src={src}
      controls
      autoPlay={autoPlay}
      className={className}
      poster={poster ?? undefined}
      onError={() => setFailed(true)}
    />
  )
}
