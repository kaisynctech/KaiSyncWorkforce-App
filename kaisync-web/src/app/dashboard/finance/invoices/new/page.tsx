'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { calculateVatExclusive, roundFinancial } from '@/lib/finance-calc'

type ClientOpt = { id: string; name: string }

export default function NewFinanceInvoicePage() {
  const router = useRouter()
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [clientId, setClientId] = useState('')
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [description, setDescription] = useState('Professional services')
  const [amount, setAmount] = useState('0')
  const [vatRate, setVatRate] = useState('15')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) return
      const { data } = await supabase
        .from('clients')
        .select('id, name')
        .eq('company_id', member.companyId)
        .order('name')
      setClients((data ?? []) as ClientOpt[])
    })()
  }, [])

  async function save(send: boolean) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setBusy(false); return }

    const rate = Number(vatRate) / 100
    const calc = calculateVatExclusive(Number(amount) || 0, rate)
    const { data: inv, error: e } = await supabase
      .from('finance_invoices')
      .insert({
        company_id: member.companyId,
        client_id: clientId || null,
        invoice_number: null,
        status: send ? 'sent' : 'draft',
        currency: 'ZAR',
        subtotal: calc.subtotal,
        vat_rate: rate,
        vat_amount: calc.vatAmount,
        total_amount: calc.totalAmount,
        amount_paid: 0,
        balance_due: calc.totalAmount,
        is_vat_inclusive: false,
        tax_type: 'standard',
        issue_date: issueDate,
        due_date: dueDate || null,
        created_by: member.employeeId,
      })
      .select('id')
      .single()

    if (e || !inv) {
      setError(e?.message ?? 'Failed to create invoice')
      setBusy(false)
      return
    }

    await supabase.from('finance_invoice_lines').insert({
      invoice_id: inv.id,
      company_id: member.companyId,
      line_no: 1,
      description: description.trim() || 'Line item',
      quantity: 1,
      unit_price: roundFinancial(Number(amount) || 0),
      vat_rate: rate,
      vat_amount: calc.vatAmount,
      subtotal: calc.subtotal,
      total_amount: calc.totalAmount,
      is_vat_inclusive: false,
      tax_type: 'standard',
    })

    router.replace(`/dashboard/finance/invoices/${inv.id}`)
  }

  return (
    <div className="h-full overflow-y-auto p-4 max-w-lg mx-auto space-y-4">
      <h1 className="text-[18px] font-semibold text-text-primary">New Invoice</h1>
      {error && <p className="text-[13px] text-error">{error}</p>}
      <label className="block text-[12px] text-text-secondary">Client
        <select value={clientId} onChange={e => setClientId(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
          <option value="">Select client…</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[12px] text-text-secondary">Issue date
          <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
        </label>
        <label className="block text-[12px] text-text-secondary">Due date
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
        </label>
      </div>
      <label className="block text-[12px] text-text-secondary">Description
        <input value={description} onChange={e => setDescription(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[12px] text-text-secondary">Amount (ex VAT)
          <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
        </label>
        <label className="block text-[12px] text-text-secondary">VAT %
          <input type="number" step="0.01" value={vatRate} onChange={e => setVatRate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
        </label>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => router.back()} className="btn-outlined h-10 px-4 text-[13px]">Cancel</button>
        <button onClick={() => save(false)} disabled={busy} className="btn-outlined h-10 px-4 text-[13px] disabled:opacity-50">Save draft</button>
        <button onClick={() => save(true)} disabled={busy} className="btn-primary h-10 px-4 text-[13px] disabled:opacity-50">{busy ? '…' : 'Save & send'}</button>
      </div>
    </div>
  )
}
