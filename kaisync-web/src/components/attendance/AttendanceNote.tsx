'use client'

import { useState } from 'react'
import { ModalShell } from '@/components/ui/ModalShell'

/** Truncated attendance note that opens the full text. */
export function AttendanceNote({
  note,
  context,
}: {
  note: string
  context?: string
}) {
  const [open, setOpen] = useState(false)
  const text = note.trim()
  if (!text) return <span className="text-text-disabled">—</span>

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        title={text}
        className="inline-flex max-w-[220px] items-center gap-1 text-left text-primary underline cursor-pointer"
        aria-label="View attendance note"
      >
        <span className="truncate">{text}</span>
        <span className="material-icons text-[14px] shrink-0">open_in_full</span>
      </button>
      <ModalShell open={open} onClose={() => setOpen(false)} title="Attendance note" size="sm">
        {context ? (
          <p className="text-[12px] text-text-secondary mb-2">{context}</p>
        ) : null}
        <p className="text-[13px] text-text-primary whitespace-pre-wrap break-words select-text">{text}</p>
      </ModalShell>
    </>
  )
}
