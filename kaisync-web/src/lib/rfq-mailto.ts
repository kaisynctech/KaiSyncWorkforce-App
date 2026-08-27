/**
 * RFQ mailto helpers — same pattern as Money quote send (no Resend required).
 */

export function openRfqMailto(opts: {
  recipients: Array<{ email: string | null | undefined; name?: string | null }>
  rfqNumber: string | null
  title: string
  lines: Array<{ description: string; quantity: string | number; unit: string }>
  companyName?: string
}): { opened: boolean; missingEmail: number } {
  const emails = opts.recipients
    .map(r => (r.email ?? '').trim())
    .filter(Boolean)
  const missingEmail = opts.recipients.length - emails.length

  const lineBlock = opts.lines
    .filter(l => String(l.description).trim())
    .map(l => `• ${l.description} — ${l.quantity} ${l.unit}`)
    .join('\n')

  const subject = encodeURIComponent(
    `RFQ ${opts.rfqNumber ?? ''} – ${opts.title || 'Request for quotation'}`.trim(),
  )
  const body = encodeURIComponent(
    [
      'Hello,',
      '',
      `Please provide pricing for the following request${opts.rfqNumber ? ` (${opts.rfqNumber})` : ''}:`,
      opts.title ? `Title: ${opts.title}` : '',
      '',
      lineBlock || '(See attached / shared RFQ details)',
      '',
      'Kind regards,',
      opts.companyName || 'KaiSync',
    ].filter(Boolean).join('\n'),
  )

  if (emails.length === 0) {
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank')
    return { opened: true, missingEmail }
  }

  const [to, ...bcc] = emails
  const bccPart = bcc.length > 0 ? `&bcc=${encodeURIComponent(bcc.join(','))}` : ''
  window.open(`mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}${bccPart}`, '_blank')
  return { opened: true, missingEmail }
}
