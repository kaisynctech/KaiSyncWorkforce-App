'use client'

import { cn } from '@/lib/utils'
import type { ServiceDelivery } from '@/types/quotes'

interface Props {
  value: ServiceDelivery
  onChange: (v: ServiceDelivery) => void
  disabled?: boolean
}

export default function ServiceDeliveryToggle({ value, onChange, disabled }: Props) {
  return (
    <div className="flex rounded-md border border-divider overflow-hidden text-[11px] shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('self')}
        className={cn(
          'px-2.5 py-1 transition-colors whitespace-nowrap',
          value === 'self'
            ? 'bg-primary text-white font-medium'
            : 'text-text-secondary hover:bg-surface-elevated',
        )}
      >
        We provide
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('outsourced')}
        className={cn(
          'px-2.5 py-1 border-l border-divider transition-colors whitespace-nowrap',
          value === 'outsourced'
            ? 'bg-primary text-white font-medium'
            : 'text-text-secondary hover:bg-surface-elevated',
        )}
      >
        Outsource
      </button>
    </div>
  )
}
