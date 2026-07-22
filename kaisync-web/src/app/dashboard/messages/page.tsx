'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getCodeSession, getEmpContext } from '@/lib/auth/code-session'
import { usesCompanyDashboard } from '@/lib/auth/employee-routing'
import { loadCompanyWorkspace, loadEmployeeWorkspace, moduleFlagsForCompany } from '@/lib/employee-workspace'
import {
  chronologicalMessages,
  displayThreadSubject,
  mergeFeedThread,
  parseUuidRpcResult,
  tabForThread,
  threadMatchesTab,
  type MessageTab,
  type MessageThreadLike,
} from '@/lib/messaging'

type MessageThread = MessageThreadLike & {
  last_message_at: string | null
  last_message_preview: string | null
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

function sortThreads(list: MessageThread[]): MessageThread[] {
  return [...list]
    .filter(t => !t.is_archived)
    .sort((a, b) => {
      if (!a.last_message_at) return 1
      if (!b.last_message_at) return -1
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    })
}

export default function MessagesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const deepThreadId = searchParams.get('threadId')

  const [threads, setThreads] = useState<MessageThread[]>([])
  const [selected, setSelected] = useState<MessageThread | null>(null)
  const [messages, setMessages] = useState<AppMessage[]>([])
  const [msgText, setMsgText] = useState('')
  const [loading, setLoading] = useState(true)
  const [msgLoading, setMsgLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [employees, setEmployees] = useState<EmpPick[]>([])
  const [empSearch, setEmpSearch] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [myName, setMyName] = useState('')
  const [notLinked, setNotLinked] = useState(false)
  const [unreadThreadIds, setUnreadThreadIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<MessageTab>('direct')
  const [jobTitles, setJobTitles] = useState<Record<string, string>>({})
  const deepLinkHandled = useRef(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const cIdRef = useRef<string | null>(null)
  const eIdRef = useRef<string | null>(null)
  const tokRef = useRef<string | null>(null)
  const selectedRef = useRef<MessageThread | null>(null)
  selectedRef.current = selected

  useEffect(() => { void init() }, [])

  async function init() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setNotLinked(true); setLoading(false); return }

    const [company, emp] = await Promise.all([
      loadCompanyWorkspace(supabase, member.companyId),
      loadEmployeeWorkspace(supabase, member.employeeId),
    ])
    const accessLevel = emp?.access_level
      ?? getCodeSession()?.employee.access_level
      ?? getEmpContext()?.access_level
      ?? 'employee'
    const flags = moduleFlagsForCompany(company)
    if (!flags.messaging && !usesCompanyDashboard(accessLevel)) {
      router.replace('/dashboard/employee/overview')
      return
    }

    cIdRef.current = member.companyId
    eIdRef.current = member.employeeId
    tokRef.current = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)

    let resolvedName = ''
    const cs = getCodeSession()
    if (cs?.employee?.name) {
      resolvedName = `${cs.employee.name} ${cs.employee.surname ?? ''}`.trim()
    }
    if (!resolvedName) {
      try {
        const { data: me } = await supabase.from('employees').select('name, surname')
          .eq('id', member.employeeId).maybeSingle()
        if (me) resolvedName = `${me.name} ${me.surname}`
      } catch { /* non-critical */ }
    }
    setMyName(resolvedName)

    const list = await loadThreads(member.companyId, member.employeeId)
    await Promise.all([
      loadEmployees(member.companyId, member.employeeId),
      loadUnreadThreadIds(member.companyId, member.employeeId, list),
      loadJobTitleMap(member.companyId, member.employeeId),
    ])
    setLoading(false)
  }

  async function loadJobTitleMap(cid: string, eid: string) {
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.rpc as any)('employee_get_jobs_for_employee', {
        p_company_id: cid,
        p_employee_id: eid,
        p_session_token: tokRef.current,
      })
      const map: Record<string, string> = {}
      for (const j of (data ?? []) as { id: string; title?: string }[]) {
        if (j.id && j.title) map[j.id] = j.title
      }
      setJobTitles(map)
    } catch { /* non-critical */ }
  }

  async function loadThreads(cid: string, eid: string): Promise<MessageThread[]> {
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)

    const [threadsRes, feedRes] = await Promise.all([
      rpc('employee_get_message_threads_for_worker', {
        p_company_id: cid,
        p_employee_id: eid,
        p_session_token: tokRef.current,
      }),
      rpc('employee_get_company_feed_thread', {
        p_company_id: cid,
        p_employee_id: eid,
        p_session_token: tokRef.current,
      }),
    ])

    const feedRow = ((feedRes.data ?? []) as MessageThread[])[0] ?? null
    const merged = mergeFeedThread(
      sortThreads((threadsRes.data ?? []) as MessageThread[]),
      feedRow,
    )
    const sorted = sortThreads(merged)
    setThreads(sorted)
    return sorted
  }

  async function loadEmployees(cid: string, myId: string) {
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.rpc as any)('employee_list_company_peers', {
        p_company_id: cid,
        p_employee_id: myId,
        p_session_token: tokRef.current,
      })
      setEmployees(((data ?? []) as EmpPick[]).filter(e => e.id !== myId))
    } catch { /* non-critical */ }
  }

  async function loadUnreadThreadIds(cid: string, eid: string, threadList: MessageThread[]) {
    const threadIds = threadList.map(t => t.id)
    if (threadIds.length === 0) {
      setUnreadThreadIds(new Set())
      return
    }
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)
      const [countsRes, feedUnreadRes] = await Promise.all([
        rpc('message_unread_counts_for_threads', {
          p_company_id: cid,
          p_employee_id: eid,
          p_thread_ids: threadIds,
          p_session_token: tokRef.current,
        }),
        rpc('message_company_feed_unread_count', {
          p_company_id: cid,
          p_employee_id: eid,
          p_session_token: tokRef.current,
        }),
      ])
      const ids = new Set<string>()
      for (const row of (countsRes.data ?? []) as { thread_id: string; unread_count: number }[]) {
        if (Number(row.unread_count) > 0) ids.add(row.thread_id)
      }
      const feedCount = typeof feedUnreadRes.data === 'number'
        ? feedUnreadRes.data
        : Number(feedUnreadRes.data ?? 0)
      if (feedCount > 0) {
        const feed = threadList.find(t => (t.type_raw ?? '').toLowerCase() === 'company_feed')
        if (feed) ids.add(feed.id)
      }
      setUnreadThreadIds(ids)
    } catch { /* non-critical */ }
  }

  // Deep-link: /dashboard/messages?threadId=
  useEffect(() => {
    if (loading || !deepThreadId || deepLinkHandled.current || threads.length === 0) return
    const t = threads.find(x => x.id === deepThreadId)
    if (!t) return
    deepLinkHandled.current = true
    setActiveTab(tabForThread(t))
    void selectThread(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, deepThreadId, threads])

  async function selectThread(thread: MessageThread) {
    const cid = cIdRef.current
    const eid = eIdRef.current
    if (!cid || !eid) return

    setUnreadThreadIds(prev => {
      const next = new Set(prev)
      next.delete(thread.id)
      return next
    })
    setSelected(thread)
    setMsgLoading(true)
    const supabase = createClient()
    const tok = tokRef.current
    const isFeed = (thread.type_raw ?? '').toLowerCase() === 'company_feed'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)

    const [msgRes] = await Promise.all([
      isFeed
        ? rpc('employee_get_company_messages_for_worker', {
            p_company_id: cid,
            p_employee_id: eid,
            p_limit: 120,
            p_session_token: tok,
          })
        : rpc('employee_get_thread_messages_for_worker', {
            p_company_id: cid,
            p_thread_id: thread.id,
            p_employee_id: eid,
            p_limit: 200,
            p_session_token: tok,
          }),
      isFeed
        ? rpc('employee_mark_company_feed_read_for_worker', {
            p_company_id: cid,
            p_employee_id: eid,
            p_session_token: tok,
          })
        : rpc('employee_mark_thread_read_for_worker', {
            p_company_id: cid,
            p_thread_id: thread.id,
            p_employee_id: eid,
            p_session_token: tok,
          }),
    ])

    setMessages(chronologicalMessages((msgRes.data ?? []) as AppMessage[]))
    setMsgLoading(false)
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
  }

  async function reloadMessages() {
    const thread = selectedRef.current
    const cid = cIdRef.current
    const eid = eIdRef.current
    if (!thread || !cid || !eid) return
    const supabase = createClient()
    const isFeed = (thread.type_raw ?? '').toLowerCase() === 'company_feed'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)(
      isFeed ? 'employee_get_company_messages_for_worker' : 'employee_get_thread_messages_for_worker',
      isFeed
        ? {
            p_company_id: cid,
            p_employee_id: eid,
            p_limit: 120,
            p_session_token: tokRef.current,
          }
        : {
            p_company_id: cid,
            p_thread_id: thread.id,
            p_employee_id: eid,
            p_limit: 200,
            p_session_token: tokRef.current,
          },
    )
    setMessages(chronologicalMessages((data ?? []) as AppMessage[]))
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    const channel = supabase
      .channel('messages-rt')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'app_messages',
        filter: `company_id=eq.${companyId}`,
      }, () => {
        if (cIdRef.current && eIdRef.current) {
          void (async () => {
            const list = await loadThreads(cIdRef.current!, eIdRef.current!)
            await loadUnreadThreadIds(cIdRef.current!, eIdRef.current!, list)
            await reloadMessages()
          })()
        }
      })
      .subscribe()

    const onFocus = () => {
      if (cIdRef.current && eIdRef.current) {
        void (async () => {
          const list = await loadThreads(cIdRef.current!, eIdRef.current!)
          await loadUnreadThreadIds(cIdRef.current!, eIdRef.current!, list)
        })()
      }
    }
    window.addEventListener('focus', onFocus)

    return () => {
      void supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function sendMessage() {
    const body = msgText.trim()
    if (!body || !selected || !companyId || !employeeId) return
    setSending(true)
    const supabase = createClient()
    const isFeed = (selected.type_raw ?? '').toLowerCase() === 'company_feed'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)(
      isFeed ? 'employee_send_company_feed_message' : 'employee_send_thread_message',
      isFeed
        ? {
            p_company_id: companyId,
            p_sender_employee_id: employeeId,
            p_body: body,
            p_session_token: tokRef.current,
          }
        : {
            p_company_id: companyId,
            p_thread_id: selected.id,
            p_sender_employee_id: employeeId,
            p_body: body,
            p_session_token: tokRef.current,
          },
    )
    setMsgText('')
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')
    if (textarea) textarea.style.height = 'auto'
    await Promise.all([reloadMessages(), loadThreads(companyId, employeeId)])
    setSending(false)
  }

  async function startDM(peer: EmpPick) {
    if (!companyId || !employeeId) return
    setShowNew(false)
    setEmpSearch('')
    const peerName = `${peer.name} ${peer.surname}`
    const supabase = createClient()
    const dmTok = tokRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: result } = await (supabase.rpc as any)('employee_get_or_create_direct_thread_peer', {
      p_company_id: companyId,
      p_creator_id: employeeId,
      p_peer_id: peer.id,
      p_title: `${myName} & ${peerName}`,
      p_session_token: dmTok,
    })
    const threadId = parseUuidRpcResult(result)
    if (!threadId) return

    const refreshed = await loadThreads(companyId, employeeId)
    setActiveTab('direct')
    const fullThread = refreshed.find(t => t.id === threadId)
    if (fullThread) await selectThread(fullThread)
  }

  const filteredEmps = employees.filter(e =>
    `${e.name} ${e.surname}`.toLowerCase().includes(empSearch.toLowerCase()),
  )

  const filteredThreads = threads.filter(t => threadMatchesTab(t, activeTab))

  if (notLinked) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <span className="material-icons text-[48px] text-text-disabled">person_off</span>
          <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
          <p className="text-[13px] text-text-secondary">Contact your administrator.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex overflow-hidden">
      <div className={`flex flex-col border-r border-divider shrink-0 bg-surface w-[280px] ${selected ? 'hidden sm:flex' : 'flex w-full sm:w-[280px]'}`}>
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

        <div className="flex border-b border-divider shrink-0">
          {(['direct', 'feed', 'teams'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-[12px] font-semibold capitalize transition-colors ${
                activeTab === tab
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab === 'direct' ? 'Direct' : tab === 'feed' ? 'Feed' : 'Teams'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
          ) : filteredThreads.length === 0 ? (
            <div className="py-16 text-center px-4">
              <span className="material-icons text-[44px] text-text-disabled block mb-2">chat_bubble_outline</span>
              <p className="text-[13px] text-text-secondary">
                {activeTab === 'feed' ? 'Company feed is empty' : 'No conversations yet'}
              </p>
              {activeTab === 'direct' && (
                <button onClick={() => setShowNew(true)} className="mt-2 text-primary text-[12px] hover:underline">
                  Start a conversation
                </button>
              )}
            </div>
          ) : filteredThreads.map(t => {
            const isActive = selected?.id === t.id
            const isUnread = unreadThreadIds.has(t.id) && !isActive
            const title = displayThreadSubject(t, jobTitles)
            return (
              <button
                key={t.id}
                onClick={() => void selectThread(t)}
                className={`w-full text-left px-4 py-3 border-b border-divider transition-colors hover:bg-background ${
                  isActive ? 'bg-primary/5 border-l-[3px] border-l-primary' : ''
                }`}
              >
                <div className="flex justify-between items-start gap-2 mb-0.5">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {isUnread && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                    <p className={`text-[13px] truncate flex-1 ${
                      isUnread ? 'font-bold text-text-primary' : 'font-semibold text-text-primary'
                    }`}>
                      {title}
                    </p>
                  </div>
                  <p className="text-[10px] text-text-disabled shrink-0 mt-0.5">{fmtTime(t.last_message_at)}</p>
                </div>
                {t.last_message_preview && (
                  <p className={`text-[12px] truncate ${isUnread ? 'text-text-primary' : 'text-text-secondary'}`}>
                    {t.last_message_preview}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      </div>

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
            <div className="flex items-center gap-3 px-4 py-3 border-b border-divider bg-surface shrink-0">
              <button
                onClick={() => setSelected(null)}
                className="sm:hidden text-text-secondary hover:text-text-primary transition-colors"
              >
                <span className="material-icons text-[20px]">arrow_back</span>
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-text-primary truncate">
                  {displayThreadSubject(selected, jobTitles)}
                </p>
                {selected.type_raw && selected.type_raw !== 'direct' && (
                  <p className="text-[11px] text-text-disabled capitalize">
                    {selected.type_raw.replace(/_/g, ' ')}
                  </p>
                )}
              </div>
            </div>

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

            <div className="shrink-0 px-4 py-3 border-t border-divider bg-surface flex items-end gap-2">
              <textarea
                value={msgText}
                onChange={e => {
                  setMsgText(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 112)}px`
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() }
                }}
                placeholder="Type a message…"
                rows={1}
                style={{ height: 'auto', minHeight: '40px', maxHeight: '112px' }}
                className="flex-1 resize-none bg-background border border-border rounded-xl px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 overflow-y-auto"
              />
              <button
                onClick={() => void sendMessage()}
                disabled={!msgText.trim() || sending}
                className="h-10 w-10 rounded-xl bg-primary text-white flex items-center justify-center disabled:opacity-40 hover:bg-primary-dark transition-colors shrink-0"
              >
                <span className="material-icons text-[18px]">send</span>
              </button>
            </div>
          </>
        )}
      </div>

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
                    onClick={() => void startDM(e)}
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
