import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export { formatBytes, formatSpeed, formatDuration, formatCount, formatDate } from '@shared/format'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
