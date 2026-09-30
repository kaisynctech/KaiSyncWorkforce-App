import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncIcalForConnection } from '@/lib/property-channels'
import { can, loadPermissions, PERM } from '@/lib/permissions'

/**
 * POST /api/properties/ical-sync
 * Body: { connectionId: string }
 * Fetches iCal feeds for the connection's room mappings and upserts stays.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: emp } = await supabase
    .from('employees')
    .select('id, company_id, access_level')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!emp?.company_id) {
    return NextResponse.json({ error: 'No company linked' }, { status: 403 })
  }

  const perms = await loadPermissions(supabase, emp.company_id, emp.access_level)
  if (!can(perms, PERM.propertiesEdit)) {
    return NextResponse.json({ error: 'Missing properties.edit permission' }, { status: 403 })
  }

  let body: { connectionId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const connectionId = body.connectionId?.trim()
  if (!connectionId) {
    return NextResponse.json({ error: 'connectionId is required' }, { status: 400 })
  }

  const result = await syncIcalForConnection(supabase, {
    companyId: emp.company_id,
    connectionId,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true, ...result.data })
}
