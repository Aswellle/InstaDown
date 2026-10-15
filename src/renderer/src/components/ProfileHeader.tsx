import { BadgeCheck, Grid3X3, Lock, Users } from 'lucide-react'
import type { ProfileUser } from '@shared/types'
import { Skeleton } from '@/components/ui/primitives'
import { SmartImage } from '@/components/ui/smart-image'
import { formatCount } from '@/lib/utils'

export function ProfileHeader({
  user,
  loadedCount
}: {
  user: ProfileUser
  loadedCount: number
}) {
  return (
    <div className="mb-5 flex items-center gap-4 rounded-2xl border border-app bg-surface/60 p-4">
      <SmartImage
        src={user.avatar}
        alt={user.username}
        className="h-16 w-16 rounded-full border border-app-strong object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-base font-semibold text-app">{user.username}</span>
          {user.is_verified && <BadgeCheck className="h-4 w-4 text-sky-400" />}
          {user.is_private && <Lock className="h-3.5 w-3.5 text-amber-400" />}
          {user.is_private && <span className="text-xs text-amber-400">私密账号</span>}
        </div>
        {user.full_name && <div className="truncate text-sm text-muted">{user.full_name}</div>}
        <div className="mt-1.5 flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Grid3X3 className="h-3.5 w-3.5" /> 帖子 {formatCount(user.posts)}
            {loadedCount > 0 && <span className="text-subtle">（已加载 {loadedCount}）</span>}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> 粉丝 {formatCount(user.followers)}
          </span>
        </div>
      </div>
    </div>
  )
}

export function ProfileHeaderSkeleton() {
  return (
    <div className="mb-5 flex items-center gap-4 rounded-2xl border border-app bg-surface/60 p-4">
      <Skeleton className="h-16 w-16 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
    </div>
  )
}
