'use client'

export type MoneyNotice = {
  id: string
  label: string
  title: string
  detail: string
  when: string | null
  tone: 'amber' | 'red' | 'blue'
  onOpen: () => void
}

const TONE = {
  amber: { bg: '#FEF3C7', fg: '#92400E' },
  red: { bg: '#FEE2E2', fg: '#991B1B' },
  blue: { bg: '#DBEAFE', fg: '#1E40AF' },
}

function fmtDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

/** Invoice and quote alerts that used to sit on Clients, Projects, and Contractors. */
export function MoneyNotices({ items }: { items: MoneyNotice[] }) {
  if (items.length === 0) return null
  return (
    <div className="mx-4 mt-3 bg-surface rounded-lg border border-divider overflow-hidden shrink-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-divider">
        <span className="material-icons text-primary text-[16px]">bolt</span>
        <span className="font-semibold text-[11px] text-primary uppercase tracking-wider">Action centre</span>
        <span className="text-text-secondary text-[11px]">{items.length} pending</span>
      </div>
      <div className="max-h-[120px] overflow-y-auto">
        {items.map(item => {
          const colors = TONE[item.tone]
          return (
            <div
              key={item.id}
              className="flex flex-col sm:grid sm:items-center gap-1 px-3 py-1.5 border-t border-divider first:border-t-0"
              style={{ gridTemplateColumns: '130px 1fr 90px 70px' }}
            >
              <span
                className="rounded-[5px] px-[6px] py-[3px] text-[10px] font-medium w-fit"
                style={{ backgroundColor: colors.bg, color: colors.fg }}
              >
                {item.label}
              </span>
              <div className="overflow-hidden min-w-0">
                <p className="text-text-primary text-[12px] font-medium truncate">{item.title}</p>
                <p className="text-text-secondary text-[11px] truncate">{item.detail}</p>
              </div>
              <div className="flex items-center justify-between sm:contents gap-2">
                <p className="text-text-secondary text-[11px] sm:text-right">{fmtDate(item.when)}</p>
                <button
                  type="button"
                  onClick={item.onOpen}
                  className="text-primary text-[12px] h-7 sm:h-6 px-2 sm:text-right hover:opacity-70 transition-opacity"
                >
                  Open →
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
