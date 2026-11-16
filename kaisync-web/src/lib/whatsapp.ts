/**
 * WhatsApp "click to chat" links: open WhatsApp on the phone (or WhatsApp Web) with the message ready to send.
 * Nothing is sent by KaiSync; the person taps Send in WhatsApp.
 */

/** A phone number as WhatsApp wants it: digits only, with the country code (South African 0XX → 27XX). */
export function waNumber(phone: string | null | undefined, countryCode = '27'): string | null {
  const raw = String(phone ?? '').trim()
  if (!raw) return null
  let d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = countryCode + d.slice(1)
  d = d.replace(/\D/g, '')
  return d.length >= 9 && d.length <= 15 ? d : null
}

/** wa.me link; without a number WhatsApp asks who to send it to. */
export function whatsAppUrl(phone: string | null | undefined, text: string): string {
  const n = waNumber(phone)
  return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(text)}`
}
