export function KpiTile({
  value,
  label,
  bg,
  valueFg,
  labelFg,
}: {
  value: number
  label: string
  bg: string
  valueFg: string
  labelFg: string
}) {
  return (
    <div
      className="rounded-lg py-2 flex flex-col items-center gap-1"
      style={{ backgroundColor: bg }}
    >
      <span className="text-[18px] font-semibold" style={{ color: valueFg }}>
        {value}
      </span>
      <span className="text-[10px]" style={{ color: labelFg }}>
        {label}
      </span>
    </div>
  )
}
