'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Sign with a finger (or mouse). Gives a small PNG (data URL) through onChange, or null when cleared / empty.
 * Phone first: a wide box, thick line, no scrolling while signing.
 */
export function SignaturePad({ onChange, label = 'Sign here', height = 160 }: {
  onChange: (png: string | null) => void
  label?: string
  height?: number
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    const w = c.clientWidth
    c.width = Math.round(w * ratio)
    c.height = Math.round(height * ratio)
    const ctx = c.getContext('2d')
    if (ctx) { ctx.scale(ratio, ratio); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0F172A' }
  }, [height])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = pos(e)
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return
    const ctx = e.currentTarget.getContext('2d')
    const p = pos(e)
    if (ctx) { ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke() }
    last.current = p
    if (empty) setEmpty(false)
  }
  function up() {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    if (!empty && canvas.current) onChange(canvas.current.toDataURL('image/png'))
  }
  function clear() {
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height)
    setEmpty(true)
    onChange(null)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative rounded-xl border-2 border-dashed border-slate-300 bg-white">
        <canvas ref={canvas} aria-label={label} role="img"
          className="block w-full touch-none rounded-xl" style={{ height }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
        {empty && <span className="pointer-events-none absolute left-3 bottom-2 text-[12px] text-slate-500">{label}</span>}
      </div>
      <button type="button" onClick={clear} disabled={empty} className="self-end h-9 px-3 text-[13px] text-slate-600 disabled:opacity-40">Clear</button>
    </div>
  )
}
