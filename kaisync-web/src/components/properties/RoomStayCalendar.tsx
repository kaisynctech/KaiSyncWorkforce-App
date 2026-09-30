'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  calendarNightKind,
  localIsoDate,
  monthNightDates,
  nightAssignment,
} from '@/lib/stay-calendar'
import type { PropertyStay, Unit } from '@/types/database'

type Props = {
  companyId: string
  siteId: string
  units: Unit[]
  canEdit: boolean
  /** Bump after bookings and check-in/out so the month reloads. */
  revision: number
  onBookNight?: (unitId: string, night: string) => void
}

const KIND_CLASS: Record<string, string> = {
  in_house: 'bg-primary text-white',
  reserved: 'bg-sky-500 text-white',
  stayed: 'bg-slate-400 text-white',
}

function guestLabel(stay: PropertyStay): string {
  return [stay.guest_name, stay.guest_surname].filter(Boolean).join(' ').trim() || 'Guest'
}

export function RoomStayCalendar({
  companyId,
  siteId,
  units,
  canEdit,
  revision,
  onBookNight,
}: Props) {
  const today = localIsoDate()
  const initial = new Date()
  const [cursor, setCursor] = useState({ year: initial.getFullYear(), month: initial.getMonth() })
  const [stays, setStays] = useState<PropertyStay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const nights = useMemo(
    () => monthNightDates(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  )
  const monthStart = nights[0] ?? today
  const monthEnd = nights[nights.length - 1] ?? today

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: loadErr } = await supabase
      .from('property_stays')
      .select('*')
      .eq('company_id', companyId)
      .eq('site_id', siteId)
      .lte('check_in_date', monthEnd)
      .gte('check_out_date', monthStart)
      .limit(2000)
    if (loadErr) {
      setError(loadErr.message)
      setStays([])
    } else {
      setStays((data ?? []) as PropertyStay[])
    }
    setLoading(false)
  }, [companyId, siteId, monthStart, monthEnd])

  useEffect(() => { void load() }, [load, revision])

  const rooms = useMemo(
    () => [...units].sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true })),
    [units],
  )

  const label = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-ZA', {
    month: 'long',
    year: 'numeric',
  })

  function shift(delta: number) {
    const next = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-text-primary">Room calendar</h3>
          <p className="text-[11px] text-text-secondary">
            Each cell is a night. Check-out morning is free.
            {canEdit ? ' Click a free night to book that room.' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} className="btn-outlined h-8 px-2 text-[12px]">Previous</button>
          <button
            type="button"
            onClick={() => {
              const now = new Date()
              setCursor({ year: now.getFullYear(), month: now.getMonth() })
            }}
            className="h-8 px-2 text-[12px] text-primary hover:underline"
          >
            Today
          </button>
          <span className="min-w-[8.5rem] text-center text-[13px] font-medium text-text-primary">{label}</span>
          <button type="button" onClick={() => shift(1)} className="btn-outlined h-8 px-2 text-[12px]">Next</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-text-secondary">
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-primary" /> In house</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-sky-500" /> Reserved</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm bg-slate-400" /> Stayed</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-sm border border-divider bg-surface" /> Free</span>
      </div>

      {error && <p className="text-[12px] text-error">{error}</p>}

      {rooms.length === 0 ? (
        <p className="text-[12px] text-text-secondary">Add rooms to see the calendar.</p>
      ) : (
        <div className="overflow-x-auto border border-divider rounded-xl">
          <table className="border-collapse text-[10px]" style={{ minWidth: 28 * nights.length + 120 }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-surface-elevated border-b border-r border-divider px-2 py-1 text-left text-[11px] font-medium text-text-secondary">
                  Room
                </th>
                {nights.map(night => {
                  const day = Number(night.slice(8, 10))
                  const [y, m, d] = night.split('-').map(Number)
                  const weekday = new Date(y, (m ?? 1) - 1, d).toLocaleDateString('en-ZA', { weekday: 'narrow' })
                  const isToday = night === today
                  return (
                    <th
                      key={night}
                      className={`border-b border-divider px-0 py-1 font-medium text-center min-w-[28px] ${isToday ? 'text-primary' : 'text-text-secondary'}`}
                    >
                      <div>{weekday}</div>
                      <div>{day}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rooms.map(room => {
                const outOfOrder = (room.housekeeping_status ?? 'clean') === 'out_of_order'
                return (
                  <tr key={room.id}>
                    <th className="sticky left-0 z-10 bg-surface border-b border-r border-divider px-2 py-1 text-left text-[11px] font-medium text-text-primary whitespace-nowrap">
                      {room.unit_number}
                      {outOfOrder ? <span className="block text-[10px] font-normal text-error">Out of order</span> : null}
                    </th>
                    {nights.map(night => {
                      const stay = nightAssignment(stays, room.id, night)
                      const kind = stay ? calendarNightKind(stay.status) : null
                      const isToday = night === today
                      const label = stay
                        ? `${room.unit_number} ${night} · ${guestLabel(stay)} · ${kind === 'in_house' ? 'In house' : kind === 'reserved' ? 'Reserved' : 'Stayed'}`
                        : `${room.unit_number} ${night} · Free`
                      const bookable = canEdit && !stay && !outOfOrder && !!onBookNight
                      return (
                        <td key={night} className={`border-b border-divider p-0.5 ${isToday ? 'bg-primary/5' : ''}`}>
                          <button
                            type="button"
                            title={label}
                            aria-label={label}
                            disabled={!bookable}
                            onClick={() => {
                              if (bookable) onBookNight?.(room.id, night)
                            }}
                            className={`h-6 w-full rounded-sm ${kind ? KIND_CLASS[kind] : outOfOrder ? 'bg-error/10' : 'bg-surface hover:bg-surface-elevated'} ${bookable ? 'cursor-pointer' : 'cursor-default'} disabled:opacity-100`}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {loading && <p className="px-2 py-1 text-[11px] text-text-secondary">Updating calendar…</p>}
        </div>
      )}
    </div>
  )
}
