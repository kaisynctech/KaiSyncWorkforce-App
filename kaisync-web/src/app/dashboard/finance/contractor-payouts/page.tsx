'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { calculateVatExclusive, fmtMoney, roundFinancial } from '@/lib/finance-calc'
import { markContractorPayoutPaid } from '@/lib/finance-api'
import type { ContractorPayout } from '@/lib/finance-types'

type ContractorOpt = { id: string; name: string }

function netPayable(p: ContractorPayout) {
  return roundFinancial(Number(p.total_amount ?? 0) - Number(p.retention_amount ?? 0))
}

export default function ContractorPayoutsPage() {
  const [rows, setRows] = useState<ContractorPayout[]>([])
  const [contractors, setContractors] = useState<ContractorOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [contractorId, setContractorId] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [actor, setActor] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    const { data: emp } = await supabase.from('employees').select('name, surname').eq('id', member.employeeId).maybeSingle()
    setActor({ id: member.employeeId, name: emp ? `${emp.name} ${emp.surname}` : 'User' })

    const [{ data }, { data: cons }] = await Promise.all([
      supabase
        .from('contractor_payouts')
        .select('*, contractors(name, bank_account, bank_name)')
        .eq('company_id', member.companyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('contractors')
        .select('id, name')
        .eq('company_id', member.companyId)
        .eq('is_active', true)
        .order('name'),
    ])
    setRows((data ?? []) as ContractorPayout[])
    setContractors((cons ?? []) as ContractorOpt[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const approved = useMemo(
    () => rows.filter(r => r.payout_status === 'approved' || (r.approval_status === 'approved' && r.payout_status !== 'paid')),
    [rows],
  )

  async function create() {
    if (!companyId || !contractorId || !(Number(amount) > 0)) return
    setBusy(true)
    const supabase = createClient()
    const calc = calculateVatExclusive(Number(amount), 0.15)
    await supabase.from('contractor_payouts').insert({
      company_id: companyId,
      contractor_id: contractorId,
      subtotal: calc.subtotal,
      vat_rate: 0.15,
      vat_amount: calc.vatAmount,
      total_amount: calc.totalAmount,
      retention_amount: 0,
      is_vat_inclusive: false,
      tax_type: 'standard',
      payout_status: 'pending',
      approval_status: 'pending',
      created_by: actor?.id ?? null,
    })
    setShowAdd(false)
    setAmount(''); setContractorId('')
    setBusy(false)
    await load()
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runPayment() {
    if (!actor || selected.size === 0) return
    setBusy(true)
    const supabase = createClient()
    for (const id of selected) {
      await markContractorPayoutPaid(supabase, id, 'eft', actor.id, actor.name)
    }
    setSelected(new Set())
    setBusy(false)
    await load()
  }

  function exportEftCsv() {
    const picks = rows.filter(r => selected.has(r.id) || (selected.size === 0 && r.payout_status === 'approved'))
    const csv = [
      'Contractor,Bank,Account,Amount,Reference',
      ...picks.map(r => {
        const c = r.contractors as { name?: string; bank_name?: string | null; bank_account?: string | null } | null
        return `"${c?.name ?? ''}","${c?.bank_name ?? ''}","${c?.bank_account ?? ''}",${netPayable(r)},"${r.id.slice(0, 8)}"`
      }),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `eft-payouts-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 gap-2 flex-wrap">
        <h1 className="text-[18px] font-semibold text-text-primary">Contractor Payouts</h1>
        <div className="flex gap-2">
          <button onClick={exportEftCsv} className="btn-outlined h-9 px-3 text-[13px]">EFT CSV</button>
          <button onClick={runPayment} disabled={busy || selected.size === 0} className="btn-outlined h-9 px-3 text-[13px] disabled:opacity-50">
            Mark paid ({selected.size})
          </button>
          <button onClick={() => setShowAdd(true)} className="btn-primary h-9 px-3 text-[13px]">+ Payout</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : (
          <table className="w-full" style={{ minWidth: 860 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th w-10"></th>
                <th className="data-th text-left">Contractor</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-left">Approval</th>
                <th className="data-th text-right">Net</th>
                <th className="data-th text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-divider">
                  <td className="data-td">
                    {(r.payout_status === 'approved' || approved.some(a => a.id === r.id)) && r.payout_status !== 'paid' && (
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                    )}
                  </td>
                  <td className="data-td text-[13px]">{(r.contractors as { name: string } | null)?.name ?? '—'}</td>
                  <td className="data-td text-[12px] capitalize">{r.payout_status}</td>
                  <td className="data-td text-[12px] capitalize">{r.approval_status}</td>
                  <td className="data-td text-[13px] text-right">{fmtMoney(netPayable(r))}</td>
                  <td className="data-td text-[12px] text-text-secondary">{r.payout_date ?? r.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="text-center text-[13px] text-text-secondary py-10">No payouts</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">New contractor payout</h3>
            <select value={contractorId} onChange={e => setContractorId(e.target.value)} className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">Select contractor…</option>
              {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount ex VAT" className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button onClick={create} disabled={busy || !contractorId} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">{busy ? '…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
