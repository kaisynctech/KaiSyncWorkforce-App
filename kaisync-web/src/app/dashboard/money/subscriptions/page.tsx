'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { ExpensesManager } from '@/components/money/ExpensesManager'

/** Money → Subscriptions: what the business pays for regularly (and once-off expenses). */
export default function SubscriptionsPage() {
  const [company, setCompany] = useState<{ id: string; vat: boolean } | null>(null)
  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const m = await resolveCurrentMember(supabase)
      if (!m) return
      const { data } = await supabase.from('companies').select('is_vat_registered').eq('id', m.companyId).maybeSingle()
      setCompany({ id: m.companyId, vat: (data as { is_vat_registered?: boolean } | null)?.is_vat_registered === true })
    })()
  }, [])
  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-5 pb-14 flex flex-col gap-5">
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-wider text-text-secondary">Money</p>
          <h1 className="text-[22px] font-semibold text-text-primary tracking-tight">Subscriptions</h1>
          <p className="text-[13px] text-text-secondary mt-1 max-w-2xl">
            Everything the business pays for regularly — software, phone contracts, rent, insurance, vehicle tracking — and once-off
            expenses. They count as money out on the <Link href="/dashboard/money?tab=totals" className="text-primary font-medium">Money totals</Link>.
          </p>
        </div>
        {company && <ExpensesManager companyId={company.id} vatRegistered={company.vat} />}
      </div>
    </div>
  )
}
