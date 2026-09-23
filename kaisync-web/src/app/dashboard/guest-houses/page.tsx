'use client'

import { PropertyKindPortfolio } from '@/components/properties/PropertyKindPortfolio'

export default function GuestHousePage() {
  return (
    <PropertyKindPortfolio
      title="B&B / Guest house"
      description="Create guest houses here, generate rooms, then open a property for the Room board — bookings, check-in/out, and housekeeping."
      kind="guest_house"
    />
  )
}
