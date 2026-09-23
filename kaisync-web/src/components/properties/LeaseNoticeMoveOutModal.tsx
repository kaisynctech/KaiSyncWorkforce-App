'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { depositStatusLabel } from '@/lib/lease-billing'
import {
  addDaysIso,
  completeLeaseMoveOut,
  giveLeaseNotice,
  plannedVacateDate,
  todayIso,
  type MoveOutDepositAction,
} from '@/lib/lease-lifecycle'
import type { PropertyLease } from '@/types/database'

type Mode = 'notice' | 'moveout'

type Props = {
  companyId: string
  lease: PropertyLease
  mode: Mode
  onClose: () => void
  onDone: () => void
}

const fmtMoney = (n: number | null | undefined, currency = 'ZAR') => {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
}

export function LeaseNoticeMoveOutModal({ companyId, lease, mode, onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [noticeDate, setNoticeDate] = useState(() => lease.notice_given_at ?? todayIso())
  const [setEndFromNotice, setSetEndFromNotice] = useState(true)

  const [vacateDate, setVacateDate] = useState(
    () => lease.end_date ?? plannedVacateDate(lease) ?? todayIso(),
  )
  const [moveOutOccupants, setMoveOutOccupants] = useState(true)
  const [depositAction, setDepositAction] = useState<'unchanged' | 'refunded' | 'partially_held' | 'paid'>(
    () => {
      if (lease.deposit_status === 'refunded') return 'refunded'
      if (lease.deposit_status === 'partially_held') return 'partially_held'
      if (lease.deposit_amount && lease.deposit_amount > 0) return 'refunded'
      return 'unchanged'
    },
  )
  const [refundAmount, setRefundAmount] = useState(() => {
    if (lease.deposit_refund_amount != null) return String(lease.deposit_refund_amount)
    if (lease.deposit_paid_amount != null) return String(lease.deposit_paid_amount)
    if (lease.deposit_amount != null) return String(lease.deposit_amount)
    return ''
  })

  const noticeDays = lease.notice_days ?? 30
  const suggestedVacate = useMemo(
    () => addDaysIso(noticeDate, noticeDays),
    [noticeDate, noticeDays],
  )

  async function submitNotice() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const res = await giveLeaseNotice(supabase, {
      companyId,
      lease,
      noticeGivenAt: noticeDate,
      setEndDate: setEndFromNotice,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    onDone()
    onClose()
  }

  async function submitMoveOut() {
    setBusy(true)
    setError(null)
    const amount = refundAmount.trim() ? parseFloat(refundAmount) : 0
    let deposit: MoveOutDepositAction = { kind: 'unchanged' }
    if (depositAction === 'paid') deposit = { kind: 'paid' }
    else if (depositAction === 'refunded') {
      if (!Number.isFinite(amount) || amount < 0) {
        setBusy(false)
        setError('Enter a valid refund amount.')
        return
      }
      deposit = { kind: 'refunded', amount, refundedAt: vacateDate }
    } else if (depositAction === 'partially_held') {
      if (!Number.isFinite(amount) || amount < 0) {
        setBusy(false)
        setError('Enter the amount refunded (held portion stays on the lease).')
        return
      }
      deposit = { kind: 'partially_held', refundAmount: amount, refundedAt: vacateDate }
    }

    const supabase = createClient()
    const res = await completeLeaseMoveOut(supabase, {
      companyId,
      lease,
      vacateDate,
      deposit,
      moveOutUnitOccupants: moveOutOccupants,
      moveOutLinkedResident: true,
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return
    }
    onDone()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <h2 className="text-[16px] font-semibold text-text-primary">
          {mode === 'notice' ? 'Give notice' : 'Complete move-out'}
        </h2>
        <p className="text-[12px] text-text-secondary">
          {lease.tenant_name ?? 'Lease'}
          {lease.deposit_amount != null
            ? ` · Deposit ${fmtMoney(lease.deposit_amount, lease.currency)} (${depositStatusLabel(lease.deposit_status)})`
            : ''}
        </p>

        {mode === 'notice' ? (
          <>
            <p className="text-[12px] text-text-secondary">
              Notice period is <strong>{noticeDays} days</strong>. Suggested vacate date:{' '}
              <strong>{suggestedVacate}</strong>.
            </p>
            <label className="block text-[12px] text-text-secondary">
              Notice given on
              <input
                type="date"
                value={noticeDate}
                onChange={e => setNoticeDate(e.target.value)}
                className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
              />
            </label>
            <label className="flex items-center gap-2 text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={setEndFromNotice}
                onChange={e => setSetEndFromNotice(e.target.checked)}
              />
              Set lease end date to notice + {noticeDays} days ({suggestedVacate})
            </label>
          </>
        ) : (
          <>
            <p className="text-[12px] text-text-secondary">
              Ends the lease, records deposit outcome, and can mark unit occupants as moved out.
              Run a move-out inspection under Meters / Inspections if needed.
            </p>
            <label className="block text-[12px] text-text-secondary">
              Vacate / end date
              <input
                type="date"
                value={vacateDate}
                onChange={e => setVacateDate(e.target.value)}
                className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
              />
            </label>
            <label className="flex items-center gap-2 text-[12px] text-text-secondary">
              <input
                type="checkbox"
                checked={moveOutOccupants}
                onChange={e => setMoveOutOccupants(e.target.checked)}
              />
              Move out current occupants on this unit
            </label>
            <label className="block text-[12px] text-text-secondary">
              Deposit outcome
              <select
                value={depositAction}
                onChange={e => setDepositAction(e.target.value as typeof depositAction)}
                className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
              >
                <option value="unchanged">Leave deposit status as-is</option>
                <option value="refunded">Fully refunded</option>
                <option value="partially_held">Partial refund (hold remainder)</option>
                <option value="paid">Keep as paid / held (no refund yet)</option>
              </select>
            </label>
            {(depositAction === 'refunded' || depositAction === 'partially_held') && (
              <label className="block text-[12px] text-text-secondary">
                Amount refunded
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={refundAmount}
                  onChange={e => setRefundAmount(e.target.value)}
                  className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
                />
              </label>
            )}
          </>
        )}

        {error && <p className="text-[13px] text-error">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void (mode === 'notice' ? submitNotice() : submitMoveOut())}
            className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50"
          >
            {busy ? 'Saving…' : mode === 'notice' ? 'Record notice' : 'Complete move-out'}
          </button>
        </div>
      </div>
    </div>
  )
}
