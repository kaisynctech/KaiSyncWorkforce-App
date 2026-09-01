'use client'

import { createContext, useContext } from 'react'
import type { Company, Employee } from '@/types/database'

type DashboardCompanyContextValue = {
  company: Company | null
  employee: Employee | null
}

const DashboardCompanyContext = createContext<DashboardCompanyContextValue>({
  company: null,
  employee: null,
})

export function DashboardCompanyProvider({
  company,
  employee,
  children,
}: DashboardCompanyContextValue & { children: React.ReactNode }) {
  return (
    <DashboardCompanyContext.Provider value={{ company, employee }}>
      {children}
    </DashboardCompanyContext.Provider>
  )
}

export function useDashboardCompany() {
  return useContext(DashboardCompanyContext)
}
