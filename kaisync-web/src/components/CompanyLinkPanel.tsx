'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  createInvite, decideLink, disconnectLink, inviteUrl, linkForRecord, requestLink, searchCompanies,
  relationWords, statusWords, type LinkCompany, type LinkRole, type RecordLink,
} from '@/lib/company-links'

type Props = {
  companyId: string
  /** 'provider' on a client record (they are my client), 'customer' on a contractor record. */
  myRole: LinkRole
  recordId: string
}

/**
 * "KaiSync link" card on a client or contractor record: shows whether this record is joined
 * to another KaiSync company, and lets the owner, HR or an admin link, accept or disconnect.
 * Hidden for people without office access (the database says NOT_ALLOWED).
 */
export function CompanyLinkPanel({ companyId, myRole, recordId }: Props) {
  const [loading, setLoading] = useState(true)
  const [hidden, setHidden] = useState(false)
  const [link, setLink] = useState<RecordLink | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LinkCompany[] | null>(null)
  const [invite, setInvite] = useState<{ url: string; expires: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const res = await linkForRecord(createClient(), companyId, myRole, recordId)
    if (!res.ok) {
      if (/access to linked companies/.test(res.message)) setHidden(true)
      else setError(res.message)
      setLink(null)
    } else {
      setLink(res.data && (res.data.status === 'active' || res.data.status === 'pending') ? res.data : null)
    }
    setLoading(false)
  }, [companyId, myRole, recordId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the database once, then sets state
  useEffect(() => { void load() }, [load])

  async function run<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>): Promise<T | null> {
    setBusy(true)
    setError(null)
    const res = await fn()
    setBusy(false)
    if (!res.ok) { setError(res.message); return null }
    return res.data
  }

  async function search() {
    if (query.trim().length < 3) { setError('Type at least 3 letters of the company name.'); return }
    const data = await run(() => searchCompanies(createClient(), companyId, query.trim()))
    if (data) setResults(data)
  }

  async function sendRequest(other: LinkCompany) {
    const verb = myRole === 'provider' ? 'your client' : 'your contractor'
    if (!window.confirm(`Send a link request to ${other.name} as ${verb}? They accept it inside their own KaiSync.`)) return
    const data = await run(() => requestLink(createClient(), companyId, other.id, myRole, recordId))
    if (data) { setResults(null); setQuery(''); await load() }
  }

  async function makeInvite() {
    const data = await run(() => createInvite(createClient(), companyId, myRole, recordId))
    if (data) {
      setInvite({ url: inviteUrl(window.location.origin, data.token), expires: new Date(data.expires_at).toLocaleDateString() })
      setCopied(false)
    }
  }

  async function copyInvite() {
    if (!invite) return
    try { await navigator.clipboard.writeText(invite.url); setCopied(true) } catch { setCopied(false) }
  }

  async function accept(yes: boolean) {
    if (!link) return
    if (!yes && !window.confirm(`Decline the link request from ${link.other.name}?`)) return
    const data = await run(() => decideLink(createClient(), companyId, link.id, yes, yes ? recordId : null))
    if (data) await load()
  }

  async function disconnect() {
    if (!link) return
    const msg = link.status === 'active'
      ? `Disconnect from ${link.other.name}? Shared work stays with the company that did it; you both stop seeing each other's side.`
      : `Cancel the link request to ${link.other.name}?`
    if (!window.confirm(msg)) return
    const data = await run(() => disconnectLink(createClient(), companyId, link.id))
    if (data) await load()
  }

  if (hidden) return null

  return (
    <div className="bg-surface border border-divider rounded-lg overflow-hidden" data-testid="company-link-panel">
      <div className="px-4 py-2.5 border-b border-divider bg-surface-elevated flex items-center gap-2">
        <span className="material-icons text-[16px] text-text-secondary">link</span>
        <p className="text-[11px] font-semibold text-text-secondary tracking-wider uppercase">KaiSync link</p>
      </div>
      <div className="p-4 space-y-3 text-[13px]">
        {loading ? (
          <p className="text-text-secondary">Loading…</p>
        ) : link ? (
          <>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="font-semibold text-text-primary">{link.other.name}</p>
                {link.other.legal_name && link.other.legal_name !== link.other.name && (
                  <p className="text-text-secondary text-[12px]">{link.other.legal_name}</p>
                )}
                <p className="text-text-secondary mt-1">
                  {link.status === 'active'
                    ? relationWords(myRole, link.other.name) + ' on KaiSync.'
                    : link.waiting_on_me
                      ? `${link.other.name} asked to link with you as your ${myRole === 'provider' ? 'client' : 'contractor'}.`
                      : 'Request sent. They accept it inside their own KaiSync.'}
                  {link.status === 'active' && link.decided_at ? ` Linked ${new Date(link.decided_at).toLocaleDateString()}.` : ''}
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${link.status === 'active' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                {statusWords(link)}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {link.status === 'active' && myRole === 'customer' && (
                <Link href={`/dashboard/linked-companies/${link.id}`} className="btn-primary h-9 px-3 text-[13px] inline-flex items-center">
                  Open {link.other.name}&apos;s work for you
                </Link>
              )}
              {link.status === 'pending' && link.waiting_on_me && (
                <>
                  <button disabled={busy} onClick={() => void accept(true)} className="btn-primary h-9 px-3 text-[13px]">Accept and link this record</button>
                  <button disabled={busy} onClick={() => void accept(false)} className="btn-outlined h-9 px-3 text-[13px]">Decline</button>
                </>
              )}
              <button disabled={busy} onClick={() => void disconnect()} className="btn-outlined h-9 px-3 text-[13px]">
                {link.status === 'active' ? 'Disconnect' : link.waiting_on_me ? 'Remove' : 'Cancel request'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-text-secondary">
              If this {myRole === 'provider' ? 'client' : 'contractor'} also uses KaiSync, link the two companies.
              Work is then shared through KaiSync instead of a portal, with nothing copied.
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void search() } }}
                placeholder="Search KaiSync companies by name or registration number"
                aria-label="Search KaiSync companies"
                className="flex-1 min-w-[220px] h-9 px-3 rounded-md border border-border bg-surface text-text-primary focus:outline-none"
              />
              <button disabled={busy} onClick={() => void search()} className="btn-outlined h-9 px-3 text-[13px]">Search</button>
              <button disabled={busy} onClick={() => void makeInvite()} className="btn-outlined h-9 px-3 text-[13px]">Make invite link</button>
            </div>
            {results && (
              results.length === 0 ? (
                <p className="text-text-secondary">No KaiSync company found. Try another spelling, or send an invite link.</p>
              ) : (
                <ul className="border border-divider rounded-md divide-y divide-divider">
                  {results.map(c => (
                    <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div>
                        <p className="font-medium text-text-primary">{c.name}</p>
                        <p className="text-[12px] text-text-secondary">
                          {[c.legal_name !== c.name ? c.legal_name : null, c.registration_number].filter(Boolean).join(' · ') || ' '}
                        </p>
                      </div>
                      <button disabled={busy} onClick={() => void sendRequest(c)} className="btn-primary h-8 px-3 text-[12px]">Request link</button>
                    </li>
                  ))}
                </ul>
              )
            )}
            {invite && (
              <div className="rounded-md border border-divider p-3 space-y-2 bg-surface-elevated/40">
                <p className="text-text-secondary">Send this to the other company. Someone there (owner, HR or admin) opens it while signed in. One use, until {invite.expires}.</p>
                <div className="flex gap-2 flex-wrap">
                  <input readOnly value={invite.url} aria-label="Invite link" className="flex-1 min-w-[220px] h-9 px-3 rounded-md border border-border bg-surface text-[12px] text-text-primary" />
                  <button onClick={() => void copyInvite()} className="btn-outlined h-9 px-3 text-[13px]">{copied ? 'Copied' : 'Copy'}</button>
                </div>
              </div>
            )}
          </>
        )}
        {error && <p className="text-error">{error}</p>}
        <p className="text-[12px]"><Link href="/dashboard/linked-companies" className="text-primary hover:underline">All linked companies</Link></p>
      </div>
    </div>
  )
}
