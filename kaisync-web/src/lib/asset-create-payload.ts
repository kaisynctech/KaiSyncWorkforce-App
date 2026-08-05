/**
 * Build assets INSERT/UPDATE payloads aligned with live NOT NULL asset_type.
 */

import { ASSET_STATUSES, type AssetStatus } from '@/lib/supply-assets'

export type AssetCreateInput = {
  companyId: string
  label: string
  assetType?: string | null
  serialNumber?: string | null
  manufacturer?: string | null
  modelNumber?: string | null
  warrantyExpires?: string | null
  status?: string | null
  notes?: string | null
  siteId?: string | null
  unitId?: string | null
  assignedEmployeeId?: string | null
  installDate?: string | null
}

function emptyToNull(value: string | null | undefined): string | null {
  const t = value?.trim()
  return t ? t : null
}

export function normalizeAssetStatus(raw: string | null | undefined): AssetStatus {
  const v = (raw ?? '').trim().toLowerCase()
  if (ASSET_STATUSES.includes(v as AssetStatus)) return v as AssetStatus
  return 'active'
}

/** Default type when UI leaves type blank — DB column is NOT NULL. */
export function resolveAssetType(raw: string | null | undefined): string {
  return emptyToNull(raw) ?? 'General'
}

export function buildAssetCreatePayload(input: AssetCreateInput): Record<string, unknown> {
  const label = input.label.trim()
  if (!label) throw new Error('Asset label is required.')

  return {
    company_id: input.companyId,
    label,
    asset_type: resolveAssetType(input.assetType),
    serial_number: emptyToNull(input.serialNumber),
    manufacturer: emptyToNull(input.manufacturer),
    model_number: emptyToNull(input.modelNumber),
    warranty_expires: input.warrantyExpires || null,
    status: normalizeAssetStatus(input.status),
    notes: emptyToNull(input.notes),
    site_id: input.siteId || null,
    unit_id: input.unitId || null,
    assigned_employee_id: input.assignedEmployeeId || null,
    install_date: input.installDate || null,
  }
}
