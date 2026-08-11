/** Normalize workflow form field JSON from MAUI (FieldType/IsRequired) and web shapes. */

export type FormFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'boolean'
  | 'signature'
  | 'textarea'
  | 'photo'

export type NormalizedFormField = {
  key: string
  label: string
  type: FormFieldType
  is_required: boolean
  options: string[]
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function pickBool(obj: Record<string, unknown>, ...keys: string[]): boolean {
  for (const k of keys) {
    if (k in obj) return Boolean(obj[k])
  }
  return false
}

function normalizeType(raw: string): FormFieldType {
  const t = raw.toLowerCase().replace(/_/g, '')
  if (t === 'checkbox' || t === 'check') return 'checkbox'
  if (t === 'boolean' || t === 'bool') return 'boolean'
  if (t === 'signature') return 'signature'
  if (t === 'textarea' || t === 'multiline') return 'textarea'
  if (t === 'number' || t === 'numeric') return 'number'
  if (t === 'date' || t === 'datetime') return 'date'
  if (t === 'select' || t === 'dropdown' || t === 'picker') return 'select'
  if (t === 'photo' || t === 'image') return 'photo'
  return 'text'
}

export function normalizeFormField(raw: unknown, index: number): NormalizedFormField | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const key = pickString(obj, 'key', 'Key', 'id', 'Id') || `field_${index}`
  const label = pickString(obj, 'label', 'Label', 'name', 'Name') || key
  const typeRaw = pickString(obj, 'fieldType', 'FieldType', 'field_type', 'type', 'Type') || 'text'
  const type = normalizeType(typeRaw)
  const is_required = pickBool(obj, 'is_required', 'IsRequired', 'isRequired', 'required', 'Required')

  let options: string[] = []
  const opts = obj.options ?? obj.Options ?? obj.choices ?? obj.Choices
  if (Array.isArray(opts)) {
    options = opts.map(String).filter(Boolean)
  } else if (typeof opts === 'string' && opts.trim()) {
    options = opts.split(',').map(s => s.trim()).filter(Boolean)
  }

  return { key, label, type, is_required, options }
}

export function normalizeFormFields(fields: unknown): NormalizedFormField[] {
  let list: unknown = fields
  if (typeof fields === 'string') {
    try { list = JSON.parse(fields) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list
    .map((f, i) => normalizeFormField(f, i))
    .filter((f): f is NormalizedFormField => f != null)
}

export function isCheckField(type: FormFieldType): boolean {
  return type === 'checkbox' || type === 'boolean'
}

export function isTextLikeField(type: FormFieldType): boolean {
  return type === 'text' || type === 'signature' || type === 'textarea'
}
