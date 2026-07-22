'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ClientPortalShell } from '@/components/ClientPortalShell'
import { useRequireClientPortalSession } from '@/lib/client-portal/use-session'
import { listInvoices, listMessageInbox, listProjects } from '@/lib/client-portal/api'
import { getDealMessagesReadAt } from '@/lib/client-portal/session'
import { fmtDate, fmtDateTime, projectStatusLabel } from '@/lib/client-portal/format'
import { moneyZAR } from '@/lib/client-portal/quotation'
import { isInvoiceOutstanding, type ClientPortalProject, type MessageInboxItem, type PortalInvoice } from '@/lib/client-portal/types'

type Tab = 'projects' | 'messages' | 'invoices'

export default function ClientPortalHomePage() {
  const { session, ready } = useRequireClientPortalSession()
  const [tab, setTab] = useState<Tab>('projects')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<ClientPortalProject[]>([])
  const [inbox, setInbox] = useState<MessageInboxItem[]>([])
  const [invoices, setInvoices] = useState<PortalInvoice[]>([])

  useEffect(() => {
    if (!session) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function load() {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const [p, m, inv] = await Promise.all([
        listProjects(session.company_code, session.client_code),
        listMessageInbox(session.company_code, session.client_code),
        listInvoices(session.company_code, session.client_code),
      ])
      const withUnread = m.map(item => {
        if (!item.last_from_hr || !item.last_message_at) {
          return { ...item, has_unread: false }
        }
        const readAt = getDealMessagesReadAt(item.deal_id)
        const hasUnread = !readAt || new Date(item.last_message_at) > new Date(readAt)
        return { ...item, has_unread: hasUnread }
      })
      setProjects(p)
      setInbox(withUnread)
      setInvoices(inv)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load portal.')
    }
    setLoading(false)
  }

  const unreadCount = useMemo(() => inbox.filter(i => i.has_unread).length, [inbox])
  const outstanding = useMemo(
    () => invoices.filter(i => isInvoiceOutstanding(i.status)).reduce((s, i) => s + i.balance_due, 0),
    [invoices],
  )

  if (!ready || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-slate-400 text-[14px]">
        Loading…
      </div>
    )
  }

  return (
    <ClientPortalShell session={session}>
      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        <div>
          <h1 className="text-white text-[20px] font-bold">Welcome, {session.client_name}</h1>
          <p className="text-slate-400 text-[13px] mt-0.5">Your projects, messages, and invoices</p>
        </div>

        <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {([
            ['projects', 'Projects'],
            ['messages', unreadCount > 0 ? `Messages (${unreadCount})` : 'Messages'],
            ['invoices', 'Invoices'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 text-[13px] font-semibold py-2 rounded-lg transition-colors ${
                tab === key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
            <p className="text-[13px] text-red-400 font-semibold">{error}</p>
            <button type="button" onClick={() => void load()} className="text-[12px] text-blue-400 mt-1 hover:underline">Retry</button>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-slate-400 text-[14px]">Loading…</div>
        ) : tab === 'projects' ? (
          <ProjectsTab projects={projects} />
        ) : tab === 'messages' ? (
          <MessagesTab inbox={inbox} />
        ) : (
          <InvoicesTab invoices={invoices} outstanding={outstanding} />
        )}
      </div>
    </ClientPortalShell>
  )
}

function ProjectsTab({ projects }: { projects: ClientPortalProject[] }) {
  if (projects.length === 0) {
    return (
      <Empty icon="folder_open" title="No projects yet" sub="Projects shared with you will appear here." />
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
            <Th>Code</Th>
            <Th>Project</Th>
            <Th>Status</Th>
            <Th>Progress</Th>
            <Th>Offer</Th>
            <Th>Updated</Th>
          </tr>
        </thead>
        <tbody>
          {projects.map(p => (
            <tr key={p.id} className="border-t hover:bg-white/[0.03]" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <td className="px-3 py-3 text-slate-400 whitespace-nowrap">{p.project_code || '—'}</td>
              <td className="px-3 py-3">
                <Link href={`/client-portal/projects/${p.id}`} className="text-white font-semibold hover:text-blue-300">
                  {p.title}
                </Link>
              </td>
              <td className="px-3 py-3 text-slate-300 whitespace-nowrap">{projectStatusLabel(p.status)}</td>
              <td className="px-3 py-3 text-slate-300 whitespace-nowrap">{p.progress_percent}%</td>
              <td className="px-3 py-3 text-slate-300 whitespace-nowrap">{moneyZAR(p.offer_amount)}</td>
              <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{fmtDate(p.last_update_at ?? p.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MessagesTab({ inbox }: { inbox: MessageInboxItem[] }) {
  if (inbox.length === 0) {
    return (
      <Empty icon="chat_bubble_outline" title="No conversations" sub="Message threads for your projects will show here." />
    )
  }
  return (
    <div className="divide-y rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.08)', borderTopColor: 'rgba(255,255,255,0.08)' }}>
      {inbox.map(item => (
        <Link
          key={item.deal_id}
          href={`/client-portal/projects/${item.deal_id}?messages=1`}
          className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors"
          style={{ borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <span className={`material-icons text-[22px] mt-0.5 ${item.has_unread ? 'text-blue-400' : 'text-slate-500'}`}>
            {item.has_unread ? 'mark_email_unread' : 'chat'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={`text-[14px] truncate ${item.has_unread ? 'text-white font-bold' : 'text-white font-semibold'}`}>
                {item.project_title}
              </p>
              {item.has_unread && (
                <span className="text-[10px] font-bold uppercase text-blue-300 bg-blue-500/20 px-1.5 py-0.5 rounded">New</span>
              )}
            </div>
            {item.project_code && <p className="text-[11px] text-slate-500">{item.project_code}</p>}
            <p className="text-[12px] text-slate-400 mt-0.5 line-clamp-2">{item.last_message_preview || 'No messages yet'}</p>
            <p className="text-[11px] text-slate-600 mt-1">{fmtDateTime(item.last_message_at)}</p>
          </div>
          <span className="material-icons text-slate-600 text-[18px]">chevron_right</span>
        </Link>
      ))}
    </div>
  )
}

function InvoicesTab({ invoices, outstanding }: { invoices: PortalInvoice[]; outstanding: number }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl px-4 py-3 flex items-center justify-between" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' }}>
        <p className="text-[12px] font-semibold text-blue-300 uppercase tracking-wide">Outstanding</p>
        <p className="text-[18px] font-bold text-white">{moneyZAR(outstanding)}</p>
      </div>
      {invoices.length === 0 ? (
        <Empty icon="receipt_long" title="No invoices" sub="Invoices issued to you will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                <Th>Number</Th>
                <Th>Status</Th>
                <Th>Total</Th>
                <Th>Balance</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <td className="px-3 py-3 text-white font-medium whitespace-nowrap">{inv.invoice_number || '—'}</td>
                  <td className="px-3 py-3 text-slate-300 capitalize whitespace-nowrap">{inv.status.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-3 text-slate-300 whitespace-nowrap">{moneyZAR(inv.total_amount)}</td>
                  <td className={`px-3 py-3 whitespace-nowrap font-semibold ${isInvoiceOutstanding(inv.status) ? 'text-amber-300' : 'text-slate-400'}`}>
                    {moneyZAR(inv.balance_due)}
                  </td>
                  <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{fmtDate(inv.issue_date)}</td>
                  <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{fmtDate(inv.due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
      {children}
    </th>
  )
}

function Empty({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
      <span className="material-icons text-[48px] text-slate-600">{icon}</span>
      <p className="text-[15px] font-semibold text-white">{title}</p>
      <p className="text-[13px] text-slate-500 max-w-sm">{sub}</p>
    </div>
  )
}
