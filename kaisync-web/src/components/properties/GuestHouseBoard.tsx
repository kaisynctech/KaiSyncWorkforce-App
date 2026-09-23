'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { unitTypeLabel } from '@/lib/properties'
import {
  buildRoomBoard,
  checkInStay,
  checkOutStay,
  cancelStay,
  createStay,
  housekeepingLabel,
  HOUSEKEEPING_STATUSES,
  nightsBetween,
  setHousekeepingStatus,
  stayStatusLabel,
  STAY_DEPOSIT_STATUSES,
} from '@/lib/property-stays'
import { BOOKING_SOURCES, bookingSourceLabel } from '@/lib/property-channels'
import { ChannelSyncPanel } from '@/components/properties/ChannelSyncPanel'
import type {
  HousekeepingStatus,
  PropertyStay,
  StayBookingSource,
  StayDepositStatus,
  Unit,
} from '@/types/database'

type Props = {
  companyId: string
  siteId: string
  employeeId: string | null
  canEdit: boolean
  units: Unit[]
  onUnitsChanged?: () => void
}

const fmtMoney = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n)
}

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short' }).format(new Date(d + 'T00:00:00'))
}

function roomTone(housekeeping: string | null | undefined, stay: PropertyStay | null): string {
  if (housekeeping === 'out_of_order') return 'border-error/40 bg-error/5'
  if (stay?.status === 'checked_in') return 'border-primary/40 bg-primary/5'
  if (housekeeping === 'dirty') return 'border-amber-400/50 bg-amber-50 dark:bg-amber-950/20'
  if (stay?.status === 'reserved') return 'border-sky-400/40 bg-sky-50 dark:bg-sky-950/20'
  return 'border-divider bg-surface'
}

export function GuestHouseBoard({
  companyId,
  siteId,
  employeeId,
  canEdit,
  units,
  onUnitsChanged,
}: Props) {
  const [stays, setStays] = useState<PropertyStay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showBook, setShowBook] = useState(false)
  const [prefillUnitId, setPrefillUnitId] = useState('')

  const [guestName, setGuestName] = useState('')
  const [guestSurname, setGuestSurname] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [passport, setPassport] = useState('')
  const [unitId, setUnitId] = useState('')
  const [checkIn, setCheckIn] = useState(() => new Date().toISOString().slice(0, 10))
  const [checkOut, setCheckOut] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [adults, setAdults] = useState('2')
  const [children, setChildren] = useState('0')
  const [nightlyRate, setNightlyRate] = useState('')
  const [deposit, setDeposit] = useState('')
  const [depositStatus, setDepositStatus] = useState<StayDepositStatus>('none')
  const [notes, setNotes] = useState('')
  const [checkInNow, setCheckInNow] = useState(false)
  const [bookingSource, setBookingSource] = useState<StayBookingSource>('manual')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: e } = await supabase
      .from('property_stays')
      .select('*')
      .eq('company_id', companyId)
      .eq('site_id', siteId)
      .order('check_in_date', { ascending: false })
      .limit(300)
    if (e) setError(e.message)
    setStays((data ?? []) as PropertyStay[])
    setLoading(false)
  }, [companyId, siteId])

  useEffect(() => { void load() }, [load])

  const board = useMemo(() => {
    const unitRows = units.map(u => ({
      id: u.id,
      unit_number: u.unit_number,
      unit_type: u.unit_type,
      housekeeping_status: (u.housekeeping_status ?? 'clean') as HousekeepingStatus,
      is_occupied: u.is_occupied ?? false,
      default_rent_amount: u.default_rent_amount,
    }))
    return buildRoomBoard(unitRows, stays)
  }, [units, stays])

  const kpis = useMemo(() => {
    const occupied = board.filter(r => r.currentStay?.status === 'checked_in').length
    const reserved = stays.filter(s => s.status === 'reserved').length
    const dirty = board.filter(r => r.unit.housekeeping_status === 'dirty').length
    const clean = board.filter(r => r.unit.housekeeping_status === 'clean' || r.unit.housekeeping_status === 'inspected').length
    return { occupied, reserved, dirty, clean, rooms: board.length }
  }, [board, stays])

  const nights = nightsBetween(checkIn, checkOut)
  const rateNum = nightlyRate.trim() ? parseFloat(nightlyRate) : null
  const estTotal = rateNum != null && Number.isFinite(rateNum) ? rateNum * Math.max(nights, 1) : null

  function openBook(forUnitId?: string) {
    const uid = forUnitId || ''
    setPrefillUnitId(uid)
    setUnitId(uid)
    setGuestName('')
    setGuestSurname('')
    setGuestPhone('')
    setIdNumber('')
    setPassport('')
    setCheckIn(new Date().toISOString().slice(0, 10))
    const d = new Date()
    d.setDate(d.getDate() + 1)
    setCheckOut(d.toISOString().slice(0, 10))
    setAdults('2')
    setChildren('0')
    const u = units.find(x => x.id === uid)
    setNightlyRate(u?.default_rent_amount != null ? String(u.default_rent_amount) : '')
    setDeposit('')
    setDepositStatus('none')
    setNotes('')
    setCheckInNow(false)
    setBookingSource('manual')
    setError(null)
    setShowBook(true)
  }

  async function saveBooking() {
    if (!canEdit || !guestName.trim() || !unitId) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await createStay(supabase, {
      companyId,
      siteId,
      unitId,
      employeeId,
      guestName,
      guestSurname,
      guestPhone,
      idNumber,
      passportNumber: passport,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      adults: parseInt(adults, 10) || 1,
      children: parseInt(children, 10) || 0,
      nightlyRate: rateNum != null && Number.isFinite(rateNum) ? rateNum : null,
      depositAmount: deposit.trim() ? parseFloat(deposit) : null,
      depositStatus,
      notes,
      checkInNow,
      bookingSource,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setShowBook(false)
    await load()
    onUnitsChanged?.()
  }

  async function doCheckIn(stayId: string) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await checkInStay(supabase, { companyId, stayId })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    await load()
    onUnitsChanged?.()
  }

  async function doCheckOut(stayId: string) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await checkOutStay(supabase, { companyId, stayId })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    await load()
    onUnitsChanged?.()
  }

  async function doCancel(stayId: string) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await cancelStay(supabase, { companyId, stayId })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    await load()
    onUnitsChanged?.()
  }

  async function setHk(unitIdVal: string, status: HousekeepingStatus) {
    if (!canEdit) return
    setBusy(true)
    const supabase = createClient()
    const result = await setHousekeepingStatus(supabase, { companyId, unitId: unitIdVal, status })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    onUnitsChanged?.()
  }

  const recentStays = useMemo(
    () => stays.filter(s => s.status !== 'cancelled').slice(0, 40),
    [stays],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-text-secondary">
          Room board for short stays — reserve, check in/out, and track housekeeping.
        </p>
        {canEdit && (
          <button type="button" onClick={() => openBook()} className="btn-primary h-9 px-3 text-[13px]">
            + Booking
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: 'Rooms', value: kpis.rooms },
          { label: 'In house', value: kpis.occupied },
          { label: 'Reserved', value: kpis.reserved },
          { label: 'Clean', value: kpis.clean },
          { label: 'Dirty', value: kpis.dirty },
        ].map(k => (
          <div key={k.label} className="rounded-lg border border-divider bg-surface-elevated px-3 py-2">
            <p className="text-[11px] text-text-secondary">{k.label}</p>
            <p className="text-[16px] font-semibold text-text-primary">{k.value}</p>
          </div>
        ))}
      </div>

      {error && <p className="text-[13px] text-error">{error}</p>}

      {loading ? (
        <p className="text-[13px] text-text-secondary">Loading board…</p>
      ) : board.length === 0 ? (
        <p className="text-[13px] text-text-secondary">
          No rooms yet. Add rooms under Units (or Generate rooms) first.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {board.map(row => {
            const stay = row.currentStay
            return (
              <div
                key={row.unit.id}
                className={`rounded-xl border p-3 space-y-2 ${roomTone(row.unit.housekeeping_status, stay)}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[14px] font-semibold text-text-primary">{row.unit.unit_number}</p>
                    <p className="text-[11px] text-text-secondary">{unitTypeLabel(row.unit.unit_type)}</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-text-disabled">
                    {housekeepingLabel(row.unit.housekeeping_status)}
                  </span>
                </div>

                {stay ? (
                  <div className="text-[12px] space-y-0.5">
                    <p className="font-medium text-text-primary">
                      {stay.guest_name} {stay.guest_surname}
                    </p>
                    <p className="text-text-secondary">
                      {fmtDate(stay.check_in_date)} → {fmtDate(stay.check_out_date)} · {stayStatusLabel(stay.status)}
                      {stay.booking_source && stay.booking_source !== 'manual'
                        ? ` · ${bookingSourceLabel(stay.booking_source)}`
                        : ''}
                    </p>
                    <p className="text-text-disabled">
                      {stay.adults} adult{stay.adults === 1 ? '' : 's'}
                      {stay.children > 0 ? ` · ${stay.children} child` : ''}
                      {stay.total_amount != null ? ` · ${fmtMoney(stay.total_amount)}` : ''}
                    </p>
                  </div>
                ) : (
                  <p className="text-[12px] text-text-secondary">Vacant</p>
                )}

                {row.upcomingStay && (
                  <p className="text-[11px] text-sky-700 dark:text-sky-300">
                    Next: {row.upcomingStay.guest_name} {fmtDate(row.upcomingStay.check_in_date)}
                  </p>
                )}

                {canEdit && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {!stay && row.unit.housekeeping_status !== 'out_of_order' && (
                      <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => openBook(row.unit.id)}>
                        Book
                      </button>
                    )}
                    {stay?.status === 'reserved' && (
                      <button type="button" disabled={busy} className="text-[11px] text-primary hover:underline" onClick={() => void doCheckIn(stay.id)}>
                        Check in
                      </button>
                    )}
                    {stay?.status === 'checked_in' && (
                      <button type="button" disabled={busy} className="text-[11px] text-primary hover:underline" onClick={() => void doCheckOut(stay.id)}>
                        Check out
                      </button>
                    )}
                    {(stay?.status === 'reserved' || stay?.status === 'checked_in') && (
                      <button type="button" disabled={busy} className="text-[11px] text-error hover:underline" onClick={() => void doCancel(stay.id)}>
                        Cancel
                      </button>
                    )}
                    <select
                      value={row.unit.housekeeping_status}
                      disabled={busy}
                      onChange={e => void setHk(row.unit.id, e.target.value as HousekeepingStatus)}
                      className="h-7 text-[11px] border border-border rounded px-1 bg-background"
                    >
                      {HOUSEKEEPING_STATUSES.map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {recentStays.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[13px] font-semibold text-text-primary">Recent / upcoming stays</h3>
          <div className="overflow-x-auto border border-divider rounded-xl">
            <table className="w-full" style={{ minWidth: 640 }}>
              <thead>
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className="data-th text-left">Guest</th>
                  <th className="data-th text-left">Room</th>
                  <th className="data-th text-left">Dates</th>
                  <th className="data-th text-left">Source</th>
                  <th className="data-th text-left">Status</th>
                  <th className="data-th text-right">Total</th>
                  <th className="data-th text-left" />
                </tr>
              </thead>
              <tbody>
                {recentStays.map(s => {
                  const room = units.find(u => u.id === s.unit_id)
                  return (
                    <tr key={s.id} className="border-b border-divider">
                      <td className="data-td text-[13px] font-medium">{s.guest_name} {s.guest_surname}</td>
                      <td className="data-td text-[12px]">{room?.unit_number ?? '—'}</td>
                      <td className="data-td text-[12px]">{fmtDate(s.check_in_date)} → {fmtDate(s.check_out_date)}</td>
                      <td className="data-td text-[11px] text-text-secondary">{bookingSourceLabel(s.booking_source)}</td>
                      <td className="data-td text-[12px]">{stayStatusLabel(s.status)}</td>
                      <td className="data-td text-[13px] text-right">{fmtMoney(s.total_amount)}</td>
                      <td className="data-td text-right whitespace-nowrap">
                        {canEdit && s.status === 'reserved' && (
                          <button type="button" disabled={busy} className="text-[11px] text-primary hover:underline mr-2" onClick={() => void doCheckIn(s.id)}>Check in</button>
                        )}
                        {canEdit && s.status === 'checked_in' && (
                          <button type="button" disabled={busy} className="text-[11px] text-primary hover:underline" onClick={() => void doCheckOut(s.id)}>Check out</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ChannelSyncPanel
        companyId={companyId}
        siteId={siteId}
        employeeId={employeeId}
        canEdit={canEdit}
        units={units}
      />

      {showBook && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-text-primary">New booking</h2>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[12px] text-text-secondary">First name *
                <input value={guestName} onChange={e => setGuestName(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
              <label className="block text-[12px] text-text-secondary">Surname
                <input value={guestSurname} onChange={e => setGuestSurname(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
            </div>
            <label className="block text-[12px] text-text-secondary">Phone
              <input value={guestPhone} onChange={e => setGuestPhone(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[12px] text-text-secondary">ID number
                <input value={idNumber} onChange={e => setIdNumber(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
              <label className="block text-[12px] text-text-secondary">Passport
                <input value={passport} onChange={e => setPassport(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
            </div>
            <label className="block text-[12px] text-text-secondary">Room *
              <select value={unitId} onChange={e => {
                setUnitId(e.target.value)
                const u = units.find(x => x.id === e.target.value)
                if (u?.default_rent_amount != null && !nightlyRate) setNightlyRate(String(u.default_rent_amount))
              }} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                <option value="">— Select room —</option>
                {units.filter(u => (u.housekeeping_status ?? 'clean') !== 'out_of_order').map(u => (
                  <option key={u.id} value={u.id}>
                    {u.unit_number}{u.unit_type ? ` · ${unitTypeLabel(u.unit_type)}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[12px] text-text-secondary">Check-in *
                <input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
              <label className="block text-[12px] text-text-secondary">Check-out *
                <input type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
            </div>
            <p className="text-[11px] text-text-disabled">{nights} night{nights === 1 ? '' : 's'}{estTotal != null ? ` · est. ${fmtMoney(estTotal)}` : ''}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[12px] text-text-secondary">Adults
                <input type="number" min={1} max={20} value={adults} onChange={e => setAdults(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
              <label className="block text-[12px] text-text-secondary">Children
                <input type="number" min={0} max={20} value={children} onChange={e => setChildren(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[12px] text-text-secondary">Nightly rate
                <input type="number" step="0.01" value={nightlyRate} onChange={e => setNightlyRate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
              <label className="block text-[12px] text-text-secondary">Deposit
                <input type="number" step="0.01" value={deposit} onChange={e => {
                  setDeposit(e.target.value)
                  const n = parseFloat(e.target.value)
                  if (Number.isFinite(n) && n > 0 && depositStatus === 'none') setDepositStatus('due')
                }} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
            </div>
            <label className="block text-[12px] text-text-secondary">Deposit status
              <select value={depositStatus} onChange={e => setDepositStatus(e.target.value as StayDepositStatus)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                {STAY_DEPOSIT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="block text-[12px] text-text-secondary">Source
              <select
                value={bookingSource}
                onChange={e => setBookingSource(e.target.value as StayBookingSource)}
                className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
              >
                {BOOKING_SOURCES.filter(s => !['ical', 'booking_com', 'airbnb', 'expedia', 'channel_manager'].includes(s.value)).map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] text-text-secondary">Notes
              <input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={checkInNow} onChange={e => setCheckInNow(e.target.checked)} />
              Check in now
            </label>
            {error && <p className="text-[12px] text-error">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowBook(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
              <button
                type="button"
                disabled={busy || !guestName.trim() || !unitId || !checkIn || !checkOut}
                onClick={() => void saveBooking()}
                className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50"
              >
                {busy ? 'Saving…' : prefillUnitId ? 'Book room' : 'Create booking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
