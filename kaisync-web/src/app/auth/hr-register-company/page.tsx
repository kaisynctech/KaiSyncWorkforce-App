'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const INDUSTRY_OPTIONS = [
  'Agriculture', 'Construction', 'Education', 'Finance & Insurance',
  'Healthcare', 'Hospitality & Tourism', 'IT & Technology', 'Legal',
  'Manufacturing', 'Media & Entertainment', 'Mining', 'Real Estate',
  'Retail', 'Transport & Logistics', 'Other',
]

const SIZE_OPTIONS = ['1–10', '11–50', '51–200', '201–500', '500+']

export default function HrRegisterCompanyPage() {
  const router = useRouter()
  const [companyName, setCompanyName] = useState('')
  const [industry, setIndustry] = useState('')
  const [sizeRange, setSizeRange] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!companyName.trim()) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated. Please verify your email first.')

      const { error: insertError } = await supabase.from('companies').insert({
        name: companyName.trim(),
        owner_user_id: user.id,
        industry: industry || null,
        size_range: sizeRange || null,
      })
      if (insertError) throw insertError

      router.push('/dashboard/overview')
      router.refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create company')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="bg-surface rounded-lg p-8 shadow-sm border border-divider">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center mb-4">
            <span className="material-icons text-white text-3xl">domain_add</span>
          </div>
          <h1 className="text-[22px] font-semibold text-text-primary">Set up your company</h1>
          <p className="text-[13px] text-text-secondary mt-1">Step 2 of 2 — Company details</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error-dark rounded-md flex items-center gap-2">
            <span className="material-icons text-error text-[18px]">error_outline</span>
            <p className="text-[13px] text-error">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Company name <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              required
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Industry
            </label>
            <select
              value={industry}
              onChange={e => setIndustry(e.target.value)}
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors appearance-none"
            >
              <option value="">Select industry (optional)</option>
              {INDUSTRY_OPTIONS.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Company size
            </label>
            <select
              value={sizeRange}
              onChange={e => setSizeRange(e.target.value)}
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors appearance-none"
            >
              <option value="">Select size (optional)</option>
              {SIZE_OPTIONS.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={loading || !companyName.trim()}
            className="h-11 rounded-md bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
          >
            {loading ? 'Creating company…' : 'Create Company'}
          </button>
        </form>
      </div>
    </div>
  )
}
