'use client'

/**
 * One line under an email dialog's title: who the email comes from and where replies go.
 *   personal → quotes, invoices, credit notes, statements/reminders, purchase orders, RFQs: in your name, replies to you.
 *   company  → receipts, remittance advice: in the company's name, replies to the company email.
 * Matches supabase/functions/_shared/sender.ts.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type SendMode = 'personal' | 'company'

export function SenderNote({ companyId, mode }: { companyId: string; mode: SendMode }) {
  const [me, setMe] = useState<string | null>(null)
  const [companyEmail, setCompanyEmail] = useState<string | null>(null)

  useEffect(() => {
    let off = false
    const supabase = createClient()
    void Promise.all([
      supabase.auth.getUser(),
      supabase.from('companies').select('contact_email').eq('id', companyId).maybeSingle(),
    ]).then(([{ data: u }, { data: co }]) => {
      if (off) return
      setMe(u.user?.email ?? '')
      setCompanyEmail(((co as { contact_email?: string | null } | null)?.contact_email ?? '').trim())
    })
    return () => { off = true }
  }, [companyId])

  if (me === null || companyEmail === null) return null
  if (mode === 'personal') {
    return (
      <p className="text-[12px] text-text-secondary flex items-start gap-1.5">
        <span className="material-icons text-[15px] mt-px">person</span>
        <span>Sent in your name with the company&apos;s details. Replies come to you{me ? <> at <span className="font-medium text-text-primary">{me}</span></> : ''}.</span>
      </p>
    )
  }
  return companyEmail ? (
    <p className="text-[12px] text-text-secondary flex items-start gap-1.5">
      <span className="material-icons text-[15px] mt-px">business</span>
      <span>Sent in the company&apos;s name. Replies go to <span className="font-medium text-text-primary">{companyEmail}</span>.</span>
    </p>
  ) : (
    <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      Sent in the company&apos;s name, but your company has no email address yet, so replies come to you. Add one in{' '}
      <a href="/dashboard/settings?tab=general" className="font-semibold underline">Settings → General</a>.
    </p>
  )
}
