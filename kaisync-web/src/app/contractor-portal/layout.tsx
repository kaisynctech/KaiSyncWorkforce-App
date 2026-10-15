import { Suspense } from 'react'

export default function ContractorPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background text-text-secondary text-[14px]">
          Loading…
        </div>
      }
    >
      {children}
    </Suspense>
  )
}
