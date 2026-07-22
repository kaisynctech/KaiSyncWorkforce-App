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

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    // Network error or invalid token — treat as unauthenticated and let
    // client-side auth handle it rather than crashing the middleware.
  }
  const pathname = request.nextUrl.pathname

  // Client / contractor portals use code-auth (localStorage), not Supabase JWT.
  if (
    pathname.startsWith('/client-portal')
    || pathname.startsWith('/contractor-portal')
  ) {
    return supabaseResponse
  }

  if (!user && pathname.startsWith('/dashboard')) {
    // Code-auth sessions live in localStorage (kf_cs) and are invisible to middleware.
    // Allow dashboard through; dashboard/layout.tsx enforces JWT or valid code session.
    return supabaseResponse
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
