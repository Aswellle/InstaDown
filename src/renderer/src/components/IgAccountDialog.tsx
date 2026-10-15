import { useEffect, useState } from 'react'
import {
  BadgeCheck,
  ExternalLink,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound
} from 'lucide-react'
import { toast } from 'sonner'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/primitives'
import { SmartImage } from '@/components/ui/smart-image'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useIgAccountStore } from '@/stores/ig-account'

/**
 * IG 账号面板：点击顶栏头像进入（而不是跳到设置）。
 *
 * 为什么独立成面板：账号相关的操作（查看身份、重新登录、退出、看权限说明）
 * 与"应用设置"是两类事。混在设置里会让用户在设置里找不到"我的账号"，
 * 也让设置面板臃肿。这里只放账号本身，并明确列出会话能做什么。
 */
export function IgAccountDialog({
  open,
  onClose,
  onLogin
}: {
  open: boolean
  onClose: () => void
  /** 复用 App 的登录流程（含 toast 与状态同步） */
  onLogin: () => Promise<void>
}) {
  const loggedIn = useIgAccountStore((s) => s.loggedIn)
  const profile = useIgAccountStore((s) => s.profile)
  const refresh = useIgAccountStore((s) => s.refresh)
  const setLoggedIn = useIgAccountStore((s) => s.setLoggedIn)
  const [busy, setBusy] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [status, setStatus] = useState<{
    persisted: boolean
    partition: boolean
  } | null>(null)

  useEffect(() => {
    if (!open) return
    void refresh()
    void window.instadown
      .igLoginStatus()
      .then((s) => setStatus({ persisted: s.persisted, partition: s.partition }))
      .catch(() => setStatus(null))
  }, [open, refresh])

  const handleReLogin = async () => {
    setBusy(true)
    try {
      await onLogin()
      await refresh()
      const s = await window.instadown.igLoginStatus()
      setStatus({ persisted: s.persisted, partition: s.partition })
    } finally {
      setBusy(false)
    }
  }

  const handleLogout = async () => {
    setConfirmLogout(false)
    setBusy(true)
    try {
      await window.instadown.igLogout()
      setLoggedIn(null)
      setStatus({ persisted: false, partition: false })
      toast.success('已退出登录并清除本地会话')
      onClose()
    } catch (e) {
      toast.error(`退出失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const openProfileInBrowser = () => {
    if (profile?.username) {
      void window.instadown.openExternal(`https://www.instagram.com/${profile.username}/`)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Instagram 账号">
      <div className="space-y-5 p-5">
        {loggedIn && profile ? (
          <>
            {/* 身份卡片 */}
            <div className="flex items-center gap-3.5 rounded-xl border border-app bg-surface-hover/50 p-4">
              <SmartImage
                src={profile.avatar}
                alt={profile.username}
                className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-emerald-500/30"
                fallbackClassName="h-14 w-14 shrink-0 rounded-full"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-app">
                    @{profile.username || '未知账号'}
                  </span>
                  <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                </div>
                <div className="mt-0.5 text-xs text-muted">已连接 Instagram 账号</div>
              </div>
              <Button variant="outline" size="sm" onClick={openProfileInBrowser} title="在浏览器中打开我的主页">
                <ExternalLink className="h-3.5 w-3.5" /> 主页
              </Button>
            </div>

            {/* 会话能力说明：让用户知道登录带来了什么 */}
            <section>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
                <Sparkles className="h-3.5 w-3.5" /> 登录后可用的功能
              </div>
              <ul className="space-y-1.5 rounded-lg border border-app bg-surface-hover/30 p-3">
                <CapabilityRow label="主页帖子归档" hint="批量浏览并下载某账号的主页媒体" enabled />
                <CapabilityRow label="Stories 查看" hint="读取当前有效的限时动态" enabled />
                <CapabilityRow
                  label="私密账号内容"
                  hint="仅当你的账号已被对方接受关注时可用"
                  enabled
                />
              </ul>
            </section>

            {/* 会话使用策略：用户最关心的账号安全问题，必须写清楚 */}
            <section>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
                <ShieldCheck className="h-3.5 w-3.5" /> 会话使用策略（账号安全）
              </div>
              <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-[11px] leading-relaxed">
                <p className="text-app">
                  <span className="font-medium">默认绝不使用你的账号。</span>
                  公开内容（帖子 / Reels / 主页）一律匿名获取，你的会话不进入
                  请求路径，IG 无法把这些请求与你的账号关联。
                </p>
                <p className="text-muted">
                  仅当功能<strong>只能</strong>通过账号完成时（查看 Stories、
                  私密账号内容）才会经由会话访问，且执行前会明确提醒。
                  这是为保护你的账号设计的最小暴露原则。
                </p>
                <p className="text-subtle">
                  回退方式：如担心账号风险，可随时点「退出登录」清除本机会话；
                  未登录状态下除 Stories / 私密内容外的全部功能仍然可用。
                </p>
              </div>
            </section>

            {/* 会话状态（供排查问题） */}
            <section>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
                <ShieldCheck className="h-3.5 w-3.5" /> 会话状态
              </div>
              <div className="space-y-1.5 rounded-lg border border-app bg-surface-hover/30 p-3 text-[11px]">
                <StatusRow label="已加密保存到本机" ok={status?.persisted ?? false} />
                <StatusRow label="浏览器分区已登录" ok={status?.partition ?? false} />
                <p className="pt-1 leading-relaxed text-subtle">
                  会话经系统密钥（safeStorage）加密后仅存于本机，不会上传到任何服务器。
                  凭据始终直接提交给 Instagram，本应用不接触密码。
                </p>
              </div>
            </section>

            {/* 操作 */}
            <div className="flex items-center justify-end gap-2 border-t border-app pt-3">
              <Button variant="secondary" size="sm" onClick={() => void handleReLogin()} disabled={busy}>
                <RefreshCw className="h-3.5 w-3.5" /> {busy ? '处理中…' : '重新登录'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmLogout(true)} disabled={busy}>
                <LogOut className="h-3.5 w-3.5" /> 退出登录
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* 未登录态：说明 + 直接登录 */}
            <div className="flex flex-col items-center py-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-hover">
                <UserRound className="h-7 w-7 text-subtle" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-app">尚未登录 Instagram</h3>
              <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">
                登录后可归档任意账号的主页帖子、查看 Stories。
                点击下方按钮会打开 Instagram 官方登录页，在其中登录即可。
              </p>
              <Button
                variant="primary"
                className="mt-4 w-full max-w-xs"
                onClick={() => void handleReLogin()}
                disabled={busy}
              >
                <LogIn className="h-4 w-4" /> {busy ? '等待登录…' : '登录 Instagram'}
              </Button>
              <p className="mt-2.5 text-[11px] leading-relaxed text-subtle">
                凭据直接提交给 Instagram，本应用不接触密码，
                仅加密保存会话 Cookie（绝不联网上传）。
              </p>
            </div>
          </>
        )}
      </div>

      {/* 退出登录：会清掉本机会话，需用户确认 */}
      <ConfirmDialog
        open={confirmLogout}
        title="退出 Instagram 登录？"
        message="将清除本机保存的登录会话，主页归档与 Stories 将不可用，直到重新登录。"
        confirmLabel="退出登录"
        onConfirm={() => void handleLogout()}
        onCancel={() => setConfirmLogout(false)}
      />
    </Dialog>
  )
}

function CapabilityRow({
  label,
  hint,
  enabled
}: {
  label: string
  hint: string
  enabled: boolean
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={
          enabled
            ? 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500'
            : 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-surface-active'
        }
      />
      <div className="min-w-0">
        <div className="text-xs text-app">{label}</div>
        <div className="text-[11px] text-subtle">{hint}</div>
      </div>
    </li>
  )
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
        {ok ? '正常' : '缺失'}
      </span>
    </div>
  )
}
