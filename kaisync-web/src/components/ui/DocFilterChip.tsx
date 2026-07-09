export function DocFilterChip({
  count, label, active, bg, valueFg, labelFg, onClick,
}: {
  count: number
  label: string
  active: boolean
  bg: string
  valueFg: string
  labelFg: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg px-[10px] py-[5px] flex items-center gap-1.5 border text-[11px]"
      style={{ backgroundColor: bg, borderColor: active ? 'var(--color-primary)' : 'transparent' }}
    >
      <span style={{ color: valueFg }} className="font-semibold text-[13px]">{count}</span>
      <span style={{ color: labelFg }}>{label}</span>
    </button>
  )
}
