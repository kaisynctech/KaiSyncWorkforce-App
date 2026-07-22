/** Status / date formatting for client portal. */

const STATUS_LABELS: Record<string, string> = {
  lead: 'Lead',
  quoted: 'Quoted',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  on_hold: 'On hold',
}

export function projectStatusLabel(raw: string | null | undefined): string {
  const key = (raw ?? '').toLowerCase()
  if (STATUS_LABELS[key]) return STATUS_LABELS[key]
  if (!raw) return '—'
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`)
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900) return '—'
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function isDateSet(iso: string | null | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`)
  return !Number.isNaN(d.getTime()) && d.getFullYear() >= 1900
}
