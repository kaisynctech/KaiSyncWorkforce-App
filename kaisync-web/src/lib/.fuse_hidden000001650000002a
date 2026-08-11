/** Mirrors MAUI EmployeeThreadChatViewModel + MessageThreadDisplay heuristics. */

export type MessageThreadLike = {
  id: string
  subject: string | null
  participant_ids: string[] | null
  type_raw: string | null
  is_archived?: boolean | null
  last_message_at?: string | null
  last_message_preview?: string | null
}

export type MessageTab = 'direct' | 'feed' | 'teams'

export function isCompanyFeed(thread: MessageThreadLike): boolean {
  return (thread.type_raw ?? '').toLowerCase() === 'company_feed'
}

/** MAUI Teams filter: Job: subject OR >2 participants (and not feed). */
export function isTeamsThread(thread: MessageThreadLike): boolean {
  if (isCompanyFeed(thread)) return false
  const subject = thread.subject ?? ''
  if (subject.toLowerCase().startsWith('job:')) return true
  return (thread.participant_ids?.length ?? 0) > 2
}

export function isDirectThread(thread: MessageThreadLike): boolean {
  return !isCompanyFeed(thread) && !isTeamsThread(thread)
}

export function threadMatchesTab(thread: MessageThreadLike, tab: MessageTab): boolean {
  if (tab === 'feed') return isCompanyFeed(thread)
  if (tab === 'teams') return isTeamsThread(thread)
  return isDirectThread(thread)
}

export function tabForThread(thread: MessageThreadLike): MessageTab {
  if (isCompanyFeed(thread)) return 'feed'
  if (isTeamsThread(thread)) return 'teams'
  return 'direct'
}

export function parseJobIdFromSubject(subject: string | null | undefined): string | null {
  if (!subject) return null
  const m = subject.match(/^Job:(.+)$/i)
  if (!m?.[1]) return null
  const id = m[1].trim()
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

export function parseDealIdFromSubject(subject: string | null | undefined): string | null {
  if (!subject) return null
  const m = subject.match(/^Deal:(.+)$/i)
  if (!m?.[1]) return null
  const id = m[1].trim()
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

/** Display title when job/deal name maps are unavailable. */
export function displayThreadSubject(
  thread: MessageThreadLike,
  jobTitles?: Record<string, string>,
): string {
  if (isCompanyFeed(thread)) return 'Company Feed'
  const subject = thread.subject?.trim()
  if (!subject) return 'Untitled'

  const jobId = parseJobIdFromSubject(subject)
  if (jobId) {
    const title = jobTitles?.[jobId]
    return title ? `Job: ${title}` : 'Job team'
  }
  if (parseDealIdFromSubject(subject)) return 'Project chat'
  return subject
}

/** employee_get_or_create_direct_thread_peer returns uuid (not { id }). */
export function parseUuidRpcResult(data: unknown): string | null {
  if (typeof data === 'string' && data.length > 0) return data
  if (data && typeof data === 'object' && 'id' in data) {
    const id = (data as { id: unknown }).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return null
}

/** Worker message RPCs return newest-first; UI needs chronological ASC. */
export function chronologicalMessages<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
}

export function mergeFeedThread<T extends MessageThreadLike>(
  threads: T[],
  feed: T | null | undefined,
): T[] {
  if (!feed) return threads
  const without = threads.filter(t => t.id !== feed.id)
  return [feed, ...without]
}
