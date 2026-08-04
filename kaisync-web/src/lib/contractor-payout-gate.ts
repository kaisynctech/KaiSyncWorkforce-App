/**
 * Soft (optional) contractor payout risk prompts.
 * Warns on payment_hold / compliance_hold / unverified banking — never hard-blocks.
 */

export type ContractorPayoutRiskFlags = {
  name?: string | null
  banking_verified?: boolean | null
  payment_hold?: boolean | null
  compliance_hold?: boolean | null
}

export function collectContractorPayoutRisks(flags: ContractorPayoutRiskFlags): string[] {
  const risks: string[] = []
  if (flags.payment_hold) risks.push('payment hold is on')
  if (flags.compliance_hold) risks.push('compliance hold is on')
  if (!flags.banking_verified) risks.push('banking is not verified')
  return risks
}

export function formatContractorPayoutRiskConfirm(
  flags: ContractorPayoutRiskFlags,
  actionLabel: string,
): string | null {
  const risks = collectContractorPayoutRisks(flags)
  if (risks.length === 0) return null
  const who = flags.name?.trim() ? `"${flags.name.trim()}"` : 'this contractor'
  return (
    `${who}: ${risks.join('; ')}.\n\n` +
    `${actionLabel} anyway? This is a warning only — you can proceed.`
  )
}

/** Returns true if the user may continue (no risks, or confirmed). */
export function confirmContractorPayoutRisks(
  flags: ContractorPayoutRiskFlags,
  actionLabel: string,
): boolean {
  const message = formatContractorPayoutRiskConfirm(flags, actionLabel)
  if (!message) return true
  return window.confirm(message)
}

export function formatBatchContractorPayoutRiskConfirm(
  flagged: Array<ContractorPayoutRiskFlags & { name?: string | null }>,
  actionLabel: string,
): string | null {
  if (flagged.length === 0) return null
  const lines = flagged.map(f => {
    const risks = collectContractorPayoutRisks(f)
    const who = f.name?.trim() || 'Unknown contractor'
    return `• ${who}: ${risks.join('; ')}`
  })
  return (
    `${flagged.length} contractor(s) have payout warnings:\n\n` +
    `${lines.join('\n')}\n\n` +
    `${actionLabel} anyway? This is a warning only — you can proceed.`
  )
}

export function confirmBatchContractorPayoutRisks(
  flagged: Array<ContractorPayoutRiskFlags & { name?: string | null }>,
  actionLabel: string,
): boolean {
  const message = formatBatchContractorPayoutRiskConfirm(flagged, actionLabel)
  if (!message) return true
  return window.confirm(message)
}

export async function fetchContractorPayoutRiskFlags(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },
  contractorId: string,
): Promise<ContractorPayoutRiskFlags | null> {
  const { data } = await supabase
    .from('contractors')
    .select('name, banking_verified, payment_hold, compliance_hold')
    .eq('id', contractorId)
    .maybeSingle()
  if (!data) return null
  return data as ContractorPayoutRiskFlags
}

export async function fetchContractorPayoutRiskFlagsByIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },
  contractorIds: string[],
): Promise<Map<string, ContractorPayoutRiskFlags>> {
  const unique = [...new Set(contractorIds.filter(Boolean))]
  const map = new Map<string, ContractorPayoutRiskFlags>()
  if (unique.length === 0) return map
  const { data } = await supabase
    .from('contractors')
    .select('id, name, banking_verified, payment_hold, compliance_hold')
    .in('id', unique)
  for (const row of (data ?? []) as Array<ContractorPayoutRiskFlags & { id: string }>) {
    map.set(row.id, row)
  }
  return map
}
