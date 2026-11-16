/**
 * What a business does → what KaiSync switches on for it (board N, the industry map).
 * Kept in code on purpose: a company only stores which types it picked (piece 5b); changing a type here
 * changes what new set-ups get, never existing quotations.
 */

/** How a catalogue item is used (board M). */
export type ItemUse = 'sell' | 'use_up' | 'hire' | 'make'

/** Catalogue sections, matching inventory item kinds where they already exist (part, service, material, labour). */
export type CatalogueKind = 'part' | 'service' | 'material' | 'labour' | 'package' | 'fee' | 'hire'

/** What a quotation can show; a template switches these on or off (board I). */
export type QuoteFeature =
  | 'products' | 'services' | 'packages' | 'options' | 'cost_margin' | 'ask_suppliers'
  | 'sections' | 'contingency' | 'deposit' | 'versions' | 'recurring' | 'per_person' | 'measurements'

/** Fields at the top of a quotation. */
export type HeaderField = 'vehicle' | 'client_order_no' | 'event_date' | 'site_address' | 'contract_term'

export type BusinessType = {
  key: string
  label: string
  /** One line under the name when picking. */
  hint: string
  /** What happens after the client accepts. */
  afterAccept: string
  itemUses: ItemUse[]
  catalogue: CatalogueKind[]
  quote: {
    templateName: string
    features: QuoteFeature[]
    header: HeaderField[]
    /** Columns on each line, in order (team-only ones are marked in the template). */
    columns: string[]
    validDays: number
    depositPct: number | null
  }
  askSuppliers: boolean
  recurring: boolean
  timesheets: boolean
}

const BASE_COLUMNS = ['item', 'qty', 'price', 'total']

export const BUSINESS_TYPES: BusinessType[] = [
  {
    key: 'beauty_events', label: 'Beauty, events & personal', hint: 'Makeup, hair, nails, décor, photography sessions',
    afterAccept: 'Booking', itemUses: ['sell', 'use_up'], catalogue: ['service', 'package', 'fee'],
    quote: { templateName: 'Services & packages', features: ['services', 'packages', 'per_person', 'deposit', 'options'], header: ['event_date', 'site_address'], columns: BASE_COLUMNS, validDays: 14, depositPct: 50 },
    askSuppliers: false, recurring: false, timesheets: true,
  },
  {
    key: 'parts_supply', label: 'Parts supply', hint: 'Automotive, mining, earth-moving and industrial parts',
    afterAccept: 'Order', itemUses: ['sell', 'make'], catalogue: ['part', 'service', 'fee'],
    quote: { templateName: 'Parts sales', features: ['products', 'options', 'cost_margin', 'ask_suppliers', 'versions'], header: ['vehicle', 'client_order_no'], columns: ['item', 'part_no', 'brand', 'condition', 'warranty', 'qty', 'price', 'total', 'cost', 'margin'], validDays: 14, depositPct: null },
    askSuppliers: true, recurring: false, timesheets: false,
  },
  {
    key: 'construction', label: 'Construction & building', hint: 'BOQs, phases, subcontractors, progress claims',
    afterAccept: 'Project', itemUses: ['sell', 'use_up', 'hire'], catalogue: ['material', 'labour', 'hire', 'service'],
    quote: { templateName: 'Building projects (BOQ)', features: ['products', 'services', 'sections', 'contingency', 'measurements', 'cost_margin', 'ask_suppliers', 'deposit', 'versions'], header: ['site_address', 'client_order_no'], columns: ['item', 'unit', 'qty', 'rate', 'total', 'cost', 'margin'], validDays: 30, depositPct: 30 },
    askSuppliers: true, recurring: false, timesheets: true,
  },
  {
    key: 'trades', label: 'Trades & home services', hint: 'Plumbing, electrical, solar, HVAC, fitting',
    afterAccept: 'Job card', itemUses: ['sell', 'use_up'], catalogue: ['part', 'service', 'labour', 'fee'],
    quote: { templateName: 'Good / Better / Best', features: ['products', 'services', 'options', 'cost_margin', 'ask_suppliers', 'deposit'], header: ['site_address'], columns: BASE_COLUMNS, validDays: 14, depositPct: null },
    askSuppliers: true, recurring: false, timesheets: true,
  },
  {
    key: 'auto_repair', label: 'Auto repair workshop', hint: 'Vehicle, reg, odometer, parts and labour',
    afterAccept: 'Job card', itemUses: ['sell', 'use_up'], catalogue: ['part', 'labour', 'service', 'fee'],
    quote: { templateName: 'Workshop job', features: ['products', 'services', 'cost_margin', 'ask_suppliers'], header: ['vehicle', 'client_order_no'], columns: ['item', 'part_no', 'qty', 'price', 'total'], validDays: 7, depositPct: null },
    askSuppliers: true, recurring: false, timesheets: true,
  },
  {
    key: 'cleaning_facilities', label: 'Cleaning, facilities, pest, pools & gardens', hint: 'Area × frequency, contracts, escalation',
    afterAccept: 'Recurring jobs', itemUses: ['use_up'], catalogue: ['service', 'labour', 'fee'],
    quote: { templateName: 'Service contract', features: ['services', 'recurring'], header: ['site_address', 'contract_term'], columns: BASE_COLUMNS, validDays: 30, depositPct: null },
    askSuppliers: false, recurring: true, timesheets: true,
  },
  {
    key: 'security', label: 'Security guarding', hint: 'Guards × shifts × days, night and Sunday rates',
    afterAccept: 'Shift roster', itemUses: [], catalogue: ['labour', 'service', 'fee'],
    quote: { templateName: 'Guarding contract', features: ['services', 'recurring'], header: ['site_address', 'contract_term'], columns: ['item', 'qty', 'rate', 'total'], validDays: 30, depositPct: null },
    askSuppliers: false, recurring: true, timesheets: true,
  },
  {
    key: 'labour_hire', label: 'Labour hire & staffing', hint: 'Rate per worker per hour plus markup',
    afterAccept: 'Placement', itemUses: [], catalogue: ['labour', 'fee'],
    quote: { templateName: 'Labour rates', features: ['services', 'recurring', 'cost_margin'], header: ['site_address', 'contract_term'], columns: ['item', 'qty', 'rate', 'total', 'cost', 'margin'], validDays: 30, depositPct: null },
    askSuppliers: false, recurring: true, timesheets: true,
  },
  {
    key: 'equipment_hire', label: 'Equipment & party hire', hint: 'Items × days, deposit, delivery',
    afterAccept: 'Hire out → return', itemUses: ['hire'], catalogue: ['hire', 'fee'],
    quote: { templateName: 'Hire', features: ['products', 'deposit'], header: ['event_date', 'site_address'], columns: ['item', 'qty', 'days', 'rate', 'total'], validDays: 14, depositPct: 50 },
    askSuppliers: false, recurring: false, timesheets: false,
  },
  {
    key: 'transport', label: 'Transport & logistics', hint: 'Per km, load or ton, fuel surcharge, waiting time',
    afterAccept: 'Trip / load', itemUses: [], catalogue: ['service', 'fee'],
    quote: { templateName: 'Transport', features: ['services', 'recurring'], header: ['client_order_no'], columns: ['item', 'qty', 'rate', 'total'], validDays: 7, depositPct: null },
    askSuppliers: false, recurring: true, timesheets: true,
  },
  {
    key: 'printing', label: 'Printing & signage', hint: 'Size (m²), quantity breaks, proofs',
    afterAccept: 'Job card', itemUses: ['sell', 'use_up', 'make'], catalogue: ['part', 'material', 'service'],
    quote: { templateName: 'Print job', features: ['products', 'measurements', 'options'], header: ['client_order_no'], columns: BASE_COLUMNS, validDays: 14, depositPct: 50 },
    askSuppliers: false, recurring: false, timesheets: false,
  },
  {
    key: 'catering', label: 'Catering & food', hint: 'Per head, menus, dietary counts',
    afterAccept: 'Booking', itemUses: ['sell', 'use_up', 'hire', 'make'], catalogue: ['package', 'service', 'hire', 'fee'],
    quote: { templateName: 'Catering', features: ['packages', 'per_person', 'deposit', 'options'], header: ['event_date', 'site_address'], columns: BASE_COLUMNS, validDays: 14, depositPct: 50 },
    askSuppliers: false, recurring: false, timesheets: true,
  },
  {
    key: 'manufacturing', label: 'Manufacturing & fabrication', hint: 'Materials, machine time and labour',
    afterAccept: 'Order → build → deliver', itemUses: ['sell', 'use_up', 'make'], catalogue: ['part', 'material', 'labour'],
    quote: { templateName: 'Fabrication', features: ['products', 'cost_margin', 'ask_suppliers', 'deposit'], header: ['client_order_no'], columns: ['item', 'qty', 'price', 'total', 'cost', 'margin'], validDays: 14, depositPct: 30 },
    askSuppliers: true, recurring: false, timesheets: true,
  },
  {
    key: 'it', label: 'IT & technology', hint: 'Hardware, licences, monthly support',
    afterAccept: 'Order + contract', itemUses: ['sell'], catalogue: ['part', 'service', 'fee'],
    quote: { templateName: 'IT proposal', features: ['products', 'services', 'recurring', 'cost_margin', 'ask_suppliers', 'options'], header: ['client_order_no', 'contract_term'], columns: BASE_COLUMNS, validDays: 14, depositPct: null },
    askSuppliers: true, recurring: true, timesheets: true,
  },
  {
    key: 'creative', label: 'Photo, video & design', hint: 'Packages, usage rights, revisions',
    afterAccept: 'Booking', itemUses: [], catalogue: ['service', 'package', 'fee'],
    quote: { templateName: 'Creative package', features: ['services', 'packages', 'deposit', 'options'], header: ['event_date'], columns: BASE_COLUMNS, validDays: 14, depositPct: 50 },
    askSuppliers: false, recurring: false, timesheets: true,
  },
  {
    key: 'training', label: 'Training & education', hint: 'Per learner, per course',
    afterAccept: 'Booking', itemUses: ['use_up'], catalogue: ['service', 'package', 'fee'],
    quote: { templateName: 'Training', features: ['services', 'per_person', 'deposit'], header: ['event_date', 'site_address'], columns: BASE_COLUMNS, validDays: 30, depositPct: null },
    askSuppliers: false, recurring: false, timesheets: true,
  },
  {
    key: 'professional', label: 'Professional services', hint: 'Consulting, accounting, legal: hours, fixed fees, retainers',
    afterAccept: 'Project / retainer', itemUses: [], catalogue: ['service', 'labour', 'fee'],
    quote: { templateName: 'Proposal', features: ['services', 'recurring', 'deposit'], header: ['client_order_no'], columns: ['item', 'qty', 'rate', 'total'], validDays: 30, depositPct: null },
    askSuppliers: false, recurring: true, timesheets: true,
  },
]

export function businessType(key: string | null | undefined): BusinessType | null {
  return BUSINESS_TYPES.find(t => t.key === key) ?? null
}

/** Everything a company with these types gets: the union, main type first. */
export function combinedSetup(keys: string[]) {
  const types = keys.map(businessType).filter((t): t is BusinessType => t !== null)
  const uniq = <T,>(xs: T[]) => [...new Set(xs)]
  return {
    types,
    itemUses: uniq(types.flatMap(t => t.itemUses)),
    catalogue: uniq(types.flatMap(t => t.catalogue)),
    templates: types.map(t => ({ businessType: t.key, ...t.quote })),
    askSuppliers: types.some(t => t.askSuppliers),
    recurring: types.some(t => t.recurring),
    timesheets: types.some(t => t.timesheets),
  }
}
