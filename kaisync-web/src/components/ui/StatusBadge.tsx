export function StatusBadge({
  label,
  bg,
  fg,
}: {
  label: string
  bg: string
  fg: string
}) {
  return (
    <span
      className="inline-block rounded-lg px-2 py-[3px] text-[10px] font-medium whitespace-nowrap"
      style={{ backgroundColor: bg, color: fg }}
    >
      {label}
    </span>
  )
}
