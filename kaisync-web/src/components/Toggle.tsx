import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  activeColor?: string
}

const TRACK_WIDTH = 44
const TRACK_HEIGHT = 26
const KNOB = 20
const KNOB_INSET = 3

export function Toggle({ checked, onChange, disabled, activeColor }: ToggleProps) {
  const usesCustomColor = checked && !!activeColor
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: TRACK_WIDTH,
        height: TRACK_HEIGHT,
        padding: 0,
        ...(usesCustomColor ? { backgroundColor: activeColor } : {}),
      }}
      className={cn(
        'relative inline-flex shrink-0 appearance-none items-center overflow-hidden rounded-full border-0 p-0 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        !usesCustomColor && (checked ? 'bg-primary' : 'bg-border')
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-full bg-white shadow-sm transition-transform"
        style={{
          width: KNOB,
          height: KNOB,
          top: KNOB_INSET,
          left: 0,
          transform: `translateX(${checked ? TRACK_WIDTH - KNOB - KNOB_INSET : KNOB_INSET}px)`,
        }}
      />
    </button>
  )
}
