'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { KpiTile } from '@/components/ui/KpiTile'
import type { FarmLivestockGroup } from '@/types/farms'

export default function LivestockHubPage() {
  const router = useRouter()
  const [groups, setGroups] = useState<FarmLivestockGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [species, setSpecies] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    const { data } = await supabase
      .from('farm_livestock_groups')
      .select('*, farms(name, farm_code), farm_land_units(name)')
      .eq('company_id', member.companyId)
      .order('name')

    setGroups((data ?? []) as FarmLivestockGroup[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = groups.filter(g => {
    if (species !== 'all' && g.species !== species) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const farmName = g.farms?.name ?? ''
    return (
      g.name.toLowerCase().includes(q) ||
      farmName.toLowerCase().includes(q) ||
      (g.breed ?? '').toLowerCase().includes(q)
    )
  })

  const active = filtered.filter(g => g.status === 'active')
  const headcount = active.reduce((s, g) => s + Number(g.headcount ?? 0), 0)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary">Livestock</h1>
          <p className="text-[12px] text-text-secondary mt-0.5">Groups and flocks across all farms</p>
        </div>
        <Link href="/dashboard/farms" className="text-[13px] text-primary hover:underline">Farms →</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 py-3 border-b border-divider bg-surface shrink-0">
        <KpiTile value={active.length} label="Active groups" bg="#0F2918" valueFg="#22C55E" labelFg="#4ADE80" />
        <KpiTile value={headcount} label="Total headcount" bg="#1E293B" valueFg="#FCD34D" labelFg="#64748B" />
      </div>

      <div className="flex gap-2 px-4 py-2 border-b border-divider bg-surface shrink-0 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search group, farm, breed…"
          className="h-9 px-3 border border-border rounded-md text-[13px] bg-background flex-1 min-w-[180px]"
        />
        <select
          value={species}
          onChange={e => setSpecies(e.target.value)}
          className="h-9 px-3 border border-border rounded-md text-[13px] bg-background"
        >
          <option value="all">All species</option>
          <option value="chicken">Chicken</option>
          <option value="cattle">Cattle</option>
          <option value="sheep">Sheep</option>
          <option value="goat">Goat</option>
          <option value="pig">Pig</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <span className="material-icons text-[40px] text-text-disabled">pets</span>
            <p className="text-[14px] text-text-secondary">No livestock groups yet</p>
            <Link href="/dashboard/farms" className="text-[13px] text-primary hover:underline">Open a farm to add flocks</Link>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 720 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider sticky top-0">
                <th className="data-th text-left">Group</th>
                <th className="data-th text-left">Farm</th>
                <th className="data-th text-left">Species</th>
                <th className="data-th text-left">Land</th>
                <th className="data-th text-right">Headcount</th>
                <th className="data-th text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => (
                <tr
                  key={g.id}
                  className="border-b border-divider hover:bg-surface-elevated cursor-pointer"
                  onClick={() => router.push(`/dashboard/farms/${g.farm_id}/groups/${g.id}`)}
                >
                  <td className="data-td text-[13px] font-medium text-primary">{g.name}</td>
                  <td className="data-td text-[13px] text-text-secondary">
                    {g.farms?.farm_code ? `${g.farms.farm_code} · ` : ''}{g.farms?.name ?? '—'}
                  </td>
                  <td className="data-td text-[13px] capitalize">{g.species}{g.breed ? ` · ${g.breed}` : ''}</td>
                  <td className="data-td text-[13px] text-text-secondary">{g.farm_land_units?.name ?? '—'}</td>
                  <td className="data-td text-[13px] text-right font-medium">{g.headcount}</td>
                  <td className="data-td text-[12px] capitalize">{g.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
