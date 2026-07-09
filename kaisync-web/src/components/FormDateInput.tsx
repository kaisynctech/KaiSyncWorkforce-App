import { cn } from '@/lib/utils'

interface FormDateInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export function FormDateInput({ label, className, ...props }: FormDateInputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-[12px] font-medium text-text-secondary">{label}</label>
      )}
      <input
        type="date"
        className={cn(
          'w-full h-12 px-3 rounded-sm bg-surface-elevated border border-border text-[14px] text-text-primary',
          'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary',
          'transition-colors disabled:opacity-50',
          className
        )}
        {...props}
      />
    </div>
  )
}
