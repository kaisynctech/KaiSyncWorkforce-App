'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney, roundFinancial } from '@/lib/finance-calc'
import {
  approveContractorPayout,
  approveSupplierInvoice,
  markContractorPayoutPaid,
  markSupplierPaid,
  rejectContractorPayout,
  rejectSupplierInvoice,
} from '@/lib/finance-api'
import type { FinanceAuditEntry, ContractorPayout, SupplierInvoice } from '@/lib/finance-types'

type PendingItem =
  | { kind: 'supplier'; row: SupplierInvoice }
  | { kind: 'payout'; row: ContractorPayout }

export default function FinanceApprovalsPage() {
  const [items, setItems] = useState<PendingItem[]>([])
  const [audit, setAudit] = useState<FinanceAuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [actor, setActor] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    const { data: emp } = await supabase.from('employees').select('name, surname').eq('id', member.employeeId).maybeSingle()
    setActor({ id: member.employeeId, name: emp ? `${emp.name} ${emp.surname}` : 'User' })

    const [{ data: suppliers }, { data: payouts }, { data: auditRows }] = await Promise.all([
      supabase
        .from('supplier_invoices')
        .select('*, contractors!supplier_invoices_supplier_id_fkey(name)')
        .eq('company_id', member.companyId)
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false }),
      supabase
        .from('contractor_payouts')
        .select('*, contractors(name)')
        .eq('company_id', member.companyId)
        .in('payout_status', ['pending', 'approved'])
        .order('created_at', { ascending: false }),
      supabase
        .from('finance_audit_log')
        .select('*')
        .eq('company_id', member.companyId)
        .order('created_at', { ascending: false })
        .limit(30),
    ])

    const pending: PendingItem[] = [
      ...((suppliers ?? []) as SupplierInvoice[]).map(row => ({ kind: 'supplier' as const, row })),
      ...((payouts ?? []) as ContractorPayout[])
        .filter(p => p.approval_status === 'pending' || p.payout_status === 'pending' || p.payout_status === 'approved')
        .map(row => ({ kind: 'payout' as const, row })),
    ]
    setItems(pending)
    setAudit((auditRows ?? []) as FinanceAuditEntry[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function act(key: string, fn: () => Promise<void>) {
    if (!actor) return
    setBusy(key)
    try {
      await fn()
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      <h1 className="text-[18px] font-semibold text-text-primary">Finance Approvals</h1>

      {loading ? (
        <p className="text-[13px] text-text-secondary">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-text-secondary">No pending payables.</p>
      ) : (
        <div className="space-y-2">
          {items.map(item => {
            if (item.kind === 'supplier') {
              const r = item.row
              const name = (r.contractors as { name: string } | null)?.name ?? 'Supplier'
              const key = `s-${r.id}`
              return (
                <div key={key} className="card p-4 flex flex-wrap items-center gap-3 justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">{name}</p>
                    <p className="text-[12px] text-text-secondary">
                      Supplier invoice · {r.invoice_number || '—'} · {fmtMoney(r.total_amount)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={busy === key}
                      onClick={() => act(key, async () => {
                        const supabase = createClient()
                        await rejectSupplierInvoice(supabase, r.id, actor!.id, actor!.name)
                      })}
                      className="h-8 px-3 rounded-md text-[12px] bg-error-dark text-error"
                    >
                      Reject
                    </button>
                    <button
                      disabled={busy === key}
                      onClick={() => act(key, async () => {
                        const supabase = createClient()
                        await approveSupplierInvoice(supabase, r.id, actor!.id, actor!.name)
                      })}
                      className="h-8 px-3 rounded-md text-[12px] bg-success-dark text-success"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busy === key}
                      onClick={() => act(key, async () => {
                        const supabase = createClient()
                        await approveSupplierInvoice(supabase, r.id, actor!.id, actor!.name)
                        await markSupplierPaid(supabase, r.id, Number(r.balance_due || r.total_amount), 'eft', actor!.id, actor!.name)
                      })}
                      className="h-8 px-3 rounded-md text-[12px] bg-primary text-white"
                    >
                      Approve & pay
                    </button>
                  </div>
                </div>
              )
            }

            const r = item.row
            const name = (r.contractors as { name: string } | null)?.name ?? 'Contractor'
            const net = roundFinancial(Number(r.total_amount) - Number(r.retention_amount ?? 0))
            const key = `p-${r.id}`
            const needsApprove = r.approval_status === 'pending' || r.payout_status === 'pending'
            return (
              <div key={key} className="card p-4 flex flex-wrap items-center gap-3 justify-between">
                <div>
                  <p className="text-[13px] font-medium text-text-primary">{name}</p>
                  <p className="text-[12px] text-text-secondary">
                    Contractor payout · {r.payout_status} · {fmtMoney(net)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {needsApprove && (
                    <>
                      <button
                        disabled={busy === key}
                        onClick={() => act(key, async () => {
                          const supabase = createClient()
                          await rejectContractorPayout(supabase, r.id, actor!.id, actor!.name)
                        })}
                        className="h-8 px-3 rounded-md text-[12px] bg-error-dark text-error"
                      >
                        Reject
                      </button>
                      <button
                        disabled={busy === key}
                        onClick={() => act(key, async () => {
                          const supabase = createClient()
                          await approveContractorPayout(supabase, r.id, actor!.id, actor!.name)
                        })}
                        className="h-8 px-3 rounded-md text-[12px] bg-success-dark text-success"
                      >
                        Approve
                      </button>
                    </>
                  )}
                  {(r.payout_status === 'approved' || r.approval_status === 'approved') && r.payout_status !== 'paid' && (
                    <button
                      disabled={busy === key}
                      onClick={() => act(key, async () => {
                        const supabase = createClient()
                        if (needsApprove) await approveContractorPayout(supabase, r.id, actor!.id, actor!.name)
                        await markContractorPayoutPaid(supabase, r.id, 'eft', actor!.id, actor!.name)
                      })}
                      className="h-8 px-3 rounded-md text-[12px] bg-primary text-white"
                    >
                      Mark paid
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div>
        <p className="text-[11px] font-semibold text-text-secondary tracking-wide mb-2">RECENT AUDIT</p>
        <div className="bg-surface rounded-lg border border-divider divide-y divide-divider">
          {audit.length === 0 ? (
            <p className="p-4 text-[13px] text-text-secondary">No audit entries yet.</p>
          ) : audit.map(a => (
            <div key={a.id} className="px-4 py-2.5 flex justify-between gap-3 text-[12px]">
              <div>
                <span className="font-medium text-text-primary capitalize">{a.action}</span>
                {' · '}
                <span className="text-text-secondary">{a.entity_type.replace(/_/g, ' ')}</span>
                {a.actor_name && <span className="text-text-secondary"> · {a.actor_name}</span>}
              </div>
              <div className="text-text-secondary shrink-0">
                {a.amount != null ? fmtMoney(Number(a.amount)) : ''} · {a.created_at.slice(0, 16).replace('T', ' ')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
