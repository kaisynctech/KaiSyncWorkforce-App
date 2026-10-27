/**
 * Company branding: the logo (public `company-branding` bucket, path in companies.brand_logo_path)
 * and the company name, shown on the dashboards, the portals and documents.
 * The old private logo (companies.logo_url in workforce-media) is copied to the public bucket the
 * first time an HR user of that company opens the dashboard or settings.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const BRANDING_BUCKET = 'company-branding'

export type CompanyBrand = { name: string; logoUrl: string | null }

/** Public link for a logo path (no signing; logos are meant to be seen). */
export function brandLogoUrl(supabase: SupabaseClient, path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl || null
}

/** Two letters for the fallback badge: "Winterstech Air" → "WA", "Ironvale" → "IR". */
export function brandInitials(name: string | null | undefined): string {
  const words = (name ?? '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(w => /[a-z0-9]/i.test(w))
  if (words.length === 0) return 'K'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** A steady colour per company name for the fallback badge. */
export function brandColour(name: string | null | undefined): string {
  const palette = ['#2563EB', '#7C3AED', '#0D9488', '#DB2777', '#EA580C', '#16A34A', '#0891B2', '#9333EA']
  let h = 0
  for (const ch of name ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return palette[h % palette.length]
}

// ── Lookup by company code (portals, code sign-in) ─────────────────────────────

const cache = new Map<string, Promise<{ name: string; logo_path: string | null } | null>>()

export function brandByCode(supabase: SupabaseClient, code: string | null | undefined) {
  const key = (code ?? '').trim().toUpperCase()
  if (!key) return Promise.resolve(null)
  if (!cache.has(key)) {
    const p = (async () => {
      const { data, error } = await supabase.rpc('company_brand_by_code', { p_company_code: key })
      if (error || !data) return null
      const row = data as { name?: string; logo_path?: string | null }
      return { name: row.name ?? '', logo_path: row.logo_path ?? null }
    })()
    cache.set(key, p)
    p.then(v => { if (!v) cache.delete(key) }, () => cache.delete(key))
  }
  return cache.get(key)!
}

export function forgetBrand(code: string | null | undefined) {
  cache.delete((code ?? '').trim().toUpperCase())
}

// ── Preparing and saving the logo ──────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That image could not be read. Use a PNG, JPEG or WebP file.'))
    img.src = src
  })
}

/**
 * Trims empty (white or see-through) borders and scales the logo to at most 800×400,
 * keeping transparency. Returns a PNG that is sharp on screen and in PDFs but small.
 */
export async function prepareLogo(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('That image is empty.')
    // Very large pictures are scaled down first so trimming stays quick on phones.
    const s0 = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * s0)), h = Math.max(1, Math.round(img.naturalHeight * s0))
    const probe = document.createElement('canvas')
    probe.width = w; probe.height = h
    const pc = probe.getContext('2d', { willReadFrequently: true })!
    pc.drawImage(img, 0, 0, w, h)
    const px = pc.getImageData(0, 0, w, h).data
    const blank = (i: number) => px[i + 3] < 16 || (px[i] > 245 && px[i + 1] > 245 && px[i + 2] > 245)
    let top = h, left = w, right = -1, bottom = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!blank((y * w + x) * 4)) {
          if (x < left) left = x
          if (x > right) right = x
          if (y < top) top = y
          if (y > bottom) bottom = y
        }
      }
    }
    if (right < 0) { left = 0; top = 0; right = w - 1; bottom = h - 1 }
    const pad = Math.round(Math.max(right - left, bottom - top) * 0.04)
    left = Math.max(0, left - pad); top = Math.max(0, top - pad)
    right = Math.min(w - 1, right + pad); bottom = Math.min(h - 1, bottom + pad)
    const cw = right - left + 1, ch = bottom - top + 1
    const scale = Math.min(1, 800 / cw, 400 / ch)
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(cw * scale)); out.height = Math.max(1, Math.round(ch * scale))
    const oc = out.getContext('2d')!
    oc.imageSmoothingQuality = 'high'
    oc.drawImage(probe, left, top, cw, ch, 0, 0, out.width, out.height)
    return await new Promise<Blob>((resolve, reject) =>
      out.toBlob(b => (b ? resolve(b) : reject(new Error('Could not prepare the logo.'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export type Result<T> = { ok: true; data: T } | { ok: false; message: string }

function friendly(message: string): string {
  if (/UNAUTHORIZED|row-level security|permission/i.test(message)) return 'Only HR or the owner can change the logo.'
  return message
}

/** Uploads a prepared logo under a new name (so every screen picks up the change) and makes it the company logo. */
export async function saveBrandLogo(supabase: SupabaseClient, companyId: string, png: Blob): Promise<Result<string>> {
  const path = `${companyId}/logo-${Date.now()}.png`
  const { error: upErr } = await supabase.storage.from(BRANDING_BUCKET).upload(path, png, { contentType: 'image/png', cacheControl: '31536000', upsert: false })
  if (upErr) return { ok: false, message: friendly(upErr.message) }
  const { error } = await supabase.rpc('set_company_brand_logo', { p_company_id: companyId, p_path: path })
  if (error) return { ok: false, message: friendly(error.message) }
  return { ok: true, data: path }
}

export async function clearBrandLogo(supabase: SupabaseClient, companyId: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('set_company_brand_logo', { p_company_id: companyId, p_path: null })
  return error ? { ok: false, message: friendly(error.message) } : { ok: true, data: undefined }
}

const migrating = new Map<string, Promise<string | null>>()

/**
 * One-off: a company that uploaded its logo before the public bucket existed has it only in the
 * private bucket. HR users copy it across (trimmed and resized) the first time they load a page.
 * Every screen asking at the same time (top bar, settings) gets the same copied path.
 * Quietly does nothing for everyone else or when there is nothing to copy.
 */
export function copyOldLogoIfNeeded(
  supabase: SupabaseClient,
  company: { id: string; logo_url?: string | null; brand_logo_path?: string | null },
): Promise<string | null> {
  if (company.brand_logo_path || !company.logo_url) return Promise.resolve(null)
  const running = migrating.get(company.id)
  if (running) return running
  const p = (async () => {
    try {
      // Another device may already have copied it: use that instead of copying again.
      const { data: row } = await supabase.from('companies').select('brand_logo_path').eq('id', company.id).maybeSingle()
      const existing = (row as { brand_logo_path?: string | null } | null)?.brand_logo_path
      if (existing) return existing
      const { data: signed } = await supabase.storage.from('workforce-media').createSignedUrl(company.logo_url!, 120)
      if (!signed?.signedUrl) return null
      const blob = await (await fetch(signed.signedUrl)).blob()
      const png = await prepareLogo(blob)
      const res = await saveBrandLogo(supabase, company.id, png)
      return res.ok ? res.data : null
    } catch {
      return null
    }
  })()
  migrating.set(company.id, p)
  return p
}
