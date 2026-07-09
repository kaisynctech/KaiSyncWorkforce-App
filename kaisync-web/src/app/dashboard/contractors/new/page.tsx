import Link from 'next/link'

export default function NewContractorPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 gap-3">
      <span className="material-icons text-[56px] text-text-disabled">engineering</span>
      <h2 className="text-[18px] font-semibold text-text-primary">Add Contractor</h2>
      <p className="text-[14px] text-text-secondary">Coming in Phase 4</p>
      <Link
        href="/dashboard/contractors"
        className="mt-2 h-10 px-5 rounded-sm bg-primary text-white text-[13px] font-medium flex items-center hover:bg-primary-dark transition-colors"
      >
        Back to Contractors
      </Link>
    </div>
  )
}
