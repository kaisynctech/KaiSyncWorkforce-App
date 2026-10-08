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
        onClick={() => setOpen(true)}
        className="block max-w-[180px] truncate text-left text-text-secondary hover:text-primary hover:underline"
        aria-label="View attendance note"
      >
        {text}
      </button>
      <ModalShell open={open} onClose={() => setOpen(false)} title="Attendance note" size="sm">
        {context ? (
          <p className="text-[12px] text-text-secondary mb-2">{context}</p>
        ) : null}
        <p className="text-[13px] text-text-primary whitespace-pre-wrap break-words">{text}</p>
      </ModalShell>
    </>
  )
}
