'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function EmployeeProfileRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard/profile') }, [router])
  return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">
      Redirecting…
    </div>
  )
}
