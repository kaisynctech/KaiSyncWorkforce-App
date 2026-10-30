'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { SearchPicker } from '@/components/SearchPicker'
import {
  decideLink, disconnectLink, groupLinks, startTab, listLinks, myRecordNoun, myUnlinkedRecords, relationWords, statusWords,
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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the database once, then sets state
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

  function row(link: CompanyLink) {
    const href = recordHref(link)
    return (
      <li key={link.id} className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="font-semibold text-text-primary">{link.other.name}</p>
          <p className="text-text-secondary text-[12px]">
            {relationWords(link.my_role, link.other.name)}
            {link.my_record_name ? <> · your {myRecordNoun(link.my_role)} record: {href ? <Link href={href} className="text-primary hover:underline">{link.my_record_name}</Link> : link.my_record_name}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${link.status === 'active' ? 'bg-success/10 text-success' : link.status === 'pending' ? 'bg-warning/10 text-warning' : 'bg-surface-elevated text-text-secondary'}`}>
            {statusWords(link)}
          </span>
          {link.status === 'pending' && link.waiting_on_me && (
            <>
              <button disabled={busy === link.id} onClick={() => void startAccept(link)} className="btn-primary h-8 px-3 text-[12px]">Accept…</button>
              <button disabled={busy === link.id} onClick={() => void decide(link, false, null)} className="btn-outlined h-8 px-3 text-[12px]">Decline</button>
            </>
          )}
          {link.status === 'active' && link.my_role === 'customer' && (
            <Link href={`/dashboard/linked-companies/${link.id}`} className="btn-primary h-8 px-3 text-[12px] inline-flex items-center">Open their work</Link>
          )}
          {(link.status === 'active' || (link.status === 'pending' && !link.waiting_on_me)) && (
            <button disabled={busy === link.id} onClick={() => void disconnect(link)} className="btn-outlined h-8 px-3 text-[12px]">
              {link.status === 'active' ? 'Disconnect' : 'Cancel request'}
            </button>
          )}
        </div>
        {accepting?.id === link.id && (
          <div className="w-full rounded-md border border-divider p-3 space-y-3 bg-surface-elevated/40">
            <p className="text-text-secondary">
              {link.other.name} says it works with you. Choose your {myRecordNoun(link.my_role)} record for them,
              or leave it empty to create a new {myRecordNoun(link.my_role)} called “{link.other.name}”.
            </p>
            <SearchPicker
              options={records.map(r => ({ id: r.id, label: r.name }))}
              value={chosen}
              onChange={setChosen}
              label={`Your ${myRecordNoun(link.my_role)} record`}
              noun={myRecordNoun(link.my_role)}
            />
            <div className="flex gap-2">
              <button disabled={busy === link.id} onClick={() => void decide(link, true, chosen || null)} className="btn-primary h-9 px-3 text-[13px]">
                {chosen ? 'Accept and link' : `Accept and create ${myRecordNoun(link.my_role)}`}
              </button>
              <button onClick={() => setAccepting(null)} className="btn-outlined h-9 px-3 text-[13px]">Back</button>
            </div>
          </div>
        )}
      </li>
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
                <ul className="divide-y divide-divider">{waiting.map(row)}</ul>
              </section>
            )}
            <section className="bg-surface border border-divider rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-divider bg-surface-elevated">
                <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">{current.label}: linked and requested ({open.length})</p>
              </div>
              {open.length === 0 ? (
                <p className="px-4 py-6 text-text-secondary text-center">{current.empty} {current.how}</p>
              ) : (
                <ul className="divide-y divide-divider">{open.map(row)}</ul>
              )}
            </section>
            {ended.length > 0 && (
              <section>
                <button onClick={() => setShowEnded(v => !v)} className="text-primary hover:underline">
                  {showEnded ? 'Hide' : 'Show'} ended links ({ended.length})
                </button>
                {showEnded && (
                  <ul className="mt-2 bg-surface border border-divider rounded-lg divide-y divide-divider">{ended.map(row)}</ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
