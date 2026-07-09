'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type ChatMessage = {
  id: string
  body: string
  sender_id: string
  senderName: string
  timeDisplay: string
  isOwn: boolean
}

function mapMessage(raw: Record<string, unknown>, currentUserId: string): ChatMessage {
  const createdAt = raw.created_at as string
  const time = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(createdAt)
  )
  const emp = raw.employees as { name?: string; surname?: string } | null
  return {
    id: raw.id as string,
    body: raw.body as string,
    sender_id: raw.sender_id as string,
    senderName: emp ? `${emp.name ?? ''} ${emp.surname ?? ''}`.trim() : 'Unknown',
    timeDisplay: time,
    isOwn: raw.sender_id === currentUserId,
  }
}

export default function JobChatPage() {
  const params = useParams<{ id: string }>()
  const jobId = params.id
  const listRef = useRef<HTMLDivElement>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    let channelRef: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setCurrentUserId(user.id)

      const { data } = await supabase
        .from('job_messages')
        .select('*, employees(name, surname)')
        .eq('job_id', jobId)
        .order('created_at')

      const mapped = (data ?? []).map((m: Record<string, unknown>) => mapMessage(m, user.id))
      setMessages(mapped)
      setLoading(false)

      // Scroll to bottom on load (no animation)
      setTimeout(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
      }, 50)

      channelRef = supabase
        .channel(`job-chat-${jobId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'job_messages', filter: `job_id=eq.${jobId}` },
          payload => {
            const msg = mapMessage(payload.new as Record<string, unknown>, user.id)
            setMessages(prev => [...prev, msg])
          }
        )
        .subscribe()
    }

    init()

    return () => {
      if (channelRef) supabase.removeChannel(channelRef)
    }
  }, [jobId])

  // Smooth scroll on new messages
  useEffect(() => {
    if (!loading && messages.length > 0) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, loading])

  async function send() {
    if (!newMessage.trim() || !currentUserId) return
    const text = newMessage
    setNewMessage('')
    const supabase = createClient()
    try {
      await supabase.from('job_messages').insert({
        job_id: jobId,
        body: text,
        sender_id: currentUserId,
      })
    } catch {
      setNewMessage(text)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-divider shrink-0 bg-surface">
        <Link href={`/dashboard/jobs/${jobId}`} className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[16px] font-semibold text-text-primary">Job Chat</h1>
      </div>

      {/* Message list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {loading && (
          <div className="flex justify-center py-8">
            <span className="text-text-secondary text-[13px]">Loading messages…</span>
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
            <span className="material-icons text-[40px] text-text-disabled">chat_bubble_outline</span>
            <p className="text-text-secondary text-[13px]">No messages yet.</p>
            <p className="text-text-secondary text-[12px] text-center max-w-[260px]">
              Messages sent here are visible to crew assigned to this job.
            </p>
          </div>
        )}
        {messages.map(msg =>
          msg.isOwn ? (
            <div key={msg.id} className="flex justify-end">
              <div className="bg-primary rounded-2xl px-3 py-2 max-w-[280px] space-y-0.5">
                <p className="text-white text-[14px]">{msg.body}</p>
                <p className="text-[11px] text-right" style={{ color: '#E8E8FF' }}>{msg.timeDisplay}</p>
              </div>
            </div>
          ) : (
            <div key={msg.id} className="flex flex-col items-start max-w-[280px] gap-0.5">
              <p className="text-primary text-[12px] font-semibold">{msg.senderName}</p>
              <div className="bg-surface-elevated rounded-2xl px-3 py-2 space-y-0.5">
                <p className="text-text-primary text-[14px]">{msg.body}</p>
                <p className="text-text-secondary text-[11px] text-right">{msg.timeDisplay}</p>
              </div>
            </div>
          )
        )}
      </div>

      {/* Input bar */}
      <div className="bg-surface-elevated border-t border-divider px-3 py-2 shrink-0">
        <div className="flex gap-2 items-center">
          <input
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            placeholder="Type a message…"
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-disabled text-[14px] outline-none"
          />
          <button
            onClick={send}
            disabled={!newMessage.trim()}
            className="bg-primary text-white rounded-2xl px-4 py-2 text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
