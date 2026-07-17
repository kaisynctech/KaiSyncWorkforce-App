import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  if (!user && pathname.startsWith('/dashboard')) {
    // Employee portal routes use code-auth (localStorage kf_cs) — no JWT present.
    // Server-side middleware cannot read localStorage, so these routes must be
    // allowed through. The client-side dashboard/layout.tsx handles the auth
    // check and will redirect truly unauthenticated users.
    if (pathname.startsWith('/dashboard/employee')) {
      return supabaseResponse
    }
    // HR/admin routes require a JWT — redirect to role picker if missing.
    const url = request.nextUrl.clone()
    url.pathname = '/auth/id-entry'
    return NextResponse.redirect(url)
  }

  // Access-level routing guard
  if (user && pathname.startsWith('/dashboard')) {
    const { data: emp } = await supabase
      .from('employees')
      .select('access_level, is_active, registration_status')
      .eq('user_id', user.id)
      .maybeSingle()

    const isEmployee = emp?.access_level === 'employee'
    const isHR = emp?.access_level &&
      ['owner', 'hr_admin', 'admin', 'hr', 'manager'].includes(emp.access_level)

    // Pure employees can only access employee portal + shared pages
    if (isEmployee &&
        !pathname.startsWith('/dashboard/employee') &&
        !pathname.startsWith('/dashboard/profile') &&
        !pathname.startsWith('/dashboard/messages')) {
      return NextResponse.redirect(new URL('/dashboard/employee/overview', request.url))
    }
    // HR/managers cannot access employee portal routes
    if (isHR && pathname.startsWith('/dashboard/employee')) {
      return NextResponse.redirect(new URL('/dashboard/overview', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
}
