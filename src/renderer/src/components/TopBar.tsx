import { useEffect, useRef, useState } from 'react'
import { Aperture, ClipboardPaste, LogIn, Search } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { SmartImage } from '@/components/ui/smart-image'
import { GithubIcon } from '@/components/ui/github-icon'
import { useIgAccountStore } from '@/stores/ig-account'
import { isProbablyIgUrl } from '@shared/ig-url'
import { GITHUB_REPO_URL } from '@shared/repo'

/** 顶部：Logo + URL 输入（粘贴快捷键）+ 解析 + 账号入口（docs/09） */
export function TopBar({
  onParse,
  onAutoClipboard,
  onAccountClick,
  onLoginClick
}: {
  onParse: (input: string) => void
  onAutoClipboard: (text: string) => void
  /** 已登录：打开 IG 账号面板 */
  onAccountClick: () => void
  /** 未登录：直接打开 IG 登录窗口 */
  onLoginClick: () => void
}) {
  const [value, setValue] = useState('')
  const loggedIn = useIgAccountStore((s) => s.loggedIn)
  const profile = useIgAccountStore((s) => s.profile)
  const inputRef = useRef<HTMLInputElement>(null)

  // 窗口聚焦时检测剪贴板中的 IG 链接（参考产品"一键粘贴"体验的桌面化）
  useEffect(() => {
    let last = ''
    const check = async () => {
      try {
        const text = await window.instadown.readClipboard()
        if (text && text !== last && isProbablyIgUrl(text) && text.length < 500) {
          last = text
          onAutoClipboard(text)
        }
      } catch {
        /* 剪贴板不可用 */
      }
    }
    void check()
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [onAutoClipboard])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = () => {
    if (value.trim()) onParse(value)
  }

  const paste = async () => {
    try {
      const text = await window.instadown.readClipboard()
      if (text) {
        setValue(text.trim())
        onParse(text.trim())
      }
    } catch {
      /* 忽略 */
    }
  }

  return (
    <div className="flex h-full items-center gap-3">
      <div className="flex items-center gap-2 pl-1">
        <Aperture className="h-5 w-5 text-rose-500" />
        <span className="text-sm font-semibold tracking-wide text-app">InstaDownloader</span>
        {/* 开源入口：章鱼猫图标 + Star 请求（悬停提示）。
            放在品牌名旁而不是角落 —— 它既是"项目从哪来"的标识，
            也是给用户的第一个 star 触点。 */}
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.preventDefault()
            void window.instadown.openExternal(GITHUB_REPO_URL)
          }}
          className="no-drag ml-0.5 flex items-center gap-1 rounded-md px-1.5 py-1 text-muted transition-colors hover:bg-surface-hover hover:text-app"
          title="在 GitHub 上 Star 这个项目 ⭐"
        >
          <GithubIcon className="h-4 w-4" />
          <span className="hidden text-xs sm:inline">Star</span>
        </a>
      </div>

      <div className="no-drag mx-auto flex w-full max-w-2xl items-center gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="粘贴 Instagram 帖子 / Reels / 主页链接，或输入用户名…  (Ctrl+K)"
            className="h-9 w-full rounded-lg border border-app bg-surface pl-9 pr-20 text-sm text-app placeholder:text-subtle focus-visible:border-rose-500/60 focus-visible:outline-none"
            spellCheck={false}
          />
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <button
            onClick={paste}
            className="absolute right-2 top-1/2 flex h-6 -translate-y-1/2 items-center gap-1 rounded-md bg-surface-hover px-2 text-xs text-muted hover:bg-surface-active"
            title="读取剪贴板并解析"
          >
            <ClipboardPaste className="h-3 w-3" /> 粘贴
          </button>
        </div>
        <Button variant="primary" size="md" onClick={submit} disabled={!value.trim()}>
          解析
        </Button>
      </div>

      {/* 右侧：IG 账号入口。
          设置入口在左上角图标组（避免被 Windows 原生窗口控制按钮遮挡）。
          注意：这里不再放"解析服务"圆点——它只是个静态指示、点不动也读不出
          更多信息，用户反馈"没有实际功用"，因此移除；服务异常仍会通过
          toast 提示（App.tsx 的 onWorkerStatus）。 */}
      <div className="no-drag flex items-center gap-2 pr-1">
        {loggedIn && profile ? (
          <button
            onClick={onAccountClick}
            className="flex items-center gap-2 rounded-full border border-app py-0.5 pl-0.5 pr-2.5 transition-colors hover:bg-surface-hover"
            title={`已登录 Instagram：@${profile.username}（点击查看账号详情）`}
          >
            <SmartImage
              src={profile.avatar}
              className="h-6 w-6 rounded-full object-cover"
              fallbackClassName="h-6 w-6 rounded-full"
            />
            <span className="max-w-28 truncate text-xs font-medium text-app">
              {profile.username}
            </span>
          </button>
        ) : (
          <button
            onClick={onLoginClick}
            className="flex items-center gap-1.5 rounded-full border border-app px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-app"
            title="登录 Instagram 账号（用于 Stories / 主页归档）"
          >
            <LogIn className="h-3.5 w-3.5" />
            登录
          </button>
        )}
      </div>
    </div>
  )
}
