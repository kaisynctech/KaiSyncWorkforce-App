'use client'

import { cn } from '@/lib/utils'

export type EntityTabItem<T extends string = string> = {
  id: T
  label: string
  /** Optional count / meta shown after the label */
  badge?: string | number
  /** Small attention dot (e.g. waiting items) */
  indicator?: boolean
}

type Props<T extends string> = {
  tabs: readonly EntityTabItem<T>[] | EntityTabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
  /** Soft sky idle (entity detail). Default. */
  tone?: 'sky' | 'neutral'
}

/**
 * Compact entity/list tabs — solid primary when active, soft tint when idle.
 * Reference: employee profile chrome.
 */
export function EntityTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  tone = 'sky',
}: Props<T>) {
  const idle =
    tone === 'sky'
      ? 'bg-sky-500/10 text-sky-800 hover:bg-sky-500/15'
      : 'bg-surface-elevated text-text-secondary hover:bg-surface-elevated hover:text-text-primary'

  return (
    <div className={cn('flex gap-1.5 overflow-x-auto', className)} role="tablist">
      {tabs.map(t => {
        const active = value === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              'h-8 px-2.5 rounded-md font-medium text-[11px] whitespace-nowrap transition-colors shrink-0 inline-flex items-center gap-1.5',
              active
                ? 'bg-primary text-white shadow-sm shadow-primary/20'
                : idle,
            )}
          >
            <span>{t.label}</span>
            {t.badge != null && t.badge !== '' && (
              <span
                className={cn(
                  'tabular-nums text-[10px] font-semibold',
                  active ? 'text-white/85' : 'opacity-70',
                )}
              >
                ({t.badge})
              </span>
            )}
            {t.indicator && (
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  active ? 'bg-white' : 'bg-warning',
                )}
                aria-hidden
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
