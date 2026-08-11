/** Mirrors MAUI EntityCodeHelper project codes: P{company}#### */

function projectPrefix(companyCode: string): string {
  const normalized = companyCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return normalized ? `P${normalized}` : 'P'
}

export function nextProjectCode(
  companyCode: string,
  existingCodes: (string | null | undefined)[],
): string {
  const prefix = projectPrefix(companyCode)
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

export type ProjectCreateInput = {
  companyId: string
  title: string
  projectCode?: string | null
  clientId?: string | null
  managerEmployeeId?: string | null
  status?: string | null
  notes?: string | null
  agreementNotes?: string | null
  quotationNotes?: string | null
  quotationValidUntil?: string | null
  siteStartDate?: string | null
  expectedCompletionDate?: string | null
  nextVisitDate?: string | null
  expectedCloseDate?: string | null
}

export function buildProjectCreatePayload(input: ProjectCreateInput) {
  return {
    company_id: input.companyId,
    title: input.title.trim(),
    project_code: input.projectCode?.trim() ? input.projectCode.trim().toUpperCase() : null,
    client_id: input.clientId || null,
    manager_employee_id: input.managerEmployeeId || null,
    status: input.status?.trim() || 'draft',
    notes: input.notes?.trim() || null,
    agreement_notes: input.agreementNotes?.trim() || null,
    quotation_notes: input.quotationNotes?.trim() || null,
    quotation_valid_until: input.quotationValidUntil || null,
    site_start_date: input.siteStartDate || null,
    expected_completion_date: input.expectedCompletionDate || null,
    next_visit_date: input.nextVisitDate || null,
    expected_close_date: input.expectedCloseDate || null,
  }
}
