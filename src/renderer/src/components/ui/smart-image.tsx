import { useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { i18nT } from '@/i18n'
import { useSettingsStore } from '@/stores/settings'
import { cn } from '@/lib/utils'

/**
 * 容错图片：加载失败（CDN 链接过期 / 网络中断 / 已删除）时显示占位符，
 * 而不是浏览器默认的破图图标。
 *
 * 为什么必须走本地缓存：Instagram 的 CDN 链接带签名与过期时间（`oe=` 参数），
 * 几小时后必然失效。若直接引用远端 URL，用户把窗口放着不动一段时间回来，
 * 头像与缩略图就会整片变成占位符（"图片不显示 / 未加载完整"）。
 * 这里先请求主进程把图片缓存到本地磁盘，再用 `instadown-img://` 读取，
 * 因此链接过期后仍能正常显示。
 *
 * 缓存失败时回退到原始 URL（至少当下能显示），彻底失败才显示占位符。
 */

/** 进程内缓存：同一 URL 在多个组件间共享解析结果，避免重复请求主进程 */
const resolved = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

async function resolveSrc(url: string): Promise<string | null> {
  const hit = resolved.get(url)
  if (hit) return hit
  const pending = inflight.get(url)
  if (pending) return pending

  // 设置（设置 → 隐私）：关闭自动缓存后不再把新图片落盘，
  // 但本会话已缓存的仍然可用（读取本地不产生新的磁盘占用）。
  const autoCache = useSettingsStore.getState().settings?.autoCacheImages ?? true
  if (!autoCache) {
    resolved.set(url, url)
    return url
  }

  const p = window.instadown
    .cacheImages([url])
    .then((map) => {
      const local = map[url]
      if (local) {
        resolved.set(url, local)
        return local
      }
      // 主进程未能缓存：回退到远端 URL
      resolved.set(url, url)
      return url
    })
    .catch(() => null)
    .finally(() => inflight.delete(url))

  inflight.set(url, p)
  return p
}

/** 已是本地协议（缓存图片 / 本地文件）的地址无需再经主进程解析 */
function isLocalScheme(url: string): boolean {
  return url.startsWith('instadown-img://') || url.startsWith('instadown-file://')
}

export function SmartImage({
  src,
  alt = '',
  className,
  fallbackClassName,
  loading = 'lazy',
  draggable = false
}: {
  src?: string | null
  alt?: string
  className?: string
  fallbackClassName?: string
  loading?: 'lazy' | 'eager'
  draggable?: boolean
}) {
  const [failed, setFailed] = useState(false)
  /** 图片字节就绪后才淡入：占位 → 图片的切换不再"啪"地跳出来 */
  const [painted, setPainted] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const [current, setCurrent] = useState<string | null>(() => {
    if (!src) return null
    // 已解析过（含本地协议）直接使用，避免闪一下远端链接
    return resolved.get(src) ?? (isLocalScheme(src) ? src : null)
  })

  useEffect(() => {
    setFailed(false)
    setPainted(false)
    if (!src) {
      setCurrent(null)
      return
    }
    if (isLocalScheme(src)) {
      setCurrent(src)
      return
    }
    const cached = resolved.get(src)
    if (cached) {
      setCurrent(cached)
      return
    }
    let alive = true
    setCurrent(null)
    void resolveSrc(src).then((next) => {
      if (alive && next) setCurrent(next)
    })
    return () => {
      alive = false
    }
  }, [src])

  // 命中浏览器缓存时 onLoad 可能在挂载后立刻触发、也可能早于 ref 绑定，
  // 用 complete 兜底判断，否则会永远停在半透明状态。
  useEffect(() => {
    const el = imgRef.current
    if (el?.complete && el.naturalWidth > 0) setPainted(true)
  }, [current])

  if (!src || failed) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-surface-hover text-subtle',
          className,
          fallbackClassName
        )}
        title={failed ? i18nT('image.expiredTooltip') : undefined}
      >
        <ImageOff className="h-5 w-5" />
      </div>
    )
  }

  // 解析中：占位保持布局稳定（避免图片出现时跳动）
  if (!current) {
    return (
      <div className={cn('animate-pulse bg-surface-hover', className, fallbackClassName)} />
    )
  }

  return (
    <img
      ref={imgRef}
      src={current}
      alt={alt}
      loading={loading}
      decoding="async"
      draggable={draggable}
      onLoad={() => setPainted(true)}
      className={cn(
        // 尺寸由父容器决定，图片只做透明度过渡：字节就绪后淡入，
        // 避免"占位块 → 图片"的硬切。prefers-reduced-motion 下立即显示。
        'transition-opacity duration-300 ease-out motion-reduce:transition-none',
        painted ? 'opacity-100' : 'opacity-0',
        className
      )}
      onError={() => setFailed(true)}
    />
  )
}
