import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

type RpcFn = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>

// ── POST — trigger for the caller's company ───────────────────────────────────
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: emp } = await supabase
    .from('employees')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!emp?.company_id) return NextResponse.json({ error: 'No company linked' }, { status: 403 })

  const { data, error } = await (supabase.rpc as unknown as RpcFn)(
    'process_expiring_quotes', { p_company_id: emp.company_id }
  )
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json(data)
}

// ── GET — Vercel Cron: processes ALL companies ────────────────────────────────
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: companies, error: cErr } = await admin.from('companies').select('id')
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })

  const results: Record<string, unknown> = {}
  for (const co of companies ?? []) {
    const { data } = await (admin.rpc as unknown as RpcFn)(
      'process_expiring_quotes', { p_company_id: co.id }
    )
    results[co.id] = data
  }
  return NextResponse.json({ processed_companies: (companies ?? []).length, results })
}
