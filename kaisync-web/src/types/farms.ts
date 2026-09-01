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
  farm_livestock_groups?: { name: string } | null
  farm_animals?: { tag_number: string | null; name: string | null } | null
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

export type CropType = 'vegetable' | 'fruit' | 'grain' | 'other'
export type PlantingStatus = 'planned' | 'active' | 'harvested' | 'abandoned'
export type PlantingEventType = 'plant' | 'input' | 'loss' | 'harvest' | 'status_note'
export type FarmQtyUnit = 'kg' | 'tonne' | 'crate' | 'bunch' | 'each' | 'other'

export type ProductionProductType = 'eggs' | 'milk' | 'honey' | 'other'
export type ProductionLotStatus = 'open' | 'closed' | 'sold'
export type ProductionEventType = 'collect' | 'loss' | 'sale' | 'adjust'
export type ProductionUnit = 'dozen' | 'each' | 'litre' | 'kg' | 'other'

export type FarmPlanting = {
  id: string
  company_id: string
  farm_id: string
  land_unit_id: string | null
  name: string
  crop_type: CropType
  variety: string | null
  area_ha: number | null
  plant_count: number | null
  planted_at: string | null
  expected_harvest_at: string | null
  total_harvested: number
  harvest_unit: FarmQtyUnit
  status: PlantingStatus
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  farm_land_units?: { name: string } | null
}

export type FarmPlantingEvent = {
  id: string
  company_id: string
  farm_id: string
  planting_id: string
  event_type: PlantingEventType
  event_date: string
  quantity: number
  unit: FarmQtyUnit
  notes: string | null
  recorded_by: string | null
  created_at: string
}

export type FarmProductionLot = {
  id: string
  company_id: string
  farm_id: string
  group_id: string | null
  land_unit_id: string | null
  name: string
  product_type: ProductionProductType
  quantity_total: number
  unit: ProductionUnit
  status: ProductionLotStatus
  period_start: string | null
  period_end: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  farm_land_units?: { name: string } | null
  farm_livestock_groups?: { name: string } | null
}

export type FarmProductionEvent = {
  id: string
  company_id: string
  farm_id: string
  lot_id: string
  event_type: ProductionEventType
  event_date: string
  quantity: number
  notes: string | null
  recorded_by: string | null
  created_at: string
}

export const CROP_TYPE_OPTIONS: { value: CropType; label: string }[] = [
  { value: 'vegetable', label: 'Vegetable' },
  { value: 'fruit', label: 'Fruit' },
  { value: 'grain', label: 'Grain' },
  { value: 'other', label: 'Other' },
]

export const FARM_QTY_UNITS: { value: FarmQtyUnit; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'tonne', label: 'tonne' },
  { value: 'crate', label: 'crate' },
  { value: 'bunch', label: 'bunch' },
  { value: 'each', label: 'each' },
  { value: 'other', label: 'other' },
]

export const PLANTING_EVENT_LABELS: Record<PlantingEventType, string> = {
  plant: 'Plant',
  input: 'Input',
  loss: 'Loss',
  harvest: 'Harvest',
  status_note: 'Note',
}

export const PRODUCT_TYPE_OPTIONS: { value: ProductionProductType; label: string }[] = [
  { value: 'eggs', label: 'Eggs' },
  { value: 'milk', label: 'Milk' },
  { value: 'honey', label: 'Honey' },
  { value: 'other', label: 'Other' },
]

export const PRODUCTION_UNITS: { value: ProductionUnit; label: string }[] = [
  { value: 'dozen', label: 'dozen' },
  { value: 'each', label: 'each' },
  { value: 'litre', label: 'litre' },
  { value: 'kg', label: 'kg' },
  { value: 'other', label: 'other' },
]

export const PRODUCTION_EVENT_LABELS: Record<ProductionEventType, string> = {
  collect: 'Collect',
  loss: 'Loss',
  sale: 'Sale',
  adjust: 'Adjust (set total)',
}
