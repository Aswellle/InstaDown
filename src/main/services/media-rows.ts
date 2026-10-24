import type { MediaCollection, MediaRow } from '@shared/types'

/**
 * 媒体行的持久化策略集中在这一处：解析得到的 items 如何落 media 表。
 * （此前散落在 ipc.ts 的四个调用点。）
 */
export function mediaRowsFromItems(
  items: MediaCollection['items'],
  meta: { author: string; shortcode: string }
): MediaRow[] {
  const now = Date.now()
  return items.map((m) => ({
    id: m.id,
    platform: 'instagram',
    shortcode: meta.shortcode,
    author: meta.author,
    url: m.url,
    thumb_url: m.thumb_url ?? null,
    type: m.type,
    width: m.width ?? null,
    height: m.height ?? null,
    duration: m.duration ?? null,
    caption: null,
    taken_at: m.taken_at ?? null,
    created_at: now
  }))
}
