/** 主进程 / 渲染进程共享模型（docs/dev/02 §3、§4、§7） */

export interface MediaItem {
  id: string
  type: 'image' | 'video'
  url: string
  thumb_url?: string | null
  width?: number | null
  height?: number | null
  duration?: number | null
  taken_at?: number | null
}

export interface MediaAuthor {
  username: string
  full_name?: string
  avatar?: string
}

export interface ProfileUser extends MediaAuthor {
  user_id: string
  followers: number
  posts: number
  is_private: boolean
  is_verified: boolean
}

export interface MediaCollection {
  source: { kind: 'post' | 'reel' | 'tv' | 'story' | 'profile' | 'highlight' | 'unknown'; shortcode?: string; username?: string }
  author: MediaAuthor
  items: MediaItem[]
  caption?: string
}

export interface ProfileMediaPage {
  user: ProfileUser
  items: MediaItem[]
  nextCursor?: string | null
}

export type TaskStatus = 'WAITING' | 'DOWNLOADING' | 'PAUSED' | 'SUCCESS' | 'FAILED' | 'CANCELED'

export interface TaskSnapshot {
  id: string
  mediaId: string | null
  url: string
  author: string
  type: 'image' | 'video'
  shortcode: string
  indexNo: number
  status: TaskStatus
  progress: number
  speed: number
  downloaded: number
  total: number
  destPath: string
  error: string | null
  createdAt: number
  updatedAt: number
}

export type TaskEvent =
  | { kind: 'progress'; id: string; progress: number; speed: number; downloaded: number; total: number }
  | { kind: 'status'; id: string; status: TaskStatus; error?: string | null; destPath?: string }
  | { kind: 'created'; id: string; status: TaskStatus; destPath?: string }
  | { kind: 'removed'; id: string }

export type AppErrorCode =
  | 'E_INVALID_URL'
  | 'E_PARSE_FAILED'
  | 'E_IG_RATE_LIMIT'
  | 'E_IG_LOGIN_REQUIRED'
  | 'E_IG_PRIVATE'
  | 'E_IG_NOT_FOUND'
  | 'E_WORKER_DOWN'
  | 'E_NETWORK'
  | 'E_DISK'
  | 'E_CANCELED'

export interface AppError {
  code: AppErrorCode
  message: string
}


export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings {
  downloadDir: string
  concurrency: number
  autoClipboard: boolean
  theme: ThemeMode
  /**
   * 无登录优先（默认开启，强烈建议保持）：公开内容一律匿名获取，
   * 用户的 IG 账号完全不进入请求路径，最大限度避免账号风控。
   * 关闭后（不推荐）公开端点也会携带会话，仅供特殊排查使用。
   */
  anonymousFirst: boolean
  /** 经由账号的功能（Stories 等）执行前显式提醒账号风险 */
  warnAccountUse: boolean
  /** 自动把浏览过的图片缓存到本地（防 CDN 链接过期后图片失效） */
  autoCacheImages: boolean
}

export interface HistoryRow {
  id: number
  task_id: string | null
  media_id: string | null
  author: string | null
  path: string
  size: number
  created_at: number
}

export interface MediaRow {
  id: string
  platform: string
  shortcode: string | null
  author: string | null
  url: string
  thumb_url: string | null
  type: 'image' | 'video'
  width: number | null
  height: number | null
  duration: number | null
  caption: string | null
  taken_at: number | null
  created_at: number
}
