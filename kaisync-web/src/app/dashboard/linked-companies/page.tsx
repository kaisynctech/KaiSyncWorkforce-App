'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { SearchPicker } from '@/components/SearchPicker'
import {
  decideLink, disconnectLink, groupLinks, startTab, listLinks, myRecordNoun, myUnlinkedRecords, statusWords,
  type CompanyLink, type LinkTab,
} from '@/lib/company-links'

const TABS: { id: LinkTab; label: string; empty: string; how: string }[] = [
  { id: 'clients', label: 'Clients', empty: 'No clients linked yet.', how: 'To link one, open the client and use the KaiSync link card.' },
  { id: 'contractors', label: 'Contractors', empty: 'No contractors linked yet.', how: 'To link one, open the contractor and use the KaiSync link card.' },
]

function recordHref(link: CompanyLink): string | null {
  if (!link.my_record_id) return null
  return link.my_role === 'provider' ? `/dashboard/clients/${link.my_record_id}` : `/dashboard/contractors/${link.my_record_id}`
}

export default function LinkedCompaniesPage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [links, setLinks] = useState<CompanyLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [accepting, setAccepting] = useState<CompanyLink | null>(null)
  const [records, setRecords] = useState<{ id: string; name: string }[]>([])
  const [chosen, setChosen] = useState('')
  const [showEnded, setShowEnded] = useState(false)
  const [tab, setTab] = useState<LinkTab>('clients')
  const tabChosen = useRef(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Your account is not linked to a company.'); setLoading(false); return }
    setCompanyId(member.companyId)
    const res = await listLinks(supabase, member.companyId)
    if (!res.ok) { setError(res.message); setLinks([]) } else {
      setError(null)
      setLinks(res.data)
      // First visit: open the tab that needs attention, or the one that has companies.
      if (!tabChosen.current) setTab(startTab(res.data))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function startAccept(link: CompanyLink) {
    if (!companyId) return
    setAccepting(link)
    setChosen('')
    const res = await myUnlinkedRecords(createClient(), companyId, link.my_role)
    setRecords(res.ok ? res.data : [])
    if (!res.ok) setError(res.message)
  }

  async function decide(link: CompanyLink, yes: boolean, recordId: string | null) {
    if (!companyId) return
    if (!yes && !window.confirm(`Decline the link request from ${link.other.name}?`)) return
    setBusy(link.id)
    const res = await decideLink(createClient(), companyId, link.id, yes, recordId)
    setBusy(null)
    if (!res.ok) { setError(res.message); return }
    setAccepting(null)
    await load()
  }

  async function disconnect(link: CompanyLink) {
    if (!companyId) return
    const msg = link.status === 'active'
      ? `Disconnect from ${link.other.name}? Shared work stays with the company that did it; you both stop seeing each other's side.`
      : `Remove the link request with ${link.other.name}?`
    if (!window.confirm(msg)) return
    setBusy(link.id)
    const res = await disconnectLink(createClient(), companyId, link.id)
    setBusy(null)
    if (!res.ok) { setError(res.message); return }
    await load()
  }

  const { waiting, open, ended } = groupLinks(links, tab)
  const current = TABS.find(t => t.id === tab) ?? TABS[0]

  function sinceDate(link: CompanyLink): string {
    const raw = link.status === 'active' ? link.decided_at : link.status === 'pending' ? link.created_at : link.ended_at ?? link.decided_at
    return raw ? new Date(raw).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  }

  function rows(link: CompanyLink) {
    const href = recordHref(link)
    const noun = myRecordNoun(link.my_role)
    return [
      <tr key={link.id} className="border-t border-divider align-middle">
        <td className="px-4 py-3">
          <p className="font-semibold text-text-primary">{link.other.name}</p>
          {link.other.legal_name && link.other.legal_name !== link.other.name && (
            <p className="text-[12px] text-text-secondary">{link.other.legal_name}</p>
          )}
        </td>
        <td className="px-4 py-3">
          {link.my_record_name
            ? (href ? <Link href={href} className="text-primary hover:underline">{link.my_record_name}</Link> : link.my_record_name)
            : <span className="text-text-secondary">—</span>}
        </td>
        <td className="px-4 py-3 whitespace-nowrap">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${link.status === 'active' ? 'bg-success/10 text-success' : link.status === 'pending' ? 'bg-warning/10 text-warning' : 'bg-surface-elevated text-text-secondary'}`}>
            {statusWords(link)}
          </span>
        </td>
        <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{sinceDate(link)}</td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2 flex-wrap">
            {link.status === 'pending' && link.waiting_on_me && (
              <>
                <button disabled={busy === link.id} onClick={() => void startAccept(link)} className="btn-primary h-8 px-3 text-[12px]">Accept…</button>
                <button disabled={busy === link.id} onClick={() => void decide(link, false, null)} className="btn-outlined h-8 px-3 text-[12px]">Decline</button>
              </>
            )}
            {link.status === 'active' && link.my_role === 'customer' && (
              <Link href={`/dashboard/linked-companies/${link.id}`} className="btn-primary h-8 px-3 text-[12px] inline-flex items-center whitespace-nowrap">Open their work</Link>
            )}
            {(link.status === 'active' || (link.status === 'pending' && !link.waiting_on_me)) && (
              <button disabled={busy === link.id} onClick={() => void disconnect(link)} className="btn-outlined h-8 px-3 text-[12px] whitespace-nowrap">
                {link.status === 'active' ? 'Disconnect' : 'Cancel request'}
              </button>
            )}
          </div>
        </td>
      </tr>,
      accepting?.id === link.id ? (
        <tr key={`${link.id}-accept`} className="bg-surface-elevated/40">
          <td colSpan={5} className="px-4 py-3">
            <div className="space-y-3 max-w-2xl">
              <p className="text-text-secondary">
                {link.other.name} says it works with you. Choose your {noun} record for them,
                or leave it empty to create a new {noun} called “{link.other.name}”.
              </p>
              <SearchPicker
                options={records.map(r => ({ id: r.id, label: r.name }))}
                value={chosen}
                onChange={setChosen}
                label={`Your ${noun} record`}
                noun={noun}
              />
              <div className="flex gap-2">
                <button disabled={busy === link.id} onClick={() => void decide(link, true, chosen || null)} className="btn-primary h-9 px-3 text-[13px]">
                  {chosen ? 'Accept and link' : `Accept and create ${noun}`}
                </button>
                <button onClick={() => setAccepting(null)} className="btn-outlined h-9 px-3 text-[13px]">Back</button>
              </div>
            </div>
          </td>
        </tr>
      ) : null,
    ]
  }

  function table(list: CompanyLink[]) {
    const noun = tab === 'clients' ? 'client' : 'contractor'
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-surface-elevated/50 text-left">
              <th className="px-4 py-2.5 font-medium text-text-secondary">Company</th>
              <th className="px-4 py-2.5 font-medium text-text-secondary">Your {noun} record</th>
              <th className="px-4 py-2.5 font-medium text-text-secondary">Status</th>
              <th className="px-4 py-2.5 font-medium text-text-secondary">Since</th>
              <th className="px-4 py-2.5 font-medium text-text-secondary text-right">Actions</th>
            </tr>
          </thead>
          <tbody>{list.flatMap(rows)}</tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-surface border-b border-divider">
        <h1 className="text-[18px] font-semibold text-text-primary">Linked companies</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[13px]">
        <p className="text-text-secondary max-w-3xl">
          Clients and contractors that also use KaiSync. A link joins your record and theirs, so you work together
          inside KaiSync without portals or copies.
        </p>
        <div className="flex gap-1 border-b border-divider" role="tablist" aria-label="Linked companies">
          {TABS.map(t => {
            const g = groupLinks(links, t.id)
            const count = g.waiting.length + g.open.length
            const active = t.id === tab
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => { tabChosen.current = true; setTab(t.id); setAccepting(null); setShowEnded(false) }}
                className={`px-4 py-2 -mb-px border-b-2 text-[13px] inline-flex items-center gap-2 ${active ? 'border-primary text-primary font-semibold' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
              >
                {t.label}
                <span className="text-[11px] px-1.5 rounded-full bg-surface-elevated text-text-secondary">{count}</span>
                {g.waiting.length > 0 && (
                  <span className="w-2 h-2 rounded-full bg-warning" title={`${g.waiting.length} waiting for you`} aria-label={`${g.waiting.length} waiting for you`} />
                )}
              </button>
            )
          })}
        </div>
        {error && <p className="text-error">{error}</p>}
        {loading ? (
          <p className="text-text-secondary">Loading…</p>
        ) : (
          <>
            {waiting.length > 0 && (
              <section className="bg-surface border border-warning/40 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b border-divider bg-warning/5">
                  <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">Waiting for you ({waiting.length})</p>
                </div>
                {table(waiting)}
              </section>
            )}
            <section className="bg-surface border border-divider rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-divider bg-surface-elevated">
                <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">{current.label}: linked and requested ({open.length})</p>
              </div>
              {open.length === 0 ? (
                <p className="px-4 py-6 text-text-secondary text-center">{current.empty} {current.how}</p>
              ) : (
                table(open)
              )}
            </section>
            {ended.length > 0 && (
              <section>
                <button onClick={() => setShowEnded(v => !v)} className="text-primary hover:underline">
                  {showEnded ? 'Hide' : 'Show'} ended links ({ended.length})
                </button>
                {showEnded && (
                  <div className="mt-2 bg-surface border border-divider rounded-lg overflow-hidden">{table(ended)}</div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
