'use client'

import { PropertyKindPortfolio } from '@/components/properties/PropertyKindPortfolio'

export default function StudentAccommodationsPage() {
  return (
    <PropertyKindPortfolio
      title="Student accommodations"
      description="Create and manage student residences here. New properties are always student accommodation — add rooms in bulk when you create."
      kind="student_accommodation"
    />
  )
}
