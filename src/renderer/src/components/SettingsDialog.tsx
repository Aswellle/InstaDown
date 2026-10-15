import { useEffect, useState } from 'react'
import {
  Aperture,
  ChevronDown,
  Database,
  Download,
  FolderOpen,
  HardDrive,
  Info,
  LogIn,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Star,
  Sun,
  Trash2,
  UserRound,
  Zap
} from 'lucide-react'
import { toast } from 'sonner'
import type { ThemeMode } from '@shared/types'
import { Dialog } from '@/components/ui/dialog'
import { Button, Input } from '@/components/ui/primitives'
import { GithubIcon } from '@/components/ui/github-icon'
import { useSettingsStore } from '@/stores/settings'
import { useIgAccountStore } from '@/stores/ig-account'
import { SmartImage } from '@/components/ui/smart-image'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { GITHUB_REPO_LABEL, GITHUB_REPO_URL } from '@shared/repo'
import { cn, formatBytes } from '@/lib/utils'

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor }
]

/**
 * 设置面板（docs/09）：按"分组 + 说明"组织，高级项折叠。
 *
 * 设计原则：
 * - 每个设置项都有一句说明它**影响什么**，而不是只给一个开关；
 * - 高级/有风险的操作（手动粘贴 Cookie、清空缓存、清空历史）折叠在
 *   「高级」区，并写明后果；
 * - 功能入口（打开下载目录、账号面板）就近放置，不让用户去别处找。
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)
  const setIgLoggedIn = useIgAccountStore((s) => s.setLoggedIn)
  const [dir, setDir] = useState('')
  const [concurrency, setConcurrency] = useState(3)
  const [autoClipboard, setAutoClipboard] = useState(true)
  const [anonymousFirst, setAnonymousFirst] = useState(true)
  const [warnAccountUse, setWarnAccountUse] = useState(true)
  const [autoCacheImages, setAutoCacheImages] = useState(true)
  const [theme, setTheme] = useState<ThemeMode>('light')
  const [session, setSession] = useState('')
  const [hasSession, setHasSession] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [profile, setProfile] = useState<{ username: string; avatar: string } | null>(null)
  const [cache, setCache] = useState<{ files: number; bytes: number } | null>(null)
  const [historyCount, setHistoryCount] = useState(0)
  const [confirm, setConfirm] = useState<'cache' | 'history' | 'logout' | null>(null)
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (!open || !settings) return
    setDir(settings.downloadDir)
    setConcurrency(settings.concurrency)
    setAutoClipboard(settings.autoClipboard)
    setAnonymousFirst(settings.anonymousFirst)
    setWarnAccountUse(settings.warnAccountUse)
    setAutoCacheImages(settings.autoCacheImages)
    setTheme(settings.theme)
    void window.instadown.getAppVersion().then(setVersion).catch(() => setVersion(''))
    void window.instadown.igLoginStatus().then((s) => {
      setHasSession(s.persisted)
      setProfile(s.profile ?? null)
    })
    void window.instadown.getImageCacheStats().then(setCache).catch(() => setCache(null))
    void window.instadown
      .getHistory()
      .then((h) => setHistoryCount(h.length))
      .catch(() => setHistoryCount(0))
  }, [open, settings])

  const flashSaved = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  const chooseDir = async () => {
    const chosen = await window.instadown.chooseDirectory()
    if (chosen) {
      setDir(chosen)
      await save({ downloadDir: chosen })
      flashSaved()
    }
  }

  const openDir = async () => {
    try {
      const opened = await window.instadown.openDownloadDir()
      if (opened === null) toast.error('下载目录未设置')
    } catch (e) {
      toast.error(`无法打开目录：${(e as Error).message}`)
    }
  }

  const pickTheme = async (next: ThemeMode) => {
    setTheme(next)
    await save({ theme: next })
    flashSaved()
  }

  const saveSession = async () => {
    await window.instadown.setSessionCookie(session.trim() || null)
    setSession('')
    setHasSession(Boolean(session.trim()))
    flashSaved()
  }

  /** 打开 IG 官方登录窗口；成功后 Cookie 已由主进程加密保存 */
  const handleLogin = async (reset = false) => {
    setLoggingIn(true)
    try {
      const res = reset ? await window.instadown.igResetAndLogin() : await window.instadown.igLogin()
      if (res.ok) {
        const prof = { username: res.username ?? '', avatar: res.avatar ?? '' }
        setHasSession(true)
        setProfile(prof)
        setIgLoggedIn(prof)
        toast.success(res.username ? `已登录 Instagram：@${res.username}` : 'Instagram 登录成功', {
          description: '会话已加密保存在本机'
        })
      } else if (res.cancelled) {
        toast.info('已取消登录')
      } else {
        toast.error(res.message ?? '未检测到登录状态，请重试')
      }
    } catch (e) {
      toast.error(`登录失败：${(e as Error).message}`)
    } finally {
      setLoggingIn(false)
    }
  }

  const handleLogout = async () => {
    try {
      await window.instadown.igLogout()
      setHasSession(false)
      setProfile(null)
      setIgLoggedIn(null)
      toast.success('已退出登录并清除本地会话')
    } catch (e) {
      toast.error(`退出失败：${(e as Error).message}`)
    }
  }

  const clearCache = async () => {
    try {
      const n = await window.instadown.clearImageCache()
      setCache({ files: 0, bytes: 0 })
      setConfirm(null)
      toast.success(`已清空图片缓存（${n} 个文件）`, {
        description: '下次浏览时会重新缓存，缩略图首次显示会稍慢'
      })
    } catch (e) {
      toast.error(`清空失败：${(e as Error).message}`)
    }
  }

  const clearHistory = async () => {
    try {
      await window.instadown.clearHistory()
      setHistoryCount(0)
      setConfirm(null)
      toast.success('已清空下载历史', { description: '已下载的文件不会被删除' })
    } catch (e) {
      toast.error(`清空失败：${(e as Error).message}`)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="设置">
      <div className="space-y-6 p-5">
        {/* ───────────────────────── 外观 */}
        <Group icon={Palette} title="外观" desc="界面主题，立即生效">
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const active = theme === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => void pickTheme(opt.value)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs transition-colors',
                    active
                      ? 'border-rose-500 bg-rose-500/10 text-app'
                      : 'border-app text-muted hover:bg-surface-hover'
                  )}
                >
                  <Icon className={cn('h-4 w-4', active && 'text-rose-500')} />
                  {opt.label}
                </button>
              )
            })}
          </div>
        </Group>

        {/* ───────────────────────── 下载 */}
        <Group icon={Download} title="下载" desc="保存位置与并发">
          <Field label="下载目录" hint="文件按 用户名 / 日期 / 类型 自动归类">
            <div className="flex gap-2">
              <Input value={dir} readOnly className="flex-1 font-mono text-xs" />
              <Button variant="secondary" onClick={chooseDir} title="选择新的下载目录">
                <FolderOpen className="h-4 w-4" /> 更改
              </Button>
              <Button variant="outline" onClick={() => void openDir()} title="在文件管理器中打开">
                打开
              </Button>
            </div>
          </Field>

          <Field
            label="同时下载任务数"
            hint="并发越高越快，但更容易被 Instagram 限流；建议保持 3"
          >
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  onClick={async () => {
                    setConcurrency(n)
                    await save({ concurrency: n })
                    flashSaved()
                  }}
                  title={n > 3 ? `${n} 并发可能触发 IG 限流` : `${n} 个任务同时下载`}
                  className={cn(
                    'h-8 w-8 rounded-lg text-sm transition-colors',
                    n === concurrency
                      ? 'bg-rose-500 text-white'
                      : 'bg-surface-hover text-muted hover:bg-surface-active'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>
        </Group>

        {/* ───────────────────────── 行为 */}
        <Group icon={Zap} title="行为" desc="解析与剪贴板">
          <Toggle
            label="剪贴板自动检测"
            hint="窗口获得焦点时检测剪贴板中的 Instagram 链接并提示解析"
            checked={autoClipboard}
            onChange={async () => {
              const next = !autoClipboard
              setAutoClipboard(next)
              await save({ autoClipboard: next })
              flashSaved()
            }}
          />
        </Group>

        {/* ───────────────────────── 账号安全 */}
        <Group icon={ShieldCheck} title="隐私与账号安全" desc="控制何时使用你的 IG 会话">
          <Toggle
            label="无登录优先（强烈建议保持开启）"
            hint="公开内容一律匿名获取，你的账号完全不进入请求路径，最大限度避免 IG 对自动化工具的风控与封号风险。关闭后公开请求也会携带会话（不推荐）。"
            checked={anonymousFirst}
            tone="safe"
            onChange={async () => {
              const next = !anonymousFirst
              setAnonymousFirst(next)
              await save({ anonymousFirst: next })
              flashSaved()
            }}
          />
          <Toggle
            label="经由账号的操作前提醒"
            hint="Stories 等只能用账号完成的功能，执行前会明确提示「本操作将使用你的 IG 会话」，并提供取消入口。"
            checked={warnAccountUse}
            onChange={async () => {
              const next = !warnAccountUse
              setWarnAccountUse(next)
              await save({ warnAccountUse: next })
              flashSaved()
            }}
          />
          <Toggle
            label="自动缓存浏览过的图片"
            hint="把头像与缩略图保存到本机；IG 的图片链接带签名几小时后就失效，缓存后图片永久可看。占用可在下方「存储与数据」清理。"
            checked={autoCacheImages}
            onChange={async () => {
              const next = !autoCacheImages
              setAutoCacheImages(next)
              await save({ autoCacheImages: next })
              flashSaved()
            }}
          />
        </Group>

        {/* ───────────────────────── 账号 */}
        <Group
          icon={UserRound}
          title="Instagram 账号"
          desc="用于主页归档与 Stories（需登录）"
        >
          {hasSession ? (
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                {profile?.avatar ? (
                  <SmartImage
                    src={profile.avatar}
                    className="h-9 w-9 rounded-full object-cover"
                    fallbackClassName="h-9 w-9 rounded-full"
                  />
                ) : (
                  <UserRound className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-app">
                    {profile?.username ? `已登录：@${profile.username}` : '已登录'}
                  </div>
                  <div className="text-[11px] text-subtle">
                    会话已加密保存在本机 · 点击顶栏头像查看详情
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setConfirm('logout')}>
                退出
              </Button>
            </div>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-subtle">
                点击下方按钮打开 Instagram 官方登录页，在其中登录你的账号即可。
                登录凭据直接提交给 Instagram，本应用不接触密码，仅加密保存会话
                Cookie（绝不联网上传）。
              </p>
              <Button
                variant="primary"
                className="mt-2 w-full"
                onClick={() => void handleLogin()}
                disabled={loggingIn}
              >
                <LogIn className="h-4 w-4" /> {loggingIn ? '等待登录…' : '登录 Instagram'}
              </Button>
            </>
          )}
        </Group>

        {/* ───────────────────────── 存储与数据 */}
        <Group icon={HardDrive} title="存储与数据" desc="本机占用与清理">
          <div className="space-y-2 rounded-lg border border-app bg-surface-hover/30 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted">
                <Database className="h-3.5 w-3.5" /> 图片缓存
              </span>
              <span className="tabular-nums text-app">
                {cache ? `${cache.files} 个文件 · ${formatBytes(cache.bytes)}` : '统计中…'}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-subtle">
              头像与缩略图缓存在本机，避免 Instagram 链接过期后图片无法显示。
              清空后再次浏览会重新缓存。
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setConfirm('cache')}
              disabled={!cache || cache.files === 0}
            >
              <Trash2 className="h-3.5 w-3.5" /> 清空图片缓存
            </Button>
          </div>

          <div className="space-y-2 rounded-lg border border-app bg-surface-hover/30 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted">
                <Info className="h-3.5 w-3.5" /> 下载历史
              </span>
              <span className="tabular-nums text-app">{historyCount} 条记录</span>
            </div>
            <p className="text-[11px] leading-relaxed text-subtle">
              清空的是历史列表，<span className="font-medium text-muted">已下载到磁盘的文件不会被删除</span>。
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setConfirm('history')}
              disabled={historyCount === 0}
            >
              <Trash2 className="h-3.5 w-3.5" /> 清空下载历史
            </Button>
          </div>
        </Group>

        {/* ───────────────────────── 高级（折叠） */}
        <AdvancedGroup title="高级">
          <Field
            label="手动粘贴会话 Cookie"
            hint="仅当无法打开登录窗口、或已有现成 Cookie 时使用。格式：sessionid=…（可包含多个 cookie，用 ; 分隔）"
          >
            <div className="flex gap-2">
              <Input
                value={session}
                onChange={(e) => setSession(e.target.value)}
                placeholder="sessionid=…"
                type="password"
                className="flex-1 font-mono text-xs"
              />
              <Button variant="secondary" onClick={saveSession} disabled={!session.trim()}>
                保存
              </Button>
            </div>
          </Field>
        </AdvancedGroup>

        {/* ───────────────────────── 关于 */}
        <Group icon={Info} title="关于" desc="版本信息与开源仓库">
          <div className="space-y-2 rounded-lg border border-app bg-surface-hover/30 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-muted">
                <Aperture className="h-3.5 w-3.5 text-rose-500" /> InstaDownloader
              </span>
              <span className="tabular-nums text-app">{version ? `v${version}` : '—'}</span>
            </div>

            {/* 开源仓库入口：章鱼猫图标 + 地址 + star 请求 */}
            <button
              onClick={() => void window.instadown.openExternal(GITHUB_REPO_URL)}
              className="flex w-full items-center gap-2 rounded-md border border-app bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
              title="在浏览器中打开开源仓库"
            >
              <GithubIcon className="h-4 w-4 shrink-0 text-app" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-app">
                {GITHUB_REPO_LABEL}
              </span>
              <Star className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            </button>

            <p className="text-[11px] leading-relaxed text-subtle">
              如果这个项目帮你留住了想收藏的内容，欢迎到 GitHub 给一个
              <span className="mx-0.5 inline-flex items-center gap-0.5 text-amber-500">
                <Star className="h-3 w-3" />Star
              </span>
              —— 这是对独立开发者最实在的鼓励，也能让更多人看到它。
            </p>
          </div>
        </Group>

        <div className="flex items-center justify-end gap-2 border-t border-app pt-3">
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">已保存</span>}
          <Button variant="secondary" onClick={onClose}>
            完成
          </Button>
        </div>
      </div>

      {/* 破坏性操作确认：清空缓存 / 清空历史 / 退出登录 */}
      <ConfirmDialog
        open={confirm === 'cache'}
        title="清空图片缓存？"
        message={
          cache
            ? `将删除 ${cache.files} 个缓存文件（${formatBytes(cache.bytes)}）。此操作不可撤销；下次浏览时会重新缓存，缩略图首次显示会稍慢。`
            : '将删除全部缓存文件。此操作不可撤销。'
        }
        confirmLabel="清空"
        onConfirm={() => void clearCache()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'history'}
        title="清空下载历史？"
        message={`将删除全部 ${historyCount} 条历史记录。此操作不可撤销；已下载到磁盘的文件不会被删除。`}
        confirmLabel="清空"
        onConfirm={() => void clearHistory()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'logout'}
        title="退出 Instagram 登录？"
        message="将清除本机保存的登录会话，主页归档与 Stories 将不可用，直到重新登录。"
        confirmLabel="退出登录"
        onConfirm={() => void handleLogout()}
        onCancel={() => setConfirm(null)}
      />
    </Dialog>
  )
}

// ─── 布局原语 ──────────────────────────────────────────────

function Group({
  icon: Icon,
  title,
  desc,
  children
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-app">{title}</h3>
          <p className="text-[11px] text-subtle">{desc}</p>
        </div>
      </div>
      <div className="space-y-3 pl-6">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">{hint}</p>}
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  tone = 'default'
}: {
  label: string
  hint: string
  checked: boolean
  onChange: () => void | Promise<void>
  /** safe=开启时绿色（该选项开着更安全）；default=常规主色 */
  tone?: 'default' | 'safe'
}) {
  const onColor = tone === 'safe' ? 'bg-emerald-500' : 'bg-rose-500'
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted">{label}</div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-subtle">{hint}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => void onChange()}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? onColor : 'bg-surface-active'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5'
          )}
        />
      </button>
    </div>
  )
}

function AdvancedGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-lg border border-app">
      <button
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="text-xs font-medium text-muted">{title}</span>
        <ChevronDown
          className={cn('h-4 w-4 text-subtle transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && <div className="space-y-3 border-t border-app px-3 py-3">{children}</div>}
    </section>
  )
}
