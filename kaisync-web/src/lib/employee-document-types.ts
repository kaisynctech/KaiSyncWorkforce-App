/**
 * Mirrors KaiFlow.Timesheets.Services.EmployeeDocumentTypes
 */

export const EMPLOYEE_DOCUMENT_TYPES = [
  { key: 'national_id', label: 'National ID' },
  { key: 'passport', label: 'Passport' },
  { key: 'contract', label: 'Employment Contract' },
  { key: 'tax_certificate', label: 'Tax Certificate' },
  { key: 'bank_details', label: 'Bank Details' },
  { key: 'medical_certificate', label: 'Medical Certificate' },
  { key: 'other', label: 'Other' },
] as const

export const EMPLOYEE_DOCUMENT_KEYS = EMPLOYEE_DOCUMENT_TYPES.map((t) => t.key)

export function formatEmployeeDocumentType(raw: string): string {
  const found = EMPLOYEE_DOCUMENT_TYPES.find((t) => t.key === raw)
  if (found) return found.label
  // Legacy web keys → readable labels
  const legacy: Record<string, string> = {
    id_document: 'ID Document',
    certificate: 'Certificate',
    payslip: 'Payslip',
  }
  if (legacy[raw]) return legacy[raw]
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export const EMPLOYEE_DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.doc,.docx'

/** MAUI path: employee_documents/{companyId}/{employeeId}/{guid}{ext} */
export function employeeDocumentStoragePath(
  companyId: string,
  employeeId: string,
  ext: string,
): string {
  return `employee_documents/${companyId}/${employeeId}/${crypto.randomUUID()}.${ext}`
}

/** MAUI path: leave_attachments/{employeeId}/{guid}{ext} */
export function leaveAttachmentStoragePath(employeeId: string, ext: string): string {
  return `leave_attachments/${employeeId}/${crypto.randomUUID()}.${ext}`
}
