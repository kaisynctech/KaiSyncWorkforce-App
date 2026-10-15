'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ClientPortalShell } from '@/components/ClientPortalShell'
import { PortalTabs } from '@/components/PortalTabs'
import { useRequireClientPortalSession } from '@/lib/client-portal/use-session'
import { getJob, signPortalMedia } from '@/lib/client-portal/api'
import { fmtDate, fmtDateTime, projectStatusLabel } from '@/lib/client-portal/format'
import type { ClientJobVisit, ClientPortalJobDetail } from '@/lib/client-portal/types'

function partyLabel(raw: string): string {
  const key = raw.toLowerCase()
  if (key === 'contractor') return 'Contractor'
  if (key === 'employee') return 'Team'
  return projectStatusLabel(raw)
}

function visitPlace(visit: ClientJobVisit): string | null {
  return visit.sign_out_address || visit.sign_in_address || null
}

const JOB_TABS = [
  { id: 'details', label: 'Details' },
  { id: 'contractors', label: 'Contractors' },
  { id: 'progress', label: 'Progress' },
  { id: 'photos', label: 'Photos' },
  { id: 'documents', label: 'Documents' },
] as const
type JobTab = typeof JOB_TABS[number]['id']

export default function ClientPortalJobPage() {
  const { session, ready } = useRequireClientPortalSession()
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const jobId = params.id as string
  const fromProject = searchParams.get('from') === 'project'

  const [job, setJob] = useState<ClientPortalJobDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<JobTab>('details')
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!session || !jobId) return
    setError(null)
    try {
      const row = await getJob(session.company_code, session.client_code, jobId)
      setJob(row)
      if (!row) setError('This job is not available.')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load job.')
    }
    setLoading(false)
  }, [session, jobId])

  useEffect(() => {
    if (!session || !jobId) return
    setLoading(true)
    void load()
  }, [session, jobId, load])

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  useEffect(() => {
    if (!job) return
    const values = [
      ...job.photos_before,
      ...job.photos_after,
      ...job.photos,
      ...job.documents.map(doc => doc.file_url),
    ]
    let cancelled = false
    void signPortalMedia(values).then(signed => {
      if (!cancelled) setMediaUrls(signed)
    })
    return () => { cancelled = true }
  }, [job])

  function goBack() {
    if (fromProject && job?.deal_id) {
      router.push(`/client-portal/projects/${job.deal_id}`)
      return
    }
    router.push('/client-portal/home?tab=jobs')
  }

  const otherPhotos = (job?.photos ?? []).filter(
    url => !job?.photos_before.includes(url) && !job?.photos_after.includes(url),
  )
  const checked = job?.checklist.filter(item => item.is_checked).length ?? 0

  if (!ready || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-text-secondary text-[14px]">
        Loading…
      </div>
    )
  }

  return (
    <ClientPortalShell session={session}>
      <div className="px-4 py-4 md:px-6 md:py-5 space-y-4 pb-16">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            className="text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Back"
          >
            <span className="material-icons">arrow_back</span>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-text-primary text-[18px] font-bold truncate">{job?.title ?? 'Job'}</h1>
            {job?.job_code && <p className="text-[12px] text-text-secondary">{job.job_code}</p>}
          </div>
          <button
            type="button"
            onClick={() => { setLoading(true); void load() }}
            className="text-text-secondary hover:text-text-primary p-1.5"
            aria-label="Refresh"
            title="Refresh"
          >
            <span className="material-icons text-[20px]">refresh</span>
          </button>
        </div>

        {error && (
          <div className="bg-error/10 border border-error/25 rounded-xl px-4 py-3">
            <p className="text-[13px] text-error font-semibold">{error}</p>
          </div>
        )}

        {loading && !job ? (
          <div className="py-16 text-center text-text-secondary text-[14px]">Loading…</div>
        ) : !job ? (
          <div className="py-16 text-center space-y-3">
            <p className="text-text-secondary text-[14px]">Job not found.</p>
            <button type="button" onClick={goBack} className="text-primary text-[13px] hover:underline">Back</button>
          </div>
        ) : (
          <>
            <PortalTabs tabs={[...JOB_TABS]} tab={tab} onChange={setTab} />

            {tab === 'details' && (<>
            <Section title="Overview">
              <InfoRow label="Status" value={projectStatusLabel(job.status)} />
              {job.priority && <InfoRow label="Priority" value={projectStatusLabel(job.priority)} />}
              <InfoRow label="Opened" value={fmtDate(job.opened_at)} />
              <InfoRow label="Last change" value={fmtDateTime(job.updated_at)} />
              {job.closed_at && <InfoRow label="Closed" value={fmtDateTime(job.closed_at)} />}
              {job.description?.trim() && (
                <p className="text-[13px] text-text-primary mt-2 leading-relaxed whitespace-pre-wrap">{job.description}</p>
              )}
              {job.deal_id && job.project_title && (
                <Link href={`/client-portal/projects/${job.deal_id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline mt-2">
                  Project: {job.project_title}
                  {job.project_code ? ` · ${job.project_code}` : ''}
                </Link>
              )}
            </Section>

            <Section title="Where and when">
              {job.site_name && <InfoRow label="Site" value={job.site_name} />}
              {job.site_address && <InfoRow label="Site address" value={job.site_address} />}
              {job.address && <InfoRow label="Job address" value={job.address} />}
              {!job.site_name && !job.site_address && !job.address && (
                <p className="text-[13px] text-text-secondary">No address recorded yet.</p>
              )}
              <InfoRow label="Starts" value={fmtDateTime(job.scheduled_start)} />
              <InfoRow label="Ends" value={fmtDateTime(job.scheduled_end)} />
            </Section>
            </>)}

            {tab === 'contractors' && (
            <Section title="Contractors">
              {job.contractors.length === 0 ? (
                <p className="text-[13px] text-text-secondary">No contractor assigned yet.</p>
              ) : (
                <div className="space-y-3">
                  {job.contractors.map(person => (
                    <div key={`${person.name}-${person.assigned_at ?? ''}`} className="bg-surface-elevated rounded-lg px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[14px] font-semibold text-text-primary">{person.name}</p>
                        <p className="text-[12px] text-text-secondary whitespace-nowrap">{projectStatusLabel(person.status)}</p>
                      </div>
                      {person.role && <p className="text-[12px] text-text-secondary mt-0.5">{projectStatusLabel(person.role)}</p>}
                      {person.scope_notes && (
                        <p className="text-[13px] text-text-primary mt-1 whitespace-pre-wrap">{person.scope_notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>
            )}

            {tab === 'progress' && (<>
            <Section title={job.checklist.length > 0 ? `Checklist · ${checked} of ${job.checklist.length}` : 'Checklist'}>
              {job.checklist.length === 0 ? (
                <p className="text-[13px] text-text-secondary">No checklist on this job yet.</p>
              ) : (
                <div className="space-y-2">
                  {job.checklist.map(item => (
                    <div key={`${item.sort_order}-${item.description}`} className="flex items-start gap-2 text-[13px]">
                      <span className={`material-icons text-[18px] ${item.is_checked ? 'text-success' : 'text-text-secondary'}`}>
                        {item.is_checked ? 'check_box' : 'check_box_outline_blank'}
                      </span>
                      <p className={item.is_checked ? 'text-text-secondary line-through' : 'text-text-primary'}>{item.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Site visits">
              {job.visits.length === 0 ? (
                <p className="text-[13px] text-text-secondary">No one has signed in on this job yet. A contractor sign-in shows here.</p>
              ) : (
                <div className="space-y-2">
                  {job.visits.map((visit, index) => {
                    const place = visitPlace(visit)
                    return (
                      <div key={`${visit.sign_in_at}-${index}`} className="bg-surface-elevated rounded-lg px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[13px] font-semibold text-text-primary">
                            {visit.reported_by_name || partyLabel(visit.party_type)}
                          </p>
                          <p className="text-[12px] text-text-secondary whitespace-nowrap">
                            {visit.sign_out_at ? 'Signed out' : 'On site'}
                          </p>
                        </div>
                        <p className="text-[12px] text-text-secondary mt-0.5">
                          {fmtDateTime(visit.sign_in_at)}
                          {visit.sign_out_at ? ` → ${fmtDateTime(visit.sign_out_at)}` : ''}
                        </p>
                        {place && <p className="text-[12px] text-text-primary mt-1">{place}</p>}
                        {visit.notes && <p className="text-[13px] text-text-primary mt-1 whitespace-pre-wrap">{visit.notes}</p>}
                      </div>
                    )
                  })}
                </div>
              )}
            </Section>
            </>)}

            {tab === 'photos' && (
            <Section title="Photos">
              <PhotoGrid label="Before" urls={job.photos_before} mediaUrls={mediaUrls} />
              <PhotoGrid label="After" urls={job.photos_after} mediaUrls={mediaUrls} />
              {otherPhotos.length > 0 && <PhotoGrid label="Photos" urls={otherPhotos} mediaUrls={mediaUrls} />}
              <p className="text-[12px] text-text-secondary">Photos added by the contractor show here after you refresh.</p>
            </Section>
            )}

            {tab === 'documents' && (
            <Section title="Documents">
              {job.documents.length === 0 ? (
                <p className="text-[13px] text-text-secondary">No documents on this job yet.</p>
              ) : (
                <div className="space-y-2">
                  {job.documents.map(doc => (
                    <a
                      key={doc.id}
                      href={mediaUrls[doc.file_url] || doc.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 text-[13px] hover:bg-surface-elevated rounded-lg px-2 py-2"
                    >
                      <span className="text-text-primary font-semibold truncate">{doc.document_name}</span>
                      <span className="text-text-secondary whitespace-nowrap">{fmtDate(doc.created_at)}</span>
                    </a>
                  ))}
                </div>
              )}
            </Section>
            )}
          </>
        )}
      </div>
    </ClientPortalShell>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-divider bg-surface rounded-xl border overflow-hidden">
      <div className="border-divider px-4 py-2.5 border-b">
        <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{title}</p>
      </div>
      <div className="px-4 py-3 space-y-1.5">{children}</div>
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary text-right">{value}</span>
    </div>
  )
}

function PhotoGrid({ label, urls, mediaUrls }: { label: string; urls: string[]; mediaUrls: Record<string, string> }) {
  return (
    <div className="mb-2">
      <p className="text-[12px] font-semibold text-text-secondary mb-1.5">{label}</p>
      {urls.length === 0 ? (
        <p className="text-[12px] text-text-secondary">None yet</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {urls.map((url, i) => {
            const src = mediaUrls[url]
            return src ? (
              <a key={`${url}-${i}`} href={src} target="_blank" rel="noreferrer" className="border-divider rounded-lg overflow-hidden border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`${label} ${i + 1}`} className="w-full h-24 object-cover" />
              </a>
            ) : (
              <div key={`${url}-${i}`} className="border-divider rounded-lg border bg-surface-elevated h-24 flex items-center justify-center">
                <span className="material-icons text-text-secondary text-[18px]">image</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
