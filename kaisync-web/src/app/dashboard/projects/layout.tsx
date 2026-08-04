'use client'

import { HrModuleGate } from '@/components/HrModuleGate'
import { PERM } from '@/lib/permissions'

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return (
    <HrModuleGate flag="projects" permissionKey={PERM.projectsView}>
      {children}
    </HrModuleGate>
  )
}
