import Link from 'next/link'

export default function ContractorPortalPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: 'linear-gradient(145deg, #0f172a 0%, #1a1f2e 100%)' }}>
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
        <span className="material-icons text-white text-[32px]">engineering</span>
      </div>
      <h1 className="text-white text-[28px] font-bold mb-3">Contractor Portal</h1>
      <p className="text-slate-400 text-[15px] text-center max-w-[340px] mb-8">
        Access your jobs, compliance documents and payments.
      </p>
      <div className="px-4 py-2 rounded-lg text-[13px] font-medium text-slate-300 mb-8"
        style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
        Coming soon — available in the KaiSync mobile app
      </div>
      <Link href="/auth/id-entry"
        className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-[14px] transition-colors">
        <span className="material-icons text-[16px]">arrow_back</span>
        Back to sign in
      </Link>
    </div>
  )
}
