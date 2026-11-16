/**
 * Piece 10a: staff claims (travel and receipts). Staff use the employee_* functions (code sign-in or own login);
 * the office reads staff_claims (row-level security) and decides / pays through claims_* functions.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { prepareMediaUpload, consumeMediaUpload } from '@/lib/job-media'

export type ClaimKind = 'travel' | 'toll' | 'parking' | 'meal' | 'parts' | 'other'
export type ClaimStatus = 'submitted' | 'queried' | 'approved' | 'rejected' | 'paid' | 'cancelled'
export type Claim = {
  id: string; company_id: string; employee_id: string; kind: ClaimKind; claim_date: string; job_id: string | null
  job_code?: string | null; job_title?: string | null; description: string | null; from_place: string | null; to_place: string | null
  km: number | null; vehicle: 'own' | 'company' | null; rate_per_km: number | null; amount: number; receipt_path: string | null
  bill_to_client: boolean; status: ClaimStatus; manager_note: string | null; decided_at: string | null; paid_at: string | null
  payment_reference: string | null; created_at: string
  /** Set while the claim sits on a payslip (company pays claims on the payslip). */
  payment_approval_id?: string | null
}
export type ClaimInput = {
  id?: string; kind: ClaimKind; claim_date: string; job_id?: string | null; description?: string; from_place?: string; to_place?: string
  km?: number | null; vehicle?: 'own' | 'company'; amount?: number | null; receipt_path?: string | null; bill_to_client?: boolean
}
export type DayPoint = { type: string; at: string; job_id: string | null; job_code: string | null; lat: number | null; lng: number | null; place: string | null }
export type TripSuggestion = { from: string; to: string; km: number; job_id: string | null; job_code: string | null; leftAt: string; arrivedAt: string }

export const KIND_LABEL: Record<ClaimKind, string> = {
  travel: 'Travel', toll: 'Tolls', parking: 'Parking', meal: 'Meals away', parts: 'Parts bought', other: 'Other',
}
export const KIND_ICON: Record<ClaimKind, string> = {
  travel: 'directions_car', toll: 'toll', parking: 'local_parking', meal: 'restaurant', parts: 'build', other: 'receipt_long',
}
export const STATUS: Record<ClaimStatus, { label: string; cls: string }> = {
  submitted: { label: 'Waiting', cls: 'bg-amber-50 text-amber-800' },
  queried: { label: 'Queried', cls: 'bg-red-50 text-red-800' },
  approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-800' },
  rejected: { label: 'Rejected', cls: 'bg-slate-100 text-slate-700' },
  paid: { label: 'Paid', cls: 'bg-blue-50 text-blue-800' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-500' },
}

/** Straight-line distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Roads are longer than a straight line: an estimate the person checks before sending. */
export const ROAD_FACTOR = 1.3

/**
 * Trips from a day's clock-ins: whenever someone clocks out at one place and next clocks in somewhere else
 * (at least 1 km apart), that's a suggested trip. Only points with a position count.
 */
export function suggestTrips(points: DayPoint[]): TripSuggestion[] {
  const pts = points.filter(p => p.lat != null && p.lng != null).sort((a, b) => a.at.localeCompare(b.at))
  const out: TripSuggestion[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    if (a.type !== 'out' || b.type !== 'in') continue
    const km = haversineKm({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! }) * ROAD_FACTOR
    if (km < 1) continue
    out.push({
      from: a.place || 'Last stop', to: b.place || 'Next stop', km: Math.round(km), job_id: b.job_id, job_code: b.job_code,
      leftAt: a.at, arrivedAt: b.at,
    })
  }
  return out
}

const MESSAGES: Record<string, string> = {
  KM_RATE_NOT_SET: 'Your company hasn’t set a travel rate per km yet. Ask the office to set it.',
  KM_REQUIRED: 'Type how many kilometres.',
  AMOUNT_REQUIRED: 'Type the amount.',
  BAD_RECEIPT_PATH: 'The receipt photo could not be attached. Take it again.',
  CLAIM_LOCKED: 'This claim was already decided, so it can’t be changed.',
  CLAIM_NOT_FOUND: 'This claim no longer exists.',
  JOB_NOT_FOUND: 'That job no longer exists.',
  NOTE_REQUIRED: 'Add a short note so they know what to fix.',
  OWN_CLAIM: 'Someone else has to approve your own claims.',
  NOT_ALLOWED: 'You don’t have permission to do this.',
  BAD_RATE: 'The rate must be between 0 and 100.',
  UNAUTHORIZED: 'Your session has expired. Sign in again.',
}
/** Status label and colour, with "On payslip" for an approved claim that's on a payslip. */
export function claimStatus(c: Pick<Claim, 'status' | 'payment_approval_id'>): { label: string; cls: string } {
  if (c.status === 'approved' && c.payment_approval_id) return { label: 'On payslip', cls: 'bg-violet-50 text-violet-800' }
  return STATUS[c.status]
}

export function claimError(message: string | null | undefined): string {
  const m = String(message ?? '')
  for (const [k, v] of Object.entries(MESSAGES)) if (m.includes(k)) return v
  return m || 'Something went wrong. Please try again.'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (s: SupabaseClient, fn: string, args: Record<string, unknown>) => (s.rpc as any)(fn, args) as Promise<{ data: unknown; error: { message: string } | null }>

type Who = { companyId: string; employeeId: string; sessionToken: string | null }

export async function listMyClaims(s: SupabaseClient, w: Who) {
  const { data, error } = await rpc(s, 'employee_list_claims', { p_company_id: w.companyId, p_employee_id: w.employeeId, p_session_token: w.sessionToken })
  if (error) return { ok: false as const, message: claimError(error.message) }
  const d = data as { km_rate: number | null; claims: Claim[]; jobs: { id: string; job_code: string | null; title: string | null }[] }
  return { ok: true as const, kmRate: d.km_rate == null ? null : Number(d.km_rate), claims: d.claims ?? [], jobs: d.jobs ?? [] }
}

export async function claimDay(s: SupabaseClient, w: Who, date: string): Promise<DayPoint[]> {
  const { data, error } = await rpc(s, 'employee_claim_day', { p_company_id: w.companyId, p_employee_id: w.employeeId, p_date: date, p_session_token: w.sessionToken })
  return error ? [] : ((data ?? []) as DayPoint[])
}

export async function saveClaim(s: SupabaseClient, w: Who, claim: ClaimInput) {
  const { data, error } = await rpc(s, 'employee_save_claim', { p_company_id: w.companyId, p_employee_id: w.employeeId, p_claim: claim, p_session_token: w.sessionToken })
  return error ? { ok: false as const, message: claimError(error.message) } : { ok: true as const, claim: data as Claim }
}

export async function cancelClaim(s: SupabaseClient, w: Who, id: string) {
  const { error } = await rpc(s, 'employee_cancel_claim', { p_company_id: w.companyId, p_employee_id: w.employeeId, p_claim_id: id, p_session_token: w.sessionToken })
  return error ? { ok: false as const, message: claimError(error.message) } : { ok: true as const }
}

/** A receipt photo in the person's own documents folder (claims/…). Returns the storage path. */
export async function uploadReceipt(s: SupabaseClient, w: Who, file: File): Promise<string | null> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `employee_documents/${w.companyId}/${w.employeeId}/claims/${crypto.randomUUID()}.${ext}`
  await prepareMediaUpload(s, w.companyId, w.employeeId, path, 'claim_receipt', w.sessionToken)
  const { error } = await s.storage.from('workforce-media').upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) return null
  await consumeMediaUpload(s, w.companyId, w.employeeId, path, w.sessionToken)
  return path
}

// ── Office ───────────────────────────────────────────────────────────────────

export async function decideClaims(s: SupabaseClient, ids: string[], decision: 'approve' | 'query' | 'reject', note?: string) {
  const { data, error } = await rpc(s, 'claims_decide', { p_claim_ids: ids, p_decision: decision, p_note: note ?? null })
  return error ? { ok: false as const, message: claimError(error.message) } : { ok: true as const, count: Number(data) || 0 }
}

export async function markClaimsPaid(s: SupabaseClient, ids: string[], paidOn: string, method: string, reference: string) {
  const { data, error } = await rpc(s, 'claims_mark_paid', { p_claim_ids: ids, p_paid_on: paidOn, p_method: method, p_reference: reference })
  return error ? { ok: false as const, message: claimError(error.message) } : { ok: true as const, count: Number(data) || 0 }
}

export async function setKmRate(s: SupabaseClient, companyId: string, rate: number | null) {
  const { error } = await rpc(s, 'claims_set_km_rate', { p_company_id: companyId, p_rate: rate })
  return error ? { ok: false as const, message: claimError(error.message) } : { ok: true as const }
}

/** Today in South Africa, as yyyy-mm-dd. */
export const todaySA = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date())
