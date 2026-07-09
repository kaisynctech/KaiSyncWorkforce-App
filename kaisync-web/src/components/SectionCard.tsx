interface SectionCardProps {
  title?: string
  children: React.ReactNode
}

export function SectionCard({ title, children }: SectionCardProps) {
  return (
    <div className="bg-surface border border-divider rounded-lg overflow-hidden">
      {title && (
        <div className="px-4 py-2.5 border-b border-divider bg-surface-elevated">
          <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">
            {title}
          </p>
        </div>
      )}
      <div className="p-4 space-y-3">{children}</div>
    </div>
  )
}

export function FormField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-medium text-text-secondary">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-text-secondary">{hint}</p>}
    </div>
  )
}

export const entryClass =
  'w-full h-12 px-3 rounded-sm bg-surface-elevated border border-border text-[14px] text-text-primary ' +
  'placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary ' +
  'transition-colors disabled:opacity-60 disabled:cursor-default'
