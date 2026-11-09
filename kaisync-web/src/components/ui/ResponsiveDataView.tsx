'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Table-first list chrome for desktop and phone.
 * Phones keep the table and scroll horizontally — no card fallback.
 * `mobile` is accepted for backward compatibility but not rendered.
 */
export function ResponsiveDataView({
  table,
  mobile: _mobile,
  className,
  empty,
}: {
  table: ReactNode
  /** @deprecated Cards are no longer used; table is shown at all breakpoints. */
  mobile?: ReactNode
  className?: string
  empty?: boolean
}) {
  void _mobile
  if (empty) return null
  return (
    <div className={cn('overflow-x-auto overscroll-x-contain -webkit-overflow-scrolling-touch', className)}>
      {table}
    </div>
  )
}

export function DataCard({
  children,
  onClick,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      className={cn(
        'w-full text-left px-4 py-3 bg-surface hover:bg-background transition-colors',
        onClick && 'cursor-pointer active:bg-surface-elevated',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function DataCardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[14px] font-semibold text-text-primary truncate', className)}>{children}</p>
}

export function DataCardMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[12px] text-text-secondary mt-0.5', className)}>{children}</p>
}

export function DataCardRow({
  label,
  value,
  className,
}: {
  label: string
  value: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 mt-1.5', className)}>
      <span className="text-[11px] text-text-disabled shrink-0">{label}</span>
      <span className="text-[12px] text-text-primary text-right truncate">{value}</span>
    </div>
  )
}
