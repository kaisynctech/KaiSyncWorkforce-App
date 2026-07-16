'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageThread = {
  id: string
  subject: string | null
  last_message_at: string | null
  last_message_preview: string | null
  participant_ids: string[] | null
  type_raw: string | null
  is_archived: boolean | null
}

type AppMessage = {
  id: string
  thread_id: string
  sender_id: string
  sender_display_name: string | null
  body: string
  created_at: string
  read_by_ids: string[] | null
}

type EmpPick = { id: string; name: string; surname: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(d: string | null) {
  if (!d) return ''
  const date = new Date(d)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  if (isToday) {
    return date.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MessagesPage() {
  const [threads,        setThreads]        = useState<MessageThread[]>([])
  const [selected,       setSelected]       = useState<MessageThread | null>(null)
  const [messages,       setMessages]       = useState<AppMessage[]>([])
  const [msgText,        setMsgText]        = useState('')
  const [loading,        setLoading]        = useState(true)
  const [msgLoading,     setMsgLoading]     = useState(false)
  const [sending,        setSending]        = useState(false)
  const [showNew,        setShowNew]        = useState(false)
  const [employees,      setEmployees]      = useState<EmpPick[]>([])
  const [empSearch,      setEmpSearch]      = useState('')
  const [companyId,      setCompanyId]      = useState<string | null>(null)
  const [employeeId,     setEmployeeId]     = useState<string | null>(null)
  const [myName,         setMyName]         = useState('')
  const [notLinked,      setNotLinked]      = useState(false)

  const bottomRef     = useRef<HTMLDivElement>(null)
  const cIdRef        = useRef<string | null>(null)
  const eIdRef        = useRef<string | null>(null)
  const selectedRef   = useRef<MessageThread | null>(null)
  selectedRef.current = selected

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  async function init() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setNotLinked(true); setLoading(false); return }

    cIdRef.current = member.companyId
    eIdRef.current = member.employeeId
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    const { data: me } = await supabase
      .from('employees').select('name, surname')
      .eq('id', member.employeeId).single()
    if (me) setMyName(`${me.name} ${me.surname}`)

    await Promise.all([
      loadThreads(member.companyId, member.employeeId),
      loadEmployees(member.companyId, member.employeeId),
    ])
    setLoading(false)
  }

  // ── Thread / employee loaders ──────────────────────────────────────────────
  async function loadThreads(cid: string, eid: string) {
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_message_threads_for_worker', {
      p_company_id: cid,
      p_employee_id: eid,
    })
    const sorted = ((data ?? []) as MessageThread[])
      .filter(t => !t.is_archived)
      .sort((a, b) => {
        if (!a.last_message_at) return 1
        if (!b.last_message_at) return -1
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      })
    setThreads(sorted)
  }

  async function loadEmployees(cid: string, myId: string) {
    const supabase = createClient()
    const { data } = await supabase
      .from('employees').select('id, name, surname')
      .eq('company_id', cid).eq('is_active', true)
      .neq('id', myId).order('name')
    setEmployees((data ?? []) as EmpPick[])
  }

  // ── Select thread ──────────────────────────────────────────────────────────
  async function selectThread(thread: MessageThread) {
    const cid = cIdRef.current
    const eid = eIdRef.current
    if (!cid || !eid) return
    setSelected(thread)
    setMsgLoading(true)
    const supabase = createClient()
    const [msgRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.rpc as any)('employee_get_thread_messages_for_worker', {
        p_company_id: cid, p_thread_id: thread.id,
        p_employee_id: eid, p_limit: 200,
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.rpc as any)('employee_mark_thread_read_for_worker', {
        p_company_id: cid, p_thread_id: thread.id, p_employee_id: eid,
      }),
    ])
    setMessages((msgRes.data ?? []) as AppMessage[])
    setMsgLoading(false)
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
  }

  async function reloadMessages() {
    const thread = selectedRef.current
    const cid = cIdRef.current
    const eid = eIdRef.current
    if (!thread || !cid || !eid) return
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_thread_messages_for_worker', {
      p_company_id: cid, p_thread_id: thread.id,
      p_employee_id: eid, p_limit: 200,
    })
    setMessages((data ?? []) as AppMessage[])
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  // ── Realtime ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    const channel = supabase
      .channel('messages-rt')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'app_messages',
        filter: `company_id=eq.${companyId}`,
      }, () => {
        reloadMessages()
        if (cIdRef.current && eIdRef.current) {
          loadThreads(cIdRef.current, eIdRef.current)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [companyId])

  // ── Send message ───────────────────────────────────────────────────────────
  async function sendMessage() {
    const body = msgText.trim()
    if (!body || !selected || !companyId || !employeeId) return
    setSending(true)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)('employee_send_thread_message', {
      p_company_id: companyId, p_thread_id: selected.id,
      p_sender_employee_id: employeeId, p_body: body,
    })
    setMsgText('')
    await Promise.all([reloadMessages(), loadThreads(companyId, employeeId)])
    setSending(false)
  }

  // ── Start DM ───────────────────────────────────────────────────────────────
  async function startDM(peer: EmpPick) {
    if (!companyId || !employeeId) return
    const peerName = `${peer.name} ${peer.surname}`
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: thread } = await (supabase.rpc as any)('employee_get_or_create_direct_thread_peer', {
      p_company_id: companyId, p_creator_id: employeeId,
      p_peer_id: peer.id, p_title: `${myName} & ${peerName}`,
    })
    setShowNew(false)
    setEmpSearch('')
    await loadThreads(companyId, employeeId)
    if (thread?.id) {
      const t = thread as MessageThread
      setSelected(t)
      await selectThread(t)
    }
  }

  const filteredEmps = employees.filter(e =>
    `${e.name} ${e.surname}`.toLowerCase().includes(empSearch.toLowerCase())
  )

  // ── Not linked guard ───────────────────────────────────────────────────────
  if (notLinked) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">Contact your administrator.</p>
      </div>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex overflow-hidden">

      {/* ── Thread list ────────────────────────────────────────────────────── */}
      <div className={`flex flex-col border-r border-divider shrink-0 bg-surface w-[280px] ${selected ? 'hidden sm:flex' : 'flex w-full sm:w-[280px]'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0">
          <h1 className="text-[16px] font-semibold text-text-primary">Messages</h1>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1 h-8 px-3 rounded-lg bg-primary text-white text-[12px] font-semibold hover:bg-primary-dark transition-colors"
          >
            <span className="material-icons text-[14px]">add</span>
            New
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
          ) : threads.length === 0 ? (
            <div className="py-16 text-center px-4">
              <span className="material-icons text-[44px] text-text-disabled block mb-2">chat_bubble_outline</span>
              <p className="text-[13px] text-text-secondary">No conversations yet</p>
              <button onClick={() => setShowNew(true)} className="mt-2 text-primary text-[12px] hover:underline">
                Start a conversation
              </button>
            </div>
          ) : threads.map(t => {
            const isActive = selected?.id === t.id
            return (
              <button
                key={t.id}
                onClick={() => selectThread(t)}
                className={`w-full text-left px-4 py-3 border-b border-divider transition-colors hover:bg-background ${
                  isActive ? 'bg-primary/5 border-l-[3px] border-l-primary' : ''
                }`}
              >
                <div className="flex justify-between items-start gap-2 mb-0.5">
                  <p className="text-[13px] font-semibold text-text-primary truncate flex-1">
                    {t.subject ?? 'Untitled'}
                  </p>
                  <p className="text-[10px] text-text-disabled shrink-0 mt-0.5">{fmtTime(t.last_message_at)}</p>
                </div>
                {t.last_message_preview && (
                  <p className="text-[12px] text-text-secondary truncate">{t.last_message_preview}</p>
                )}
                {t.type_raw && t.type_raw !== 'direct' && (
                  <span className="inline-block mt-1 text-[10px] text-text-disabled capitalize bg-background border border-divider rounded px-1.5 py-0.5">
                    {t.type_raw.replace(/_/g, ' ')}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Conversation panel ─────────────────────────────────────────────── */}
      <div className={`flex-1 flex flex-col min-w-0 ${!selected ? 'hidden sm:flex' : 'flex'}`}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <span className="material-icons text-[60px] text-text-disabled block mb-3">forum</span>
              <p className="text-[14px] text-text-secondary">Select a conversation to start messaging</p>
            </div>
          </div>
        ) : (
          <>
            {/* Conversation header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-divider bg-surface shrink-0">
              <button
                onClick={() => setSelected(null)}
                className="sm:hidden text-text-secondary hover:text-text-primary transition-colors"
              >
                <span className="material-icons text-[20px]">arrow_back</span>
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-text-primary truncate">
                  {selected.subject ?? 'Untitled'}
                </p>
                {selected.type_raw && selected.type_raw !== 'direct' && (
                  <p className="text-[11px] text-text-disabled capitalize">
                    {selected.type_raw.replace(/_/g, ' ')}
                  </p>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-background">
              {msgLoading ? (
                <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
              ) : messages.length === 0 ? (
                <div className="py-16 text-center">
                  <span className="material-icons text-[40px] text-text-disabled block mb-2">chat_bubble_outline</span>
                  <p className="text-[13px] text-text-secondary">No messages yet — say something!</p>
                </div>
              ) : messages.map(msg => {
                const isMe = msg.sender_id === employeeId
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    {!isMe && (
                      <p className="text-[11px] text-text-secondary mb-1 px-1">
                        {msg.sender_display_name ?? 'Unknown'}
                      </p>
                    )}
                    <div className={`max-w-[72%] rounded-2xl px-4 py-2.5 ${
                      isMe
                        ? 'bg-primary text-white rounded-tr-sm'
                        : 'bg-surface border border-divider text-text-primary rounded-tl-sm'
                    }`}>
                      <p className="text-[13px] whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                    </div>
                    <p className="text-[10px] text-text-disabled mt-1 px-1">{fmtTime(msg.created_at)}</p>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div className="shrink-0 px-4 py-3 border-t border-divider bg-surface flex items-end gap-2">
              <textarea
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
                }}
                placeholder="Type a message…"
                rows={1}
                className="flex-1 resize-none bg-background border border-border rounded-xl px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-28 overflow-y-auto"
              />
              <button
                onClick={sendMessage}
                disabled={!msgText.trim() || sending}
                className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center disabled:opacity-40 hover:bg-primary-dark transition-colors shrink-0"
              >
                <span className="material-icons text-[18px]">send</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── New Message modal ──────────────────────────────────────────────── */}
      {showNew && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
              <p className="text-[15px] font-semibold text-text-primary">New Message</p>
              <button
                onClick={() => { setShowNew(false); setEmpSearch('') }}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                <span className="material-icons text-[20px]">close</span>
              </button>
            </div>
            <div className="p-4">
              <input
                type="text"
                placeholder="Search employee…"
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                autoFocus
                className="input mb-3"
              />
              <div className="max-h-64 overflow-y-auto">
                {filteredEmps.length === 0 ? (
                  <p className="text-[13px] text-text-secondary py-8 text-center">No employees found</p>
                ) : filteredEmps.map(e => (
                  <button
                    key={e.id}
                    onClick={() => startDM(e)}
                    className="w-full text-left px-3 py-3 rounded-lg hover:bg-background transition-colors flex items-center gap-3"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-primary text-[11px] font-semibold">
                        {`${e.name[0]}${e.surname[0]}`.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-[13px] font-medium text-text-primary">{e.name} {e.surname}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
