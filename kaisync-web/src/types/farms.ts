/** Farms module types — biological/land domain (not inventory). */

export type FarmLandUnitType = 'camp' | 'paddock' | 'tunnel' | 'orchard' | 'field' | 'barn' | 'other'

export type LivestockSpecies = 'chicken' | 'cattle' | 'sheep' | 'goat' | 'pig' | 'other'

export type LivestockGroupStatus = 'active' | 'sold' | 'closed'

export type FarmAnimalStatus = 'active' | 'sold' | 'dead' | 'culled'

export type LivestockEventType = 'intake' | 'death' | 'cull' | 'move' | 'count_adjust' | 'sale'

export type Farm = {
  id: string
  company_id: string
  name: string
  farm_code: string | null
  address: string | null
  site_id: string | null
  notes: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type FarmLandUnit = {
  id: string
  company_id: string
  farm_id: string
  name: string
  unit_type: FarmLandUnitType
  area_ha: number | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type FarmLivestockGroup = {
  id: string
  company_id: string
  farm_id: string
  land_unit_id: string | null
  name: string
  species: LivestockSpecies
  breed: string | null
  headcount: number
  status: LivestockGroupStatus
  notes: string | null
  acquired_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  farm_land_units?: { name: string } | null
  farms?: { name: string; farm_code: string | null } | null
}

export type FarmAnimal = {
  id: string
  company_id: string
  farm_id: string
  group_id: string | null
  land_unit_id: string | null
  tag_number: string | null
  name: string | null
  species: LivestockSpecies
  sex: 'male' | 'female' | 'unknown' | null
  date_of_birth: string | null
  status: FarmAnimalStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export type FarmLivestockEvent = {
  id: string
  company_id: string
  farm_id: string
  group_id: string | null
  animal_id: string | null
  event_type: LivestockEventType
  event_date: string
  quantity: number
  from_land_unit_id: string | null
  to_land_unit_id: string | null
  notes: string | null
  recorded_by: string | null
  created_at: string
}

export const SPECIES_OPTIONS: { value: LivestockSpecies; label: string }[] = [
  { value: 'chicken', label: 'Chicken' },
  { value: 'cattle', label: 'Cattle' },
  { value: 'sheep', label: 'Sheep' },
  { value: 'goat', label: 'Goat' },
  { value: 'pig', label: 'Pig' },
  { value: 'other', label: 'Other' },
]

export const LAND_UNIT_TYPES: { value: FarmLandUnitType; label: string }[] = [
  { value: 'camp', label: 'Camp' },
  { value: 'paddock', label: 'Paddock' },
  { value: 'tunnel', label: 'Tunnel' },
  { value: 'orchard', label: 'Orchard' },
  { value: 'field', label: 'Field' },
  { value: 'barn', label: 'Barn' },
  { value: 'other', label: 'Other' },
]

export const EVENT_TYPE_LABELS: Record<LivestockEventType, string> = {
  intake: 'Intake',
  death: 'Death',
  cull: 'Cull',
  move: 'Move',
  count_adjust: 'Count adjust',
  sale: 'Sale',
}
