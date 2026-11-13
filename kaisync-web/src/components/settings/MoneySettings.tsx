'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Company } from '@/types/database'

/**
 * Settings → Money: every money setting in one list, each with where it stands and one tap to change it.
 * The controls stay where they already work (company details, Integrations, Client accounts); quotation
 * templates and "your business" join this page in piece 5b.
 */

type Row = {
  key: string
  icon: string
  title: string
  status: string
  tone: 'ok' | 'warn' | 'off'
  action: { label: string; tab?: string; href?: string }
}

export function MoneySettings({ company, xeroConnected, onOpenTab }: {
  company: Company
  xeroConnected: boolean
  onOpenTab: (tab: 'general' | 'integrations') => void
}) {
  const [reminders, setReminders] = useState<{ on: boolean; after: number | null; every: number | null } | null>(null)

  useEffect(() => {
    let live = true
    void createClient().from('companies')
      .select('auto_reminders_enabled, auto_reminder_after_days, auto_reminder_every_days')
      .eq('id', company.id).maybeSingle()
      .then(({ data }) => {
        if (!live) return
        const d = data as { auto_reminders_enabled?: boolean | null; auto_reminder_after_days?: number | null; auto_reminder_every_days?: number | null } | null
        setReminders({ on: !!d?.auto_reminders_enabled, after: d?.auto_reminder_after_days ?? null, every: d?.auto_reminder_every_days ?? null })
      })
    return () => { live = false }
  }, [company.id])

  const bankSet = Boolean(company.bank_name && company.bank_account_number)
  const rows: Row[] = [
    {
      key: 'vat', icon: 'percent', title: 'Business & VAT',
      status: company.is_vat_registered ? `VAT registered${company.vat_number ? ` · ${company.vat_number}` : ''} · 15% on documents` : 'Not VAT registered · no VAT on your documents',
      tone: 'ok', action: { label: 'Change', tab: 'general' },
    },
    {
      key: 'bank', icon: 'account_balance', title: 'Banking details (where clients pay)',
      status: bankSet
        ? `${company.bank_name}${company.bank_account_holder ? ` · ${company.bank_account_holder}` : ''} · on ${[company.show_bank_on_invoices !== false && 'invoices', company.show_bank_on_quotes && 'quotations'].filter(Boolean).join(' and ') || 'no documents'}`
        : 'Not filled in: clients can’t see where to pay you or your deposits',
      tone: bankSet ? 'ok' : 'warn', action: { label: bankSet ? 'Change' : 'Add banking details', tab: 'general' },
    },
    {
      key: 'footer', icon: 'notes', title: 'Note at the bottom of documents',
      status: company.document_footer?.trim() ? company.document_footer.trim() : 'None',
      tone: company.document_footer?.trim() ? 'ok' : 'off', action: { label: 'Change', tab: 'general' },
    },
    {
      key: 'reminders', icon: 'notifications_active', title: 'Automatic payment reminders',
      status: reminders === null ? 'Checking…'
        : reminders.on ? `On · first ${reminders.after ?? '?'} days after the due date, then every ${reminders.every ?? '?'} days` : 'Off: overdue clients aren’t reminded automatically',
      tone: reminders?.on ? 'ok' : 'off', action: { label: 'Change', href: '/dashboard/money?tab=clients' },
    },
    {
      key: 'email', icon: 'alternate_email', title: 'Send documents from your own email domain',
      status: 'Quotations, invoices and statements can come from your own address',
      tone: 'off', action: { label: 'Set up', tab: 'general' },
    },
    {
      key: 'xero', icon: 'sync', title: 'Xero',
      status: xeroConnected ? 'Connected' : 'Not connected',
      tone: xeroConnected ? 'ok' : 'off', action: { label: xeroConnected ? 'Manage' : 'Connect', tab: 'integrations' },
    },
  ]

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[16px] font-semibold text-text-primary">Money settings</h2>
        <p className="text-[13px] text-text-secondary mt-0.5">Everything that shapes your quotations, invoices and payments, in one place.</p>
      </div>
      <ul className="flex flex-col bg-surface-card border border-divider rounded-2xl divide-y divide-divider overflow-hidden">
        {rows.map(r => (
          <li key={r.key} className="flex items-center gap-3 px-4 py-3 min-h-[60px]">
            <span className={`material-icons text-[20px] shrink-0 ${r.tone === 'warn' ? 'text-amber-600' : r.tone === 'ok' ? 'text-emerald-600' : 'text-text-secondary'}`}>{r.icon}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-medium text-text-primary">{r.title}</span>
              <span className={`block text-[12.5px] ${r.tone === 'warn' ? 'text-amber-700' : 'text-text-secondary'} line-clamp-2`}>{r.status}</span>
            </span>
            {r.action.href
              ? <Link href={r.action.href} prefetch={false} className="btn-outlined h-10 px-3.5 text-[13px] inline-flex items-center shrink-0">{r.action.label}</Link>
              : <button type="button" onClick={() => onOpenTab(r.action.tab as 'general' | 'integrations')} className="btn-outlined h-10 px-3.5 text-[13px] shrink-0">{r.action.label}</button>}
          </li>
        ))}
      </ul>
    </section>
  )
}
