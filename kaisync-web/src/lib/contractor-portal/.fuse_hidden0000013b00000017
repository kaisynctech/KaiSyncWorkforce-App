/**
 * Contractor portal compliance scoring — mirrors MAUI RebuildComplianceView /
 * BuildPortalChecklist.
 */

import {
  CONTRACTOR_DOC_TYPES,
  type CompliancePackItem,
  type ComplianceView,
  type ContractorDocument,
  type PackChecklistRow,
} from './types'

export function documentTypeLabel(raw: string): string {
  const hit = CONTRACTOR_DOC_TYPES.find(t => t.value === raw)
  return hit?.label ?? (raw?.trim() || '—')
}

function todayDateOnly(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDaysDateOnly(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isDocApproved(d: ContractorDocument): boolean {
  return d.approval_status === 'approved'
}

export function isDocPending(d: ContractorDocument): boolean {
  return d.approval_status === 'pending'
}

export function isDocRejected(d: ContractorDocument): boolean {
  return d.approval_status === 'rejected'
}

export function isDocExpired(d: ContractorDocument): boolean {
  if (!d.expiry_date) return false
  return d.expiry_date < todayDateOnly()
}

export function isDocExpiringSoon(d: ContractorDocument): boolean {
  if (!d.expiry_date || isDocExpired(d)) return false
  return d.expiry_date <= addDaysDateOnly(30)
}

export function expiryDisplay(d: ContractorDocument): string {
  if (!d.expiry_date) return 'No expiry'
  const dt = new Date(`${d.expiry_date}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return d.expiry_date
  return dt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function uploadedDisplay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return '—'
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function statusTableLabel(d: ContractorDocument): string {
  if (d.approval_status === 'approved') {
    if (isDocExpired(d)) return 'Expired'
    if (isDocExpiringSoon(d)) return 'Expiring'
    return 'Approved'
  }
  if (d.approval_status === 'rejected') return 'Rejected'
  if (d.approval_status === 'pending') return 'Pending'
  return d.approval_status || '—'
}

function countsForScore(status: PackChecklistRow['status']): boolean {
  return status === 'complete' || status === 'expiring'
}

export function buildPortalChecklist(
  packItems: CompliancePackItem[],
  docs: ContractorDocument[],
): PackChecklistRow[] {
  return [...packItems]
    .sort((a, b) => {
      const ar = a.requirement === 'required' ? 0 : 1
      const br = b.requirement === 'required' ? 0 : 1
      if (ar !== br) return ar - br
      return (a.sort_order ?? 0) - (b.sort_order ?? 0)
    })
    .map(item => {
      const docsOfType = docs.filter(d => d.document_type === item.document_type && d.is_current)
      const bestApproved = [...docsOfType]
        .filter(isDocApproved)
        .sort((a, b) => {
          const ae = isDocExpired(a) ? 1 : 0
          const be = isDocExpired(b) ? 1 : 0
          if (ae !== be) return ae - be
          const ax = isDocExpiringSoon(a) ? 1 : 0
          const bx = isDocExpiringSoon(b) ? 1 : 0
          if (ax !== bx) return ax - bx
          return b.created_at.localeCompare(a.created_at)
        })[0]

      let status: PackChecklistRow['status']
      let expiry_display: string | null = null

      if (bestApproved) {
        if (isDocExpired(bestApproved)) {
          status = 'expired'
          expiry_display = expiryDisplay(bestApproved)
        } else if (isDocExpiringSoon(bestApproved)) {
          status = 'expiring'
          expiry_display = expiryDisplay(bestApproved)
        } else {
          status = 'complete'
          expiry_display = bestApproved.expiry_date ? expiryDisplay(bestApproved) : null
        }
      } else if (docsOfType.some(isDocPending)) {
        status = 'pending'
      } else if (docsOfType.some(isDocRejected)) {
        status = 'rejected'
      } else {
        status = 'missing'
      }

      return {
        document_type: item.document_type,
        type_label: documentTypeLabel(item.document_type),
        is_required: item.requirement === 'required',
        status,
        expiry_display,
      }
    })
}

export function buildComplianceView(
  docs: ContractorDocument[],
  packItems: CompliancePackItem[],
): ComplianceView {
  const has_pack = packItems.length > 0
  let checklist: PackChecklistRow[] = []
  let missing_rows: PackChecklistRow[] = []
  let required_count = 0
  let complete_count = 0
  let missing_count = 0
  let expiring_count = 0
  let rejected_count = 0

  if (has_pack) {
    checklist = buildPortalChecklist(packItems, docs)
    const required = checklist.filter(r => r.is_required)
    required_count = required.length
    complete_count = required.filter(r => countsForScore(r.status)).length
    missing_count = required.filter(r => r.status === 'missing').length
    expiring_count = required.filter(r => r.status === 'expiring').length
    rejected_count = required.filter(r => r.status === 'rejected').length
    missing_rows = checklist.filter(
      r => r.is_required && (r.status === 'missing' || r.status === 'rejected'),
    )
  } else {
    const req = docs.filter(d => d.is_required)
    required_count = req.length
    complete_count = req.filter(d => isDocApproved(d) && !isDocExpired(d)).length
    missing_count = 0
    expiring_count = req.filter(d => isDocExpiringSoon(d)).length
    rejected_count = req.filter(isDocRejected).length
  }

  const approved_count = docs.filter(d => isDocApproved(d) && !isDocExpired(d)).length
  const score_percent = required_count === 0
    ? 0
    : Math.round((complete_count * 100) / required_count)
  const score_progress = required_count === 0
    ? 0
    : Math.round((complete_count / required_count) * 100) / 100

  const status_label = required_count === 0
    ? 'Not Configured'
    : score_percent >= 100
      ? 'Compliant'
      : score_percent >= 80
        ? 'Near Compliant'
        : score_percent >= 50
          ? 'Partial'
          : 'Non-Compliant'

  const expiring_docs = docs
    .filter(d => isDocExpiringSoon(d))
    .sort((a, b) => (a.expiry_date ?? '').localeCompare(b.expiry_date ?? ''))

  const rejected_docs = docs
    .filter(isDocRejected)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  return {
    has_pack,
    score_percent,
    score_progress,
    status_label,
    required_count,
    complete_count,
    missing_count,
    expiring_count,
    rejected_count,
    approved_count,
    checklist,
    missing_rows,
    expiring_docs,
    rejected_docs,
  }
}

export function checklistStatusLabel(status: PackChecklistRow['status']): string {
  switch (status) {
    case 'complete': return 'Complete'
    case 'expiring': return 'Expiring'
    case 'expired': return 'Expired'
    case 'pending': return 'Pending'
    case 'rejected': return 'Rejected'
    default: return 'Missing'
  }
}
