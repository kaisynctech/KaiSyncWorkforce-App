/**
 * A company's document colours, picked from its logo: an accent (the logo's most colourful shade) and a dark
 * (its darkest strong shade, for headings and the total). Used on the quotation and pro forma (PDF and preview).
 * Without a logo, or when the logo has no clear colours, KaiSync blue and slate are used.
 */

export type BrandColours = { accent: string; dark: string; accentSoft: string; accentText: string }

export const DEFAULT_BRAND: BrandColours = { accent: '#2563EB', dark: '#1E293B', accentSoft: '#EFF6FF', accentText: '#1D4ED8' }

type RGB = [number, number, number]

const hex = ([r, g, b]: RGB) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase()

function hsl([r, g, b]: RGB): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  h /= 6
  return { h, s, l }
}

function luminance([r, g, b]: RGB): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrastOnWhite = (c: RGB) => 1.05 / (luminance(c) + 0.05)

/** Mix a colour with white (t = share of white). */
const tint = (c: RGB, t: number): RGB => [c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t]
/** Darken until it reads as text on white (4.5:1). */
function readable(c: RGB): RGB {
  let x: RGB = [...c] as RGB
  for (let i = 0; i < 12 && contrastOnWhite(x) < 4.5; i++) x = [x[0] * 0.88, x[1] * 0.88, x[2] * 0.88]
  return x
}

export function brandFromPixels(data: Uint8ClampedArray): BrandColours {
  // Bucket the visible pixels (5 bits a channel) and count them.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (r > 235 && g > 235 && b > 235) continue // white background
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }
    e.n++; e.r += r; e.g += g; e.b += b
    buckets.set(k, e)
  }
  const all = [...buckets.values()].map(e => ({ n: e.n, c: [e.r / e.n, e.g / e.n, e.b / e.n] as RGB }))
  const total = all.reduce((s, e) => s + e.n, 0)
  if (!total) return DEFAULT_BRAND
  const enough = all.filter(e => e.n / total > 0.01)
  // Accent: the most-used colourful shade (not grey, not near-black, not near-white).
  const colourful = enough.filter(e => { const x = hsl(e.c); return x.s > 0.35 && x.l > 0.18 && x.l < 0.82 })
    .sort((a, b) => b.n * hsl(b.c).s - a.n * hsl(a.c).s)
  // Dark: the most-used dark shade.
  const darks = enough.filter(e => hsl(e.c).l < 0.32).sort((a, b) => b.n - a.n)
  const accentRaw = colourful[0]?.c ?? null
  const darkRaw = darks[0]?.c ?? null
  if (!accentRaw && !darkRaw) return DEFAULT_BRAND
  const accent = readable(accentRaw ?? darkRaw!)
  const dark = darkRaw && contrastOnWhite(darkRaw) >= 7 ? darkRaw : ([30, 41, 59] as RGB)
  return { accent: hex(accent), dark: hex(dark), accentSoft: hex(tint(accent, 0.9)), accentText: hex(readable(accent)) }
}

/** Reads a logo (data URL) in the browser and picks its colours. Never throws. */
export async function brandFromLogo(dataUrl: string | null | undefined): Promise<BrandColours> {
  if (!dataUrl || typeof document === 'undefined') return DEFAULT_BRAND
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = dataUrl
    })
    const w = Math.min(160, img.naturalWidth || 160)
    const h = Math.max(1, Math.round((img.naturalHeight / (img.naturalWidth || 1)) * w))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return DEFAULT_BRAND
    ctx.drawImage(img, 0, 0, w, h)
    return brandFromPixels(ctx.getImageData(0, 0, w, h).data)
  } catch {
    return DEFAULT_BRAND
  }
}

export function rgbOf(h: string): RGB {
  const x = h.replace('#', '')
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]
}
