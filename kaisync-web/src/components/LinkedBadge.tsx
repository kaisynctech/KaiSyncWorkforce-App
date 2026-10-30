/** Small mark on a client or contractor that is joined to another KaiSync company. */
export function LinkedBadge({ linked }: { linked: boolean }) {
  if (!linked) return null
  return (
    <span
      className="material-icons text-primary text-[15px] align-middle shrink-0"
      title="Linked on KaiSync"
      aria-label="Linked on KaiSync"
    >
      link
    </span>
  )
}

/** "Linked on KaiSync only" switch for the client and contractor lists. */
export function LinkedOnlyToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      className={`h-8 px-3 inline-flex items-center gap-1 rounded-md border text-[12px] font-medium shrink-0 transition-colors ${value ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-divider hover:text-text-primary'}`}
    >
      <span className="material-icons text-[15px]">link</span>
      Linked on KaiSync
    </button>
  )
}
