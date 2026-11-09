'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/** Shared content frame — soft brand atmosphere without fighting the sidebar. */
export function PortalPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative min-h-full', className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-24 right-[-10%] h-72 w-72 rounded-full bg-primary/[0.07] blur-3xl" />
        <div className="absolute top-40 left-[-8%] h-56 w-56 rounded-full bg-brand-sky/[0.08] blur-3xl" />
      </div>
      <div className="relative px-4 py-4 md:px-6 md:py-5 space-y-4">
        {children}
      </div>
    </div>
  )
}

/** Opening band — gives Home (and key tabs) a product face, not a form dump. */
export function PortalHero({
  eyebrow,
  title,
  subtitle,
  meta,
  actions,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="relative overflow-hidden rounded-2xl border border-divider bg-surface shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-primary via-brand-sky to-brand-cyan"
      />
      <div
        aria-hidden
        className="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-primary/[0.08] blur-2xl"
      />
      <div className="relative flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5 sm:py-5">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
          <h1 className="text-[22px] font-bold tracking-tight text-text-primary sm:text-[24px]">{title}</h1>
          {subtitle && (
            <p className="text-[13px] text-text-secondary max-w-xl leading-snug">{subtitle}</p>
          )}
          {meta && <div className="pt-1">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-1.5 shrink-0">{actions}</div>}
      </div>
    </header>
  )
}

export function PortalKpi({
  label,
  value,
  icon,
  onClick,
  href,
  tone = 'default',
}: {
  label: string
  value: string
  icon: string
  onClick?: () => void
  href?: string
  tone?: 'default' | 'money' | 'alert'
}) {
  const toneCls =
    tone === 'money'
      ? 'from-brand-sky/15 to-surface'
      : tone === 'alert'
        ? 'from-warning/15 to-surface'
        : 'from-primary/10 to-surface'

  const iconCls =
    tone === 'money'
      ? 'bg-brand-sky/15 text-[#0369a1]'
      : tone === 'alert'
        ? 'bg-warning/15 text-warning'
        : 'bg-primary/15 text-primary'

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg', iconCls)}>
          <span className="material-icons text-[18px]">{icon}</span>
        </span>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-0.5 text-[20px] font-bold tracking-tight text-text-primary tabular-nums">{value}</p>
    </>
  )

  const cls = cn(
    'block w-full text-left rounded-xl border border-divider bg-gradient-to-br p-3.5 transition-all',
    toneCls,
    'hover:border-primary/35 hover:shadow-sm active:scale-[0.99]',
  )

  if (href) {
    return (
      <Link href={href} prefetch={false} className={cls}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  )
}

export function PortalSection({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.08em] text-text-secondary">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function PortalPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-divider bg-surface shadow-[0_1px_0_rgba(15,23,42,0.03)]', className)}>
      {children}
    </div>
  )
}

export function PortalEmpty({
  icon,
  title,
  body,
  compact,
}: {
  icon: string
  title: string
  body: string
  compact?: boolean
}) {
  return (
    <PortalPanel>
      <div className={cn('flex flex-col items-center justify-center text-center px-4', compact ? 'py-8 gap-1.5' : 'py-14 gap-2')}>
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-1">
          <span className="material-icons text-[26px]">{icon}</span>
        </span>
        <p className="text-[14px] font-semibold text-text-primary">{title}</p>
        <p className="text-[12px] text-text-secondary max-w-sm leading-relaxed">{body}</p>
      </div>
    </PortalPanel>
  )
}

export function PortalQuickNav({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {children}
    </div>
  )
}
