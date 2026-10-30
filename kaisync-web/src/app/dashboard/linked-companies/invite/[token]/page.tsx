'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { SearchPicker } from '@/components/SearchPicker'
import {
  acceptInvite, myRecordNoun, myUnlinkedRecords, previewInvite, type InvitePreview, type LinkRole,
} from '@/lib/company-links'

const STATE_WORDS: Record<Exclude<InvitePreview['state'], 'open'>, string> = {
  used: 'This invite has already been used.',
  expired: 'This invite has expired. Ask the other company for a new one.',
  cancelled: 'This invite was cancelled.',
  own: 'This invite was made by your own company. Send it to the other company instead.',
}

export default function LinkInvitePage() {
  const params = useParams<{ token: string }>()
  const token = decodeURIComponent(params.token ?? '')
  const router = useRouter()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [records, setRecords] = useState<{ id: string; name: string }[]>([])
  const [chosen, setChosen] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // The inviter's role is the opposite of mine: their client record means I am their contractor.
  const myRole: LinkRole | null = preview ? (preview.inviter_role === 'provider' ? 'customer' : 'provider') : null

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('Your account is not linked to a company.'); setLoading(false); return }
      setCompanyId(member.companyId)
      const res = await previewInvite(supabase, member.companyId, token)
      if (!res.ok) { setError(res.message); setLoading(false); return }
      setPreview(res.data)
      if (res.data.state === 'open') {
        const mine: LinkRole = res.data.inviter_role === 'provider' ? 'customer' : 'provider'
        const recs = await myUnlinkedRecords(supabase, member.companyId, mine)
        if (recs.ok) setRecords(recs.data)
      }
      setLoading(false)
    })()
  }, [token])

  async function accept() {
    if (!companyId) return
    setBusy(true)
    setError(null)
    const res = await acceptInvite(createClient(), companyId, token, chosen || null)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    router.push('/dashboard/linked-companies')
  }

  const noun = myRole ? myRecordNoun(myRole) : 'record'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center px-4 py-3 shrink-0 bg-surface border-b border-divider">
        <h1 className="text-[18px] font-semibold text-text-primary">Link invite</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-4 text-[13px]">
        <div className="max-w-xl bg-surface border border-divider rounded-lg p-4 space-y-3">
          {loading ? (
            <p className="text-text-secondary">Loading…</p>
          ) : preview ? (
            <>
              <p className="font-semibold text-[15px] text-text-primary">{preview.inviter.name}</p>
              {preview.inviter.legal_name && preview.inviter.legal_name !== preview.inviter.name && (
                <p className="text-text-secondary">{preview.inviter.legal_name}</p>
              )}
              {preview.state !== 'open' ? (
                <p className="text-text-secondary">{STATE_WORDS[preview.state]}</p>
              ) : (
                <>
                  <p className="text-text-secondary">
                    {preview.inviter.name} wants to link with your company on KaiSync. They will be your {noun}.
                    You then work together inside KaiSync, without portals or copies. Only the owner, HR or an admin can accept.
                  </p>
                  <SearchPicker
                    options={records.map(r => ({ id: r.id, label: r.name }))}
                    value={chosen}
                    onChange={setChosen}
                    label={`Your ${noun} record for them (optional)`}
                    noun={noun}
                  />
                  <p className="text-text-secondary text-[12px]">
                    Leave it empty to create a new {noun} called “{preview.inviter.name}”.
                  </p>
                  <div className="flex gap-2">
                    <button disabled={busy} onClick={() => void accept()} className="btn-primary h-9 px-3 text-[13px]">
                      {chosen ? 'Accept and link' : `Accept and create ${noun}`}
                    </button>
                    <Link href="/dashboard/linked-companies" className="btn-outlined h-9 px-3 text-[13px] inline-flex items-center">Not now</Link>
                  </div>
                  <p className="text-text-secondary text-[12px]">Invite valid until {new Date(preview.expires_at).toLocaleDateString()}.</p>
                </>
              )}
            </>
          ) : null}
          {error && <p className="text-error">{error}</p>}
        </div>
      </div>
    </div>
  )
}
