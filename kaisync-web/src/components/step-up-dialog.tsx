'use client'

import { useEffect, useRef, useState } from 'react'

type Props = {
  open: boolean
  busy?: boolean
  error?: string | null
  onCancel: () => void
  onVerify: (password: string) => void
}

/** Password re-entry modal for payroll (and other) step-up gates */
export function StepUpDialog({ open, busy, error, onCancel, onVerify }: Props) {
  const [password, setPassword] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setPassword('')
      queueMicrotask(() => inputRef.current?.focus())
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="step-up-title"
        className="w-full max-w-md rounded-xl bg-surface border border-border shadow-lg p-5 space-y-4"
      >
        <div>
          <h2 id="step-up-title" className="text-[16px] font-semibold text-text-primary">
            Security verification
          </h2>
          <p className="text-[13px] text-text-secondary mt-1">
            Re-enter your password to approve payments. This opens a 15-minute verification window.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="step-up-password" className="text-[12px] text-text-secondary font-medium">
            Password
          </label>
          <input
            ref={inputRef}
            id="step-up-password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && password.trim()) onVerify(password)
            }}
            className="dark-entry"
            placeholder="Your account password"
          />
        </div>

        {error && <p className="text-[13px] text-error font-medium">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="h-9 px-3 rounded-md text-[13px] border border-border text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !password.trim()}
            onClick={() => onVerify(password)}
            className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      </div>
    </div>
  )
}
