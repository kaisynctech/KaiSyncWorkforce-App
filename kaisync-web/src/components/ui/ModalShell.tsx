'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * Full-screen on phones (bottom-anchored sheet), centered dialog on md+.
 * Touch-friendly close affordance; backdrop dismiss via onClose.
 */
export function ModalShell({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!open || !mounted) return null

  const width =
    size === 'sm' ? 'md:max-w-sm' : size === 'lg' ? 'md:max-w-2xl' : 'md:max-w-md'

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end md:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative z-10 w-full bg-surface shadow-xl flex flex-col max-h-[92vh]',
          'rounded-t-2xl md:rounded-xl border border-divider',
          'md:mx-4',
          width,
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-divider shrink-0">
            <h2 className="text-[15px] font-semibold text-text-primary truncate">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="touch-target w-10 h-10 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-elevated"
              aria-label="Close"
            >
              <span className="material-icons text-[20px]">close</span>
            </button>
          </div>
        )}
        <div className="overflow-y-auto flex-1 min-h-0 px-4 py-4">{children}</div>
        {footer && (
          <div className="px-4 py-3 border-t border-divider shrink-0 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
