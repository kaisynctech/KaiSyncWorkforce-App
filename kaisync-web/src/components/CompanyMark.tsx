'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { brandByCode, brandColour, brandInitials, brandLogoUrl, copyOldLogoIfNeeded } from '@/lib/company-brand'

type CompanyLike = {
  id?: string | null
  name?: string | null
  code?: string | null
  logo_url?: string | null
  brand_logo_path?: string | null
}

/**
 * The company's name and logo link. Uses the loaded company row when it carries the logo path,
 * otherwise looks the brand up by company code (portals and code sign-in only have the code).
 * HR users copy an old private logo to the public bucket on the way (once).
 */
export function useCompanyBrand(company: CompanyLike | null | undefined, opts: { companyCode?: string | null; canCopyOldLogo?: boolean } = {}) {
  const code = opts.companyCode ?? company?.code ?? null
  const known = company && company.brand_logo_path !== undefined
  const [state, setState] = useState<{ key: string; name: string | null; logoPath: string | null } | null>(null)
  const key = `${company?.id ?? ''}|${code ?? ''}|${company?.brand_logo_path ?? ''}`

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    void (async () => {
      let logoPath = company?.brand_logo_path ?? null
      let name = company?.name ?? null
      if (!known && code) {
        const b = await brandByCode(supabase, code)
        if (b) { logoPath = b.logo_path; name = name || b.name }
      }
      if (!logoPath && opts.canCopyOldLogo && company?.id && company.logo_url) {
        logoPath = await copyOldLogoIfNeeded(supabase, { id: company.id, logo_url: company.logo_url, brand_logo_path: null })
      }
      if (!cancelled) setState({ key, name, logoPath })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, known, opts.canCopyOldLogo])

  const current = state?.key === key ? state : null
  return {
    name: current?.name ?? company?.name ?? null,
    logoUrl: current?.logoPath ? brandLogoUrl(createClient(), current.logoPath) : null,
  }
}

/**
 * The company badge: logo on a white rounded tile (so any logo reads on the dark bars),
 * or the company's initials on a colour when there is no logo.
 */
export function CompanyMark({ name, logoUrl, size = 32, className = '' }: {
  name: string | null | undefined
  logoUrl: string | null | undefined
  size?: number
  className?: string
}) {
  const [broken, setBroken] = useState<string | null>(null)
  const showLogo = !!logoUrl && broken !== logoUrl
  const radius = Math.round(size / 4)
  if (showLogo) {
    return (
      <span className={`inline-flex items-center justify-center bg-white shrink-0 overflow-hidden ${className}`}
        style={{ height: size, minWidth: size, maxWidth: size * 3, borderRadius: radius, padding: Math.max(2, Math.round(size / 10)) }}>
        {/* Wide logos get a wider tile (up to 3× the height) so they stay readable. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl!} alt={name ? `${name} logo` : 'Company logo'} className="h-full w-auto max-w-full object-contain"
          onError={() => setBroken(logoUrl!)} />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className={`inline-flex items-center justify-center text-white font-bold shrink-0 ${className}`}
      style={{ width: size, height: size, borderRadius: radius, background: brandColour(name), fontSize: Math.round(size * 0.4) }}>
      {brandInitials(name)}
    </span>
  )
}
