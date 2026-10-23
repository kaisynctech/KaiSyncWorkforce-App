import { cloneElement, isValidElement, useId } from 'react'
import { FormDateInput } from '@/components/FormDateInput'
import { FormSelect } from '@/components/FormSelect'

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

const LINKABLE = new Set(['input', 'select', 'textarea'])

/**
 * Label + one control. When the child is a single input/select/textarea (or a component that
 * forwards `id`, such as FormSelect), the label is linked to it so screen readers announce the
 * label and clicking the label focuses the control. The hint is linked with aria-describedby.
 */
export function FormField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  const autoId = useId()
  const hintId = `${autoId}-hint`
  let controlId: string | undefined
  let content = children
  if (isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)) {
    const t = children.type
    const linkable = typeof t === 'string' ? LINKABLE.has(t) : t === FormSelect || t === FormDateInput
    if (linkable) {
      controlId = children.props.id ?? autoId
      content = cloneElement(children, {
        id: controlId,
        'aria-describedby': hint ? [children.props['aria-describedby'], hintId].filter(Boolean).join(' ') : children.props['aria-describedby'],
      })
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={controlId} className="text-[12px] font-medium text-text-secondary">{label}</label>
      {content}
      {hint && <p id={hintId} className="text-[11px] text-text-secondary">{hint}</p>}
    </div>
  )
}

export const entryClass =
  'w-full h-12 px-3 rounded-sm bg-surface-elevated border border-border text-[14px] text-text-primary ' +
  'placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary ' +
  'transition-colors disabled:opacity-60 disabled:cursor-default'
