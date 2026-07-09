'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FilterChip } from '@/components/ui/FilterChip'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { Contractor, ContractorActionItem } from '@/types/database'

type FilterValue = 'active' | 'inactive' | 'all'

const ACTION_TYPE_COLORS: Record<string, { bg: string; fg: string }> = {
  compliance: { bg: '#FEE2E2', fg: '#991B1B' },
  payment:    { bg: '#FEF3C7', fg: '#92400E' },
  review:     { bg: '#DBEAFE', fg: '#1E40AF' },
}

function getDefaultColor() { return { bg: '#E5E7EB', fg: '#374151' } }

function getBankingBadge(c: Contractor) {
  return c.bank_name && c.account_number
    ? { bg: '#DCFCE7', fg: '#166534', label: 'Verified' }
    : { bg: '#1E293B', fg: '#94A3B8', label: 'Pending' }
}

function getStatusBadge(c: Contractor) {
  return c.is_active
    ? { bg: '#DCFCE7', fg: '#166534', label: 'Active' }
    : { bg: '#1E293B', fg: '#94A3B8', label: 'Inactive' }
}

export default function ContractorsPage() {
  const router = useRouter()
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [actionItems, setActionItems] = useState<ContractorActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [filter, setFilter] = useState<FilterValue>('active')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data: me } = await supabase
      .from('employees')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (!me) { setLoading(false); return }

    const [cRes, aRes] = await Promise.all([
      supabase.from('contractors').select('*').eq('company_id', me.company_id).order('name'),
      supabase
        .from('contractor_action_items')
        .select('*, contractors(name)')
        .eq('company_id', me.company_id)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    setContractors((cRes.data ?? []) as Contractor[])
    setActionItems((aRes.data ?? []) as ContractorActionItem[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = contractors.filter(c => {
    if (filter === 'active' && !c.is_active) return false
    if (filter === 'inactive' && c.is_active) return false
    if (searchText) {
      const q = searchText.toLowerCase()
      return (
        c.name.toLowerCase().includes(q) ||
        (c.contact_person ?? '').toLowerCase().includes(q) ||
        (c.contractor_code ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

  return (
    <div className="h-full flex flex-col">
      {/* Search bar */}
      <div className="px-4 pt-4 pb-0">
        <input
          type="search"
          placeholder="Search contractors…"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="w-full bg-surface border border-border text-text-primary placeholder:text-text-disabled rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        />
      </div>

      {/* Filter toolbar */}
      <div className="flex items-center gap-[6px] mx-4 my-2 flex-wrap">
        <FilterChip label="Active"   active={filter === 'active'}   onClick={() => setFilter('active')} />
        <FilterChip label="Inactive" active={filter === 'inactive'} onClick={() => setFilter('inactive')} />
        <FilterChip label="All"      active={filter === 'all'}      onClick={() => setFilter('all')} />
        <span className="ml-2 text-[12px] text-text-secondary flex-1">{filtered.length} contractors</span>
        <button onClick={load} className="text-[13px] text-primary px-2 hover:opacity-70 transition-opacity">Refresh</button>
        <button
          onClick={() => router.push('/dashboard/contractors/new')}
          className="h-8 px-3 text-[13px] rounded-lg bg-primary text-white font-semibold hover:bg-primary-dark transition-colors"
        >+ Add</button>
      </div>

      {/* Action Centre */}
      <div className="mx-4 mb-3 bg-surface rounded-xl border border-divider overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-[10px] border-b border-divider">
          <span className="material-icons text-primary text-[18px]">bolt</span>
          <span className="font-semibold text-[12px] text-primary uppercase tracking-wider">Action Centre</span>
          <span className="text-text-secondary text-[11px] ml-1">
            {actionItems.length > 0 ? `${actionItems.length} pending` : 'Up to date'}
          </span>
          <button onClick={load} className="ml-auto text-text-secondary text-[11px] h-8 px-2 hover:text-text-primary transition-colors">
            ↻ Refresh
          </button>
        </div>
        <div className="max-h-[140px] overflow-y-auto">
          {actionItems.length === 0 ? (
            <p className="text-text-secondary text-[12px] px-3 py-2">✓  No pending contractor actions</p>
          ) : (
            actionItems.map(item => {
              const colors = ACTION_TYPE_COLORS[item.action_type] ?? getDefaultColor()
              return (
                <div key={item.id}
                  className="grid items-center gap-x-2 px-3 py-2 border-t border-divider"
                  style={{ gridTemplateColumns: '110px 1fr 90px 70px' }}>
                  <span className="rounded-[5px] px-[6px] py-[3px] text-[10px] font-medium w-fit"
                    style={{ backgroundColor: colors.bg, color: colors.fg }}>
                    {item.action_type}
                  </span>
                  <div className="overflow-hidden">
                    <p className="text-text-primary text-[12px] font-medium truncate">{item.contractors?.name ?? '—'}</p>
                    <p className="text-text-secondary text-[11px] truncate">{item.summary}</p>
                  </div>
                  <p className="text-text-secondary text-[11px] text-right">{fmtDate(item.created_at)}</p>
                  <button className="text-primary text-[11px] h-[30px] text-right hover:opacity-70 transition-opacity">
                    Open →
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Contractors table */}
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto mx-4 mb-4 bg-surface rounded-lg border border-divider">
          <table style={{ minWidth: 1100 }} className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th style={{ width: 185 }} className="text-left px-3 py-3 text-[12px] font-medium text-text-secondary">Company</th>
                <th style={{ width: 90 }}  className="text-left px-3 py-3 text-[12px] font-medium text-text-secondary">Code</th>
                <th style={{ width: 130 }} className="text-left px-3 py-3 text-[12px] font-medium text-text-secondary">Contact</th>
                <th style={{ width: 120 }} className="text-left px-3 py-3 text-[12px] font-medium text-text-secondary">Phone</th>
                <th style={{ width: 160 }} className="text-left px-3 py-3 text-[12px] font-medium text-text-secondary">Email</th>
                <th style={{ width: 70 }}  className="text-center px-3 py-3 text-[12px] font-medium text-text-secondary">Rating</th>
                <th style={{ width: 85 }}  className="text-center px-3 py-3 text-[12px] font-medium text-text-secondary">Banking</th>
                <th style={{ width: 80 }}  className="text-center px-3 py-3 text-[12px] font-medium text-text-secondary">Payment</th>
                <th style={{ width: 100 }} className="text-center px-3 py-3 text-[12px] font-medium text-text-secondary">Compliance</th>
                <th style={{ width: 80 }}  className="text-right px-3 py-3 text-[12px] font-medium text-text-secondary">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[13px] text-text-disabled">Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[13px] text-text-secondary">
                    No contractors yet. Click + Add to register one.
                  </td>
                </tr>
              ) : (
                filtered.map(c => {
                  const banking = getBankingBadge(c)
                  const status = getStatusBadge(c)
                  const payment = { bg: '#DCFCE7', fg: '#166534', label: 'Clear' }
                  const compliance = c.compliance_pack
                    ? { bg: '#DCFCE7', fg: '#166534', label: 'Compliant' }
                    : { bg: '#1E293B', fg: '#94A3B8', label: 'No Pack' }

                  return (
                    <tr
                      key={c.id}
                      onClick={() => router.push(`/dashboard/contractors/${c.id}`)}
                      className="bg-surface hover:bg-background cursor-pointer border-b border-divider last:border-0 transition-colors"
                    >
                      <td className="px-3 py-3 text-text-primary font-medium">
                        <span className="block truncate" style={{ maxWidth: 185 }}>{c.name}</span>
                      </td>
                      <td className="px-3 py-3 text-text-secondary font-mono">{c.contractor_code ?? '—'}</td>
                      <td className="px-3 py-3 text-text-secondary">
                        <span className="block truncate" style={{ maxWidth: 130 }}>{c.contact_person ?? '—'}</span>
                      </td>
                      <td className="px-3 py-3 text-text-secondary">{c.phone ?? '—'}</td>
                      <td className="px-3 py-3 text-text-secondary">
                        <span className="block truncate" style={{ maxWidth: 160 }}>{c.email ?? '—'}</span>
                      </td>
                      <td className="px-3 py-3 text-center text-text-secondary text-[13px]">
                        ★ {(c.rating ?? 0).toFixed(1)}
                      </td>
                      <td className="px-3 py-3 text-center"><StatusBadge {...banking} /></td>
                      <td className="px-3 py-3 text-center"><StatusBadge {...payment} /></td>
                      <td className="px-3 py-3 text-center"><StatusBadge {...compliance} /></td>
                      <td className="px-3 py-3 text-right"><StatusBadge {...status} /></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
