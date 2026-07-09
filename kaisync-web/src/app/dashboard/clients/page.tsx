'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Client } from '@/types/database'

const CLIENT_TYPE_LABELS: Record<string, string> = {
  individual: 'Individual',
  company:    'Company',
  government: 'Government',
  ngo:        'NGO',
}

export default function ClientsPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('clients')
      .select('*')
      .order('name')
    setClients((data ?? []) as Client[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = clients.filter(c => {
    if (!searchText) return true
    const q = searchText.toLowerCase()
    return (
      (c.name ?? '').toLowerCase().includes(q) ||
      (c.code ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.phone ?? '').toLowerCase().includes(q) ||
      (c.contact_person ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="h-full flex flex-col">
      {/* Search + add */}
      <div className="flex items-center gap-2 mx-4 mt-4 mb-0">
        <input type="search" placeholder="Search by name, code, email, phone…"
          className="flex-1 bg-surface border border-border text-text-primary placeholder:text-text-disabled rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          value={searchText} onChange={e => setSearchText(e.target.value)} />
        <button onClick={() => router.push('/dashboard/clients/new')}
          className="btn-primary h-[42px] px-3 text-[13px] whitespace-nowrap">
          + Add Client
        </button>
      </div>

      {/* Count + refresh */}
      <div className="flex items-center justify-between mx-4 my-2">
        <p className="text-text-secondary text-[12px]">{filtered.length} client{filtered.length !== 1 ? 's' : ''}</p>
        <button onClick={load} className="text-primary text-[13px] px-2 hover:opacity-70 transition-opacity">Refresh</button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto mx-4 mb-4 bg-surface rounded-lg border border-divider">
          <table style={{ minWidth: 760 }} className="w-full">
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th style={{ width: 180 }} className="data-th">Client</th>
                <th style={{ width:  90 }} className="data-th">Code</th>
                <th style={{ width: 100 }} className="data-th">Type</th>
                <th style={{ width: 130 }} className="data-th">Contact</th>
                <th style={{ width: 150 }} className="data-th">Email</th>
                <th style={{ width: 110 }} className="data-th">Phone</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-12 text-center text-[13px] text-text-disabled">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-[13px] text-text-secondary">
                  {clients.length === 0 ? 'No clients yet. Click + Add Client to create one.' : 'No clients match your search.'}
                </td></tr>
              ) : (
                filtered.map(c => (
                  <tr key={c.id}
                    onClick={() => router.push(`/dashboard/clients/${c.id}`)}
                    className="bg-surface hover:bg-background cursor-pointer border-b border-divider last:border-0 transition-colors">
                    <td className="data-td text-text-primary font-medium">
                      <span className="block truncate" style={{ maxWidth: 180 }}>{c.name}</span>
                    </td>
                    <td className="data-td text-text-primary font-medium text-[12px]">{c.code ?? '—'}</td>
                    <td className="data-td text-text-secondary text-[12px]">
                      {CLIENT_TYPE_LABELS[c.type ?? ''] ?? c.type ?? '—'}
                    </td>
                    <td className="data-td text-text-secondary text-[12px]">
                      <span className="block truncate" style={{ maxWidth: 130 }}>{c.contact_person ?? '—'}</span>
                    </td>
                    <td className="data-td text-text-secondary text-[12px]">
                      <span className="block truncate" style={{ maxWidth: 150 }}>{c.email ?? '—'}</span>
                    </td>
                    <td className="data-td text-text-secondary text-[12px]">{c.phone ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
