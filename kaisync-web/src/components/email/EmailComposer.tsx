'use client'

/**
 * Message / Preview for every "email this" dialog.
 * Message: the subject and the message, filled in with the standard wording and free to edit.
 * Preview: the email exactly as it will arrive (sender, To, CC, subject, logo, buttons, sign-off).
 * The greeting, amounts in attachments, the online button, item tables and the sign-off are added by
 * the server and can't be broken by editing.
 */

import { useEffect, useRef, useState } from 'react'
import { draftEdits, isEdited, type EmailDraft, type EmailPreview } from '@/lib/email-preview'

type Load = (edits: { subject?: string; body_text?: string }) => Promise<EmailPreview | { error: string }>

export function EmailComposer({ load, draft, onDraft, disabled, note }: {
  load: Load
  draft: EmailDraft | null
  onDraft: (d: EmailDraft) => void
  disabled?: boolean
  /** Shown above the preview, e.g. "Each supplier gets their own copy with their name." */
  note?: string
}) {
  const [tab, setTab] = useState<'message' | 'preview'>('message')
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<EmailPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const started = useRef(false)

  // Fill in the standard wording once.
  useEffect(() => {
    if (started.current || draft) return
    started.current = true
    void load({}).then(r => {
      if ('error' in r) { setErr(r.error); return }
      onDraft({ subject: r.subject, body: r.bodyText, defaultSubject: r.defaultSubject, defaultBody: r.bodyText })
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function showPreview() {
    setTab('preview'); setLoadingPreview(true); setErr(null)
    const r = await load(draftEdits(draft))
    setLoadingPreview(false)
    if ('error' in r) { setErr(r.error); setPreview(null) } else setPreview(r)
  }

  const tabCls = (on: boolean) => `h-8 px-3 rounded-lg text-[12.5px] font-medium ${on ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-surface-elevated'}`
  const field = 'rounded-xl border border-divider px-3 text-[14px] bg-background text-text-primary focus:outline-none focus:border-primary/60 disabled:opacity-60'

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1">
        <button type="button" className={tabCls(tab === 'message')} onClick={() => setTab('message')}>
          <span className="inline-flex items-center gap-1"><span className="material-icons text-[15px]">edit</span>Message</span>
        </button>
        <button type="button" className={tabCls(tab === 'preview')} disabled={!draft} onClick={() => void showPreview()}>
          <span className="inline-flex items-center gap-1"><span className="material-icons text-[15px]">visibility</span>Preview</span>
        </button>
        {isEdited(draft) && <span className="ml-auto text-[11.5px] text-amber-700">Edited</span>}
      </div>

      {err && <p className="text-[12px] text-error">{err}</p>}

      {tab === 'message' && (
        !draft ? (!err && <p className="text-[12.5px] text-text-secondary">Loading the email…</p>) : (
          <>
            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">Subject
              <input value={draft.subject} disabled={disabled} maxLength={200} onChange={e => onDraft({ ...draft, subject: e.target.value })} className={`${field} h-10`} />
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">Message
              <textarea rows={7} value={draft.body} disabled={disabled} maxLength={6000} onChange={e => onDraft({ ...draft, body: e.target.value })}
                className={`${field} py-2 resize-y leading-relaxed`} />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2 -mt-1">
              <span className="text-[11.5px] text-text-secondary">The greeting, buttons and your sign-off are added for you. Leave a blank line between paragraphs.</span>
              {isEdited(draft) && (
                <button type="button" disabled={disabled} onClick={() => onDraft({ ...draft, subject: draft.defaultSubject, body: draft.defaultBody })}
                  className="text-[12px] text-primary hover:underline">Use the standard wording</button>
              )}
            </div>
          </>
        )
      )}

      {tab === 'preview' && (
        loadingPreview ? <p className="text-[12.5px] text-text-secondary">Loading the preview…</p> : preview && (
          <div className="flex flex-col gap-2">
            {note && <p className="text-[12px] text-text-secondary">{note}</p>}
            <dl className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5 text-[12px] rounded-xl bg-surface-elevated px-3 py-2">
              <dt className="text-text-secondary">From</dt><dd className="text-text-primary break-all">{preview.from.replace(/"/g, '')}</dd>
              {preview.replyTo && <><dt className="text-text-secondary">Replies</dt><dd className="text-text-primary break-all">{preview.replyTo}</dd></>}
              <dt className="text-text-secondary">To</dt><dd className="text-text-primary break-all">{preview.to || '—'}</dd>
              {preview.cc.length > 0 && <><dt className="text-text-secondary">CC</dt><dd className="text-text-primary break-all">{preview.cc.join(', ')}</dd></>}
              <dt className="text-text-secondary">Subject</dt><dd className="text-text-primary font-medium">{preview.subject}</dd>
            </dl>
            {/* sandbox: no scripts, links don't open — it's only a picture of the email. */}
            <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="w-full h-[420px] rounded-xl border border-divider bg-white" />
            <button type="button" onClick={() => setTab('message')} className="self-start text-[12px] text-primary hover:underline">Back to edit</button>
          </div>
        )
      )}
    </div>
  )
}
