'use client'

import { LinkedWorkProvider } from '@/components/LinkedWorkProvider'
import { ClientPortalProjectView } from '@/components/client-portal-views/ProjectView'

export default function LinkedProjectPage() {
  return <LinkedWorkProvider><ClientPortalProjectView /></LinkedWorkProvider>
}
