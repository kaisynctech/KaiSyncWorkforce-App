import Link from 'next/link'

export default function NewProjectPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full py-24 gap-3">
      <span className="material-icons text-[56px] text-text-disabled">folder</span>
      <h2 className="text-[18px] font-semibold text-text-primary">Create Project</h2>
      <p className="text-[14px] text-text-secondary">Coming in Phase 5</p>
      <Link href="/dashboard/projects"
        className="mt-2 h-10 px-5 rounded-sm bg-primary text-white text-[13px] font-medium flex items-center hover:bg-primary-dark transition-colors">
        Back to Projects
      </Link>
    </div>
  )
}
