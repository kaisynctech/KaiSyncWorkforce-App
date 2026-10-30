'use client'

import { LinkedWorkProvider } from '@/components/LinkedWorkProvider'
import { LinkedNewJobForm } from '@/components/LinkedNewJobForm'

export default function LinkedNewJobPage() {
  return <LinkedWorkProvider><LinkedNewJobForm /></LinkedWorkProvider>
}
