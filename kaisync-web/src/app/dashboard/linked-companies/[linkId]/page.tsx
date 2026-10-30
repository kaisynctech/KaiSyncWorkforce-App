'use client'

import { LinkedWorkProvider } from '@/components/LinkedWorkProvider'
import { ClientPortalHomeView } from '@/components/client-portal-views/HomeView'

export default function LinkedWorkPage() {
  return <LinkedWorkProvider><ClientPortalHomeView /></LinkedWorkProvider>
}
