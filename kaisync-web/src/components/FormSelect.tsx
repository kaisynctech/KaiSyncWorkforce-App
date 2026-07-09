import { cn } from '@/lib/utils'

interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  hint?: string
}

export function FormSelect({ label, hint, className, children, ...props }: FormSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-[12px] font-medium text-text-secondary">{label}</label>
      )}
      <select
        className={cn(
          'w-full h-12 px-3 rounded-sm bg-surface-elevated border border-border text-[14px] text-text-primary',
          'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
          'appearance-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
          className
        )}
        {...props}
      >
        {children}
      </select>
      {hint && <p className="text-[11px] text-text-secondary">{hint}</p>}
    </div>
  )
}
