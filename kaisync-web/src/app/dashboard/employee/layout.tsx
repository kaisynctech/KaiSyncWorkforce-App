'use client'

import { OfflineSyncBanner } from '@/components/employee/OfflineSyncBanner'

export default function EmployeePortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col min-h-0">
      <OfflineSyncBanner />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}
