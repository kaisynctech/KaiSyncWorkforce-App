'use client'

export function PortalTabs<T extends string>({
  tabs,
  tab,
  onChange,
}: {
  tabs: { id: T; label: string }[]
  tab: T
  onChange: (next: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2 overflow-x-auto">
      {tabs.map(item => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={`h-[38px] px-3 rounded-[10px] text-[12px] font-medium transition-colors whitespace-nowrap shrink-0 border ${
            tab === item.id
              ? 'bg-primary text-white border-primary'
              : 'bg-surface text-text-secondary border-border hover:text-text-primary'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
