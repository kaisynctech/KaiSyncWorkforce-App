/**
 * World currencies for the pickers, from the browser's own currency data (ISO 4217), with English names.
 * Falls back to a short list if the browser can't list them.
 */

export type CurrencyOption = { code: string; name: string }

const FALLBACK = ['ZAR', 'USD', 'EUR', 'GBP', 'BWP', 'NAD', 'LSL', 'SZL', 'MZN', 'ZMW', 'ZWL', 'KES', 'NGN', 'GHS', 'MUR', 'AUD', 'NZD', 'CAD', 'CHF', 'CNY', 'JPY', 'INR', 'AED', 'SAR']

let cache: CurrencyOption[] | null = null

export function currencyOptions(): CurrencyOption[] {
  if (cache) return cache
  let codes: string[] = FALLBACK
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency')
    if (list && list.length > 50) codes = list
  } catch { /* old browser */ }
  let names: Intl.DisplayNames | null = null
  try { names = new Intl.DisplayNames(['en'], { type: 'currency' }) } catch { /* old browser */ }
  const all = codes.map(code => ({ code, name: names?.of(code) ?? code }))
    // Hide historic and fund codes Intl still knows (their names say "(1960–2005)", "fund", etc.).
    .filter(c => !/\(\d{4}|fund|unit|special drawing|test|gold|silver|platinum|palladium|transactions/i.test(c.name))
  const first = ['ZAR', 'USD', 'EUR', 'GBP', 'BWP', 'NAD']
  cache = [
    ...first.map(c => all.find(a => a.code === c) ?? { code: c, name: c }),
    ...all.filter(a => !first.includes(a.code)).sort((a, b) => a.name.localeCompare(b.name)),
  ]
  return cache
}

export function currencyName(code: string | null | undefined): string {
  if (!code) return ''
  return currencyOptions().find(c => c.code === code.toUpperCase())?.name ?? code.toUpperCase()
}

/** Narrow currency glyph for inputs/labels: "R", "$", "€", "£". Falls back to the ISO code. */
export function currencySymbol(code: string | null | undefined): string {
  const c = (code || 'ZAR').toUpperCase()
  if (c === 'ZAR') return 'R'
  try {
    const sample = new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: c,
      currencyDisplay: 'narrowSymbol',
    }).format(0)
    return sample.replace(/[\d\s.,\u00a0]/g, '').trim() || c
  } catch {
    return c
  }
}

/**
 * Money for screens / PDFs / portals.
 * Rand stays KaiSync's usual "R 1 250,00".
 * Other currencies use the narrow symbol ("$500,00", "€500,00") — not the code ("USD 500,00").
 */
export function formatCurrency(n: number | null | undefined, currency?: string | null): string {
  const code = (currency || 'ZAR').toUpperCase()
  if (code === 'ZAR') {
    if (n == null) return 'R —'
    return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  if (n == null) return `${currencySymbol(code)} —`
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${code} ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
}
