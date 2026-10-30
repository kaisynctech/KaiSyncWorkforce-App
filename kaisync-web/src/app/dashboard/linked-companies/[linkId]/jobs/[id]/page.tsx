'use client'

import { LinkedWorkProvider } from '@/components/LinkedWorkProvider'
import { ClientPortalJobView } from '@/components/client-portal-views/JobView'

export default function LinkedJobPage() {
  return <LinkedWorkProvider><ClientPortalJobView /></LinkedWorkProvider>
}
