# MISSION BRIEF — Middleware Fix Wave 1
## Code-Auth Employees Blocked by Server-Side Middleware

**Issued by:** KEES Architect  
**Date:** 2026-07-17  
**Priority:** CRITICAL — blocks ALL employee code-login access  
**Files to change:**
- `kaisync-web/src/proxy.ts`
- `kaisync-web/src/app/dashboard/employee/notifications/page.tsx`

**No migrations required.**

---

## Root Cause

`src/proxy.ts` is the active Next.js Edge Middleware (confirmed via `.next/dev/server/middleware.js` compiled build). It runs **server-side on every request**, before any client-side code.

The middleware checks for a Supabase JWT session:

```ts
if (!user && pathname.startsWith('/dashboard')) {
  url.pathname = '/auth/hr-sign-in'
  return NextResponse.redirect(url)  // ← kills ALL code-auth employees
}
```

Code-authenticated employees have **no Supabase JWT**. Their session is stored in `localStorage` as `kf_cs`. Server-side middleware cannot read `localStorage` — it is completely invisible to the Edge runtime. So every code-auth employee who logs in is caught by this check and hard-redirected to `/auth/hr-sign-in` before the client-side layout ever runs.

**This is why** employee login appears to "work" (no error shown) but then dumps the user on the HR sign-in page. The sign-in itself is correct — the middleware kills the navigation to the dashboard.

---

## Bugs Found

### Bug 1 (Critical) — Middleware blocks all code-auth employees from dashboard

**File:** `kaisync-web/src/proxy.ts` lines 29–33

```ts
if (!user && pathname.startsWith('/dashboard')) {
  const url = request.nextUrl.clone()
  url.pathname = '/auth/hr-sign-in'   // BUG A: wrong destination
  return NextResponse.redirect(url)    // BUG B: intercepts /dashboard/employee/* too
}
```

Two sub-bugs:
- **BUG A:** Redirect target is `/auth/hr-sign-in`. It should be `/auth/id-entry` (the role picker) for any unauthenticated user.
- **BUG B:** `/dashboard/employee/*` routes are intercepted. Employee portal routes MUST be allowed through without a JWT — their auth is handled client-side via `kf_cs`. Only HR/admin routes need server-side JWT protection.

### Bug 2 (Medium) — Employee notification click redirects to HR sign-in

**File:** `kaisync-web/src/app/dashboard/employee/notifications/page.tsx` line 239

```ts
if (n.notification_type === 'registration_approved' || n.notification_type === 'registration_rejected') {
  router.push('/auth/hr-sign-in')  // wrong page for an employee notification
  return
}
```

When an employee receives a `registration_approved` or `registration_rejected` notification and clicks it, they get sent to the HR sign-in page. For an employee, these notification types mean their own registration was approved/rejected. The correct action is to redirect them to their employee dashboard (or simply mark as read and stay).

---

## Fix Instructions

### Fix 1 — `kaisync-web/src/proxy.ts`

Replace the unauthenticated dashboard guard with a version that exempts employee routes:

**Current:**
```ts
if (!user && pathname.startsWith('/dashboard')) {
  const url = request.nextUrl.clone()
  url.pathname = '/auth/hr-sign-in'
  return NextResponse.redirect(url)
}
```

**Required:**
```ts
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
```

Also fix the access-level HR guard redirect target (line 57 in current file) to be consistent:

**Current:**
```ts
if (isHR && pathname.startsWith('/dashboard/employee')) {
  return NextResponse.redirect(new URL('/dashboard/overview', request.url))
}
```

This one is correct (redirects HR users away from employee portal to their own overview). No change needed here.

### Fix 2 — `kaisync-web/src/app/dashboard/employee/notifications/page.tsx`

Replace the wrong redirect on notification click:

**Current (line ~237–241):**
```ts
if (n.notification_type === 'registration_approved' || n.notification_type === 'registration_rejected') {
  router.push('/auth/hr-sign-in')
  return
}
```

**Required:**
```ts
if (n.notification_type === 'registration_approved' || n.notification_type === 'registration_rejected') {
  // Registration status notification — mark as read and stay on notifications
  if (!n.is_read) markRead(n)
  return
}
```

---

## Auth Flow After These Fixes

### Code-auth employee
1. `/auth/id-entry` → employee code login → `kf_cs` stored → `router.push('/dashboard/employee/attendance')`
2. **Middleware:** `!user && pathname.startsWith('/dashboard/employee')` → **allowed through** ✅
3. Client-side `dashboard/layout.tsx` → reads `kf_cs` → loads employee + company → renders `EmployeeSidebar`
4. Employee attendance page loads ✅

### JWT-auth HR user
1. `/auth/hr-sign-in` → `signInWithPassword` → JWT cookie set
2. **Middleware:** `user` is non-null → guard is skipped → allowed through ✅
3. Client-side layout → queries employee by `user_id` → `access_level = 'owner'` → renders `Sidebar`

### Unauthenticated HR route access
1. Visitor hits `/dashboard/overview` with no session
2. **Middleware:** `!user && pathname.startsWith('/dashboard')` → NOT a `/dashboard/employee` path → redirect to `/auth/id-entry` ✅

---

## Engineer Checklist

### `kaisync-web/src/proxy.ts`
- [ ] Inside the `!user && pathname.startsWith('/dashboard')` block, add early return for `/dashboard/employee` paths
- [ ] Change redirect destination from `/auth/hr-sign-in` → `/auth/id-entry`

### `kaisync-web/src/app/dashboard/employee/notifications/page.tsx`
- [ ] Replace `router.push('/auth/hr-sign-in')` with `if (!n.is_read) markRead(n)` for registration notification types

### Verify
- [ ] Log in as employee with company code `28` + login code `FN211956` → lands on employee dashboard ✅
- [ ] Visit `/dashboard/overview` in a fresh browser (no session) → redirected to `/auth/id-entry` (not `hr-sign-in`) ✅
- [ ] HR email/password login → lands on `/dashboard/overview` ✅

No migrations required. No schema changes.
