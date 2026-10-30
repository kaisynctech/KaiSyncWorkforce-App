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
import {
  filterLinks, historyWords, linkHistory, linkSummary, workHref, workOverview, workStatusWords,
  type HistoryRow, type LinkSummary, type StatusFilter, type WorkItem,
} from '@/lib/linked-extras'
import { moneyZAR } from '@/lib/client-portal/quotation'

type View = LinkTab | 'work'

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
  const [view, setView] = useState<View>('clients')
  const tabChosen = useRef(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [summary, setSummary] = useState<Record<string, LinkSummary>>({})
  const [work, setWork] = useState<WorkItem[] | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[] | null>(null)

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
      if (!tabChosen.current) { const t = startTab(res.data); setTab(t); setView(t) }
      const sum = await linkSummary(supabase, member.companyId)
      setSummary(sum.ok ? sum.data : {})
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function openWork() {
    tabChosen.current = true
    setView('work')
    setAccepting(null)
    if (!companyId) return
    setWork(null)
    const res = await workOverview(createClient(), companyId)
    if (!res.ok) { setError(res.message); setWork([]) } else setWork(res.data)
  }

  async function toggleHistory(link: CompanyLink) {
    if (historyFor === link.id) { setHistoryFor(null); return }
    if (!companyId) return
    setHistoryFor(link.id)
    setHistory(null)
    const res = await linkHistory(createClient(), companyId, link.id)
    if (!res.ok) { setError(res.message); setHistory([]) } else setHistory(res.data)
  }

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

  const { waiting, open, ended } = groupLinks(filterLinks(links, query, statusFilter), tab)
  const filtering = query.trim() !== '' || statusFilter !== 'all'
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
        {glance(link)}
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
            {link.status !== 'pending' && (
              <button onClick={() => void toggleHistory(link)} className="btn-outlined h-8 px-3 text-[12px] whitespace-nowrap" aria-expanded={historyFor === link.id}>
                History
              </button>
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
          <td colSpan={8} className="px-4 py-3">
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
      historyFor === link.id ? (
        <tr key={`${link.id}-history`} className="bg-surface-elevated/40">
          <td colSpan={8} className="px-4 py-3">
            <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase mb-2">History with {link.other.name}</p>
            {history === null ? (
              <p className="text-text-secondary">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-text-secondary">Nothing has happened through this link yet.</p>
            ) : (
              <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                {history.map((h, i) => (
                  <li key={`${h.action}-${h.at}-${i}`} className="flex flex-wrap gap-x-3">
                    <span className="text-text-secondary whitespace-nowrap w-36">{new Date(h.at).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="text-text-primary font-medium">{historyWords(h.action)}</span>
                    {h.who && <span className="text-text-secondary">by {h.who}</span>}
                    {historyDetail(h) && <span className="text-text-secondary">· {historyDetail(h)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      ) : null,
    ]
  }

  function historyDetail(h: HistoryRow): string {
    const d = h.details ?? {}
    const parts: string[] = []
    if (typeof d.title === 'string') parts.push(d.title)
    if (typeof d.job_code === 'string') parts.push(d.job_code)
    if (d.amount != null && d.amount !== '') parts.push(moneyZAR(Number(d.amount)))
    return parts.join(' · ')
  }

  function glance(link: CompanyLink) {
    const s = link.status === 'active' ? summary[link.id] : undefined
    const cell = 'px-4 py-3 whitespace-nowrap text-right'
    if (!s) return (<><td className={cell}>—</td><td className={cell}>—</td><td className={cell}>—</td></>)
    return (
      <>
        <td className={cell}>{s.open_jobs}</td>
        <td className={`${cell} ${s.quotes_waiting > 0 ? 'text-warning font-semibold' : ''}`}>{s.quotes_waiting}</td>
        <td className={`${cell} ${s.owing > 0.009 ? 'text-text-primary font-semibold' : 'text-text-secondary'}`}>{moneyZAR(s.owing)}</td>
      </>
    )
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
              <th className="px-4 py-2.5 font-medium text-text-secondary text-right">Open jobs</th>
              <th className="px-4 py-2.5 font-medium text-text-secondary text-right" title={tab === 'clients' ? 'Quotes you sent that they have not answered' : 'Quotes they sent that you have not answered'}>Quotes waiting</th>
              <th className="px-4 py-2.5 font-medium text-text-secondary text-right">{tab === 'clients' ? 'They owe you' : 'You owe'}</th>
              <th className="px-4 py-2.5 font-medium text-text-secondary text-right">Actions</th>
            </tr>
          </thead>
          <tbody>{list.flatMap(rows)}</tbody>
        </table>
      </div>
    )
  }

  function workView() {
    if (work === null) return <p className="text-text-secondary">Loading…</p>
    const owing = work.filter(w => w.kind === 'invoice').reduce((s, w) => s + (w.amount ?? 0), 0)
    const counts = { quote: 0, invoice: 0, job: 0 }
    for (const w of work) counts[w.kind] += 1
    return (
      <div className="space-y-3">
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 max-w-4xl">
          {[
            ['Open jobs', String(counts.job)],
            ['Quotes waiting for you', String(counts.quote)],
            ['Invoices to pay', String(counts.invoice)],
            ['You owe', moneyZAR(owing)],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface border border-divider rounded-lg px-4 py-3">
              <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{label}</p>
              <p className="text-[18px] font-bold text-text-primary">{value}</p>
            </div>
          ))}
        </div>
        <section className="bg-surface border border-divider rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-divider bg-surface-elevated">
            <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">Open work from all your linked contractors ({work.length})</p>
          </div>
          {work.length === 0 ? (
            <p className="px-4 py-6 text-text-secondary text-center">Nothing open right now: no open jobs, quotes waiting or invoices to pay.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-surface-elevated/50 text-left">
                    <th className="px-4 py-2.5 font-medium text-text-secondary">Contractor</th>
                    <th className="px-4 py-2.5 font-medium text-text-secondary">What</th>
                    <th className="px-4 py-2.5 font-medium text-text-secondary">Reference</th>
                    <th className="px-4 py-2.5 font-medium text-text-secondary">Status</th>
                    <th className="px-4 py-2.5 font-medium text-text-secondary">Date</th>
                    <th className="px-4 py-2.5 font-medium text-text-secondary text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {work.map(w => (
                    <tr key={`${w.kind}-${w.id}`} className="border-t border-divider">
                      <td className="px-4 py-3 text-text-primary whitespace-nowrap">{w.provider}</td>
                      <td className="px-4 py-3">
                        <Link href={workHref(w)} className="text-primary hover:underline">
                          <span className="text-text-secondary capitalize">{w.kind}: </span>{w.title || '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{w.ref || '—'}</td>
                      <td className={`px-4 py-3 whitespace-nowrap capitalize ${w.kind === 'quote' ? 'text-warning font-semibold' : 'text-text-primary'}`}>{workStatusWords(w)}</td>
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{w.date ? new Date(w.date).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{w.amount != null ? moneyZAR(w.amount) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
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
            const active = t.id === view
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => { tabChosen.current = true; setTab(t.id); setView(t.id); setAccepting(null); setShowEnded(false); setHistoryFor(null) }}
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
          {groupLinks(links, 'contractors').open.some(l => l.status === 'active') && (
            <button
              role="tab"
              aria-selected={view === 'work'}
              onClick={() => void openWork()}
              className={`px-4 py-2 -mb-px border-b-2 text-[13px] inline-flex items-center gap-2 ${view === 'work' ? 'border-primary text-primary font-semibold' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
            >
              Work from my contractors
            </button>
          )}
        </div>
        {error && <p className="text-error">{error}</p>}
        {loading ? (
          <p className="text-text-secondary">Loading…</p>
        ) : view === 'work' ? (
          workView()
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <span className="material-icons absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-text-secondary">search</span>
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={`Search ${tab === 'clients' ? 'clients' : 'contractors'} by company name`}
                  aria-label="Search linked companies"
                  className="w-full h-9 pl-9 pr-3 rounded-lg border border-divider bg-surface text-[13px] text-text-primary"
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                aria-label="Status"
                className="h-9 px-3 rounded-lg border border-divider bg-surface text-[13px] text-text-primary"
              >
                <option value="all">All statuses</option>
                <option value="linked">Linked</option>
                <option value="waiting">Waiting to accept</option>
              </select>
              {filtering && (
                <button onClick={() => { setQuery(''); setStatusFilter('all') }} className="text-primary hover:underline text-[13px]">Clear</button>
              )}
            </div>
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
                <p className="px-4 py-6 text-text-secondary text-center">{filtering ? 'No companies match your search.' : `${current.empty} ${current.how}`}</p>
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
