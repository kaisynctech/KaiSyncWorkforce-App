'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Desktop: horizontal-scroll table region.
 * Phone (&lt; md): stacked card list — callers render `mobile` cards.
 * Keeps enterprise table-first UX on desktop while making phone usable.
 */
export function ResponsiveDataView({
  table,
  mobile,
  className,
  empty,
}: {
  table: ReactNode
  mobile: ReactNode
  className?: string
  empty?: boolean
}) {
  if (empty) return null
  return (
    <>
      <div className={cn('hidden md:block overflow-x-auto', className)}>
        {table}
      </div>
      <div className={cn('md:hidden divide-y divide-divider', className)}>
        {mobile}
      </div>
    </>
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
