'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * Dense "Actions" menu for list headers — parks secondary controls so
 * phone chrome does not wrap into a clustered stack.
 */
export function HeaderOverflowMenu({
  label = 'Actions',
  children,
  className,
}: {
  label?: string
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node | null
      if (rootRef.current && t && !rootRef.current.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(v => !v)}
        className="btn-outlined"
      >
        {label}
        <span className="material-icons">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-40 min-w-[11rem] rounded-lg border border-divider bg-surface shadow-lg p-1 flex flex-col gap-0.5"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** Menu row — use on buttons/links inside HeaderOverflowMenu. */
export function HeaderOverflowItem({
  children,
  className,
  onClick,
  disabled,
  href,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
  href?: string
}) {
  const cls = cn(
    'w-full text-left px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-text-primary hover:bg-surface-elevated disabled:opacity-50',
    className,
  )
  if (href) {
    return (
      <Link role="menuitem" href={href} prefetch={false} className={cls} onClick={onClick}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={cls}>
      {children}
    </button>
  )
}
