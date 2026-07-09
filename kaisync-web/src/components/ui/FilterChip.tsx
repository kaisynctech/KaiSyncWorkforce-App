export function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-[14px] h-8 px-3 text-[12px] font-medium border-0 transition-colors"
      style={{
        backgroundColor: active ? '#1E3A5F' : '#E5E7EB',
        color: active ? '#FFFFFF' : '#6B7280',
      }}
    >
      {label}
    </button>
  )
}
