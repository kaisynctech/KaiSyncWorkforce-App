import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  activeColor?: string
}

export function Toggle({ checked, onChange, disabled, activeColor }: ToggleProps) {
  const usesCustomColor = checked && !!activeColor
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={usesCustomColor ? { backgroundColor: activeColor } : undefined}
      className={cn(
        'relative w-[44px] h-[26px] rounded-pill transition-colors shrink-0 disabled:opacity-50',
        !usesCustomColor && (checked ? 'bg-primary' : 'bg-border')
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] w-5 h-5 bg-white rounded-full shadow transition-transform',
          checked ? 'translate-x-[21px]' : 'translate-x-[3px]'
        )}
      />
    </button>
  )
}
