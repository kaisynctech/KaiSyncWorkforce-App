'use client'

import { useEffect, useState } from 'react'
import { documentTypeLabel } from '@/lib/contractor-portal/compliance'
import type { ContractorDocument } from '@/lib/contractor-portal/types'

type Due = { id: string; label: string; days: number; expiry: string }

/** Approved documents of theirs that expire within 30 days or have expired (same 30/7/0 rule as HR reminders). */
export function dueDocuments(docs: ContractorDocument[], today = new Date()): Due[] {
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return docs
    .filter(d => d.is_current !== false && (d.direction ?? 'from_party') === 'from_party'
      && d.approval_status === 'approved' && d.expiry_date)
    .map(d => {
      const [y, m, day] = (d.expiry_date as string).slice(0, 10).split('-').map(Number)
      return {
        id: d.id,
        label: d.document_name && d.document_name !== 'none' ? d.document_name : documentTypeLabel(d.document_type),
        days: Math.round((Date.UTC(y, m - 1, day) - start) / 86400000),
        expiry: d.expiry_date as string,
      }
    })
    .filter(d => d.days <= 30)
    .sort((a, b) => a.days - b.days)
}

function when(d: Due) {
  if (d.days < 0) return `expired ${-d.days === 1 ? 'yesterday' : `${-d.days} days ago`}`
  if (d.days === 0) return 'expires today'
  return `expires in ${d.days} day${d.days === 1 ? '' : 's'}`
}

/** Home-page reminder in the contractor and client portals. Hidden when nothing is due. */
export function PortalComplianceReminder({ load, href, onOpen }: {
  load: () => Promise<ContractorDocument[]>
  href?: string
  onOpen?: () => void
}) {
  const [due, setDue] = useState<Due[]>([])

  useEffect(() => {
    let alive = true
    load().then(d => { if (alive) setDue(dueDocuments(d)) }).catch(() => { /* reminder is optional */ })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (due.length === 0) return null
  const expired = due.some(d => d.days < 0)
  const box = expired ? 'bg-error/10 border-error/25' : 'bg-warning/10 border-warning/30'
  const fg = expired ? 'text-error' : 'text-warning'
  const content = (
    <>
      <p className={`text-[13px] font-semibold ${fg}`}>
        {due.length === 1 ? 'A compliance document needs replacing' : `${due.length} compliance documents need replacing`}
      </p>
      <ul className="mt-1 space-y-0.5">
        {due.slice(0, 4).map(d => (
          <li key={d.id} className="text-[12px] text-text-secondary">{d.label} — {when(d)}</li>
        ))}
      </ul>
      <p className="text-[12px] text-text-secondary mt-1">Tap to upload the new one under Compliance.</p>
    </>
  )
  return href
    ? <a href={href} className={`block border rounded-xl px-4 py-3 ${box}`}>{content}</a>
    : <button type="button" onClick={onOpen} className={`block w-full text-left border rounded-xl px-4 py-3 ${box}`}>{content}</button>
}
