export interface UnitOption {
  value: string
  label: string
  group: string
}

export const UNITS_OF_MEASURE: UnitOption[] = [
  // Quantity
  { value: 'each',       label: 'Each',                   group: 'Quantity' },
  { value: 'pair',       label: 'Pair',                   group: 'Quantity' },
  { value: 'set',        label: 'Set',                    group: 'Quantity' },
  { value: 'kit',        label: 'Kit',                    group: 'Quantity' },
  { value: 'lot',        label: 'Lot',                    group: 'Quantity' },
  { value: 'box',        label: 'Box',                    group: 'Quantity' },
  { value: 'case',       label: 'Case',                   group: 'Quantity' },
  { value: 'pack',       label: 'Pack',                   group: 'Quantity' },
  { value: 'roll',       label: 'Roll',                   group: 'Quantity' },
  { value: 'sheet',      label: 'Sheet',                  group: 'Quantity' },
  { value: 'bundle',     label: 'Bundle',                 group: 'Quantity' },
  { value: 'pallet',     label: 'Pallet',                 group: 'Quantity' },
  // Weight
  { value: 'kg',         label: 'Kilogram (kg)',           group: 'Weight' },
  { value: 'g',          label: 'Gram (g)',                group: 'Weight' },
  { value: 'mg',         label: 'Milligram (mg)',          group: 'Weight' },
  { value: 'tonne',      label: 'Tonne',                  group: 'Weight' },
  { value: 'lb',         label: 'Pound (lb)',              group: 'Weight' },
  { value: 'oz',         label: 'Ounce (oz)',              group: 'Weight' },
  // Volume
  { value: 'litre',      label: 'Litre (L)',              group: 'Volume' },
  { value: 'ml',         label: 'Millilitre (ml)',         group: 'Volume' },
  { value: 'm3',         label: 'Cubic metre (m³)',        group: 'Volume' },
  { value: 'gallon',     label: 'Gallon',                 group: 'Volume' },
  { value: 'fl_oz',      label: 'Fluid ounce',            group: 'Volume' },
  // Area
  { value: 'm2',         label: 'Square metre (m²)',       group: 'Area' },
  { value: 'cm2',        label: 'Square centimetre (cm²)', group: 'Area' },
  { value: 'ft2',        label: 'Square foot (ft²)',       group: 'Area' },
  // Length
  { value: 'm',          label: 'Metre (m)',               group: 'Length' },
  { value: 'cm',         label: 'Centimetre (cm)',         group: 'Length' },
  { value: 'mm',         label: 'Millimetre (mm)',         group: 'Length' },
  { value: 'km',         label: 'Kilometre (km)',          group: 'Length' },
  { value: 'ft',         label: 'Foot (ft)',               group: 'Length' },
  { value: 'inch',       label: 'Inch (in)',               group: 'Length' },
  { value: 'yard',       label: 'Yard (yd)',               group: 'Length' },
  // Time / Service
  { value: 'hour',       label: 'Hour',                   group: 'Time' },
  { value: 'half_hour',  label: 'Half hour',              group: 'Time' },
  { value: 'day',        label: 'Day',                    group: 'Time' },
  { value: 'week',       label: 'Week',                   group: 'Time' },
  { value: 'month',      label: 'Month',                  group: 'Time' },
  // Job-based
  { value: 'job',        label: 'Job',                    group: 'Job-based' },
  { value: 'service',    label: 'Service',                group: 'Job-based' },
  { value: 'trip',       label: 'Trip',                   group: 'Job-based' },
  { value: 'visit',      label: 'Visit',                  group: 'Job-based' },
]

export function getUnitLabel(value: string): string {
  return UNITS_OF_MEASURE.find(u => u.value === value)?.label ?? value
}
