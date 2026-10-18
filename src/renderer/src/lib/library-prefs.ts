/**
 * 媒体库的界面偏好（跨会话保留）。
 *
 * 与业务设置分开存放：这些只影响"怎么浏览"，不涉及下载行为，
 * 放进 AppSettings 会让数据库 schema 为纯前端偏好扩容。
 * 用 localStorage 与语言选择保持一致的持久化方式。
 */

export type LibraryViewMode = 'grouped' | 'flat'
export type LibrarySurface = 'sidebar' | 'full'
export type LibrarySort = 'date-desc' | 'date-asc' | 'author' | 'size-desc'
export type LibraryTypeFilter = 'all' | 'image' | 'video'

export interface LibraryPrefs {
  /** 侧边栏：按作者分组 / 平铺 */
  viewMode: LibraryViewMode
  /** 全屏：排序方式 */
  sort: LibrarySort
  /** 全屏：类型筛选 */
  typeFilter: LibraryTypeFilter
  /** 全屏：筛选栏是否折叠 */
  filtersCollapsed: boolean
  /** 顶栏媒体库按钮打开的视图（用户最后一次使用的） */
  surface: LibrarySurface
}

const KEY = 'instadown.library.prefs'

const DEFAULTS: LibraryPrefs = {
  viewMode: 'grouped',
  sort: 'date-desc',
  typeFilter: 'all',
  filtersCollapsed: false,
  surface: 'sidebar'
}

export function loadLibraryPrefs(): LibraryPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<LibraryPrefs>
    return {
      viewMode: parsed.viewMode === 'flat' ? 'flat' : 'grouped',
      sort:
        parsed.sort === 'date-asc' || parsed.sort === 'author' || parsed.sort === 'size-desc'
          ? parsed.sort
          : 'date-desc',
      typeFilter:
        parsed.typeFilter === 'image' || parsed.typeFilter === 'video'
          ? parsed.typeFilter
          : 'all',
      filtersCollapsed: parsed.filtersCollapsed === true,
      surface: parsed.surface === 'full' ? 'full' : 'sidebar'
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveLibraryPrefs(patch: Partial<LibraryPrefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadLibraryPrefs(), ...patch }))
  } catch {
    /* 存储不可用时退化为本次会话有效 */
  }
}
