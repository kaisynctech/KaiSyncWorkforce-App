/** Permanent tenant portal codes: R{company}#### */

function residentPrefix(companyCode: string): string {
  const normalized = companyCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return normalized ? `R${normalized}` : 'R'
}

/** Next permanent portal code — never rotates an existing code. */
export function nextResidentCode(companyCode: string, existingCodes: (string | null | undefined)[]): string {
  const prefix = residentPrefix(companyCode)
  let max = 0
  for (const code of existingCodes) {
    if (!code) continue
    const trimmed = code.trim().toUpperCase()
    if (!trimmed.startsWith(prefix)) continue
    const suffix = trimmed.slice(prefix.length)
    const n = Number.parseInt(suffix, 10)
    if (!Number.isNaN(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}
