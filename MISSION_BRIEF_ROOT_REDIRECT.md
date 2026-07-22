# MISSION BRIEF — Root Redirect Wave 1
## Missing Root Page + Employee Portal Discoverability

**Issued by:** KEES Architect  
**Date:** 2026-07-17  
**Priority:** Critical (blocking employees from signing in)  
**Files to create/change:**
- `kaisync-web/src/app/page.tsx` ← CREATE (does not exist)
- `kaisync-web/next.config.ts` ← ADD root redirect (optional, belt-and-suspenders)

**No migrations required.**

---

## Root Cause

Visiting the app root URL (`/`) returns a **404** — there is no `src/app/page.tsx`. The `next.config.ts` has redirects for `/login`, `/about`, etc., but nothing for `/`.

Employees who open the app directly, or who have a URL bookmarked, must know to navigate to `/auth/id-entry` themselves. Most don't — they end up on `/auth/hr-sign-in` (either by guessing, or from a previous bookmark) and try to enter their company code + login code into an email/password form that cannot accept them.

**Confirmed via DB:** `employee_sign_in_with_code('28', 'FN211956')` returns a valid session correctly. The credentials are correct. The page is wrong.

---

## Bugs Found

### Bug 1 (Critical) — No root page; `/` is a 404

**File:** `kaisync-web/src/app/page.tsx` (missing)

There is no root page. Next.js App Router renders a 404 for `/`. Any user who opens the app URL without a specific path gets a blank 404 page.

### Bug 2 (High) — `hr-sign-in` "Employee?" link is too subtle

**File:** `kaisync-web/src/app/auth/hr-sign-in/page.tsx`

The current prompt is a small grey text line:
```
Employee? Use portal code
```

Employees who land on this page (because they don't know the correct URL) don't understand that they need a completely different page. The link is easy to miss. It should be a prominent button/card, not a small footnote.

---

## Fix Instructions

### Fix 1 — Create `kaisync-web/src/app/page.tsx`

Create this file with a server-side redirect to the role picker:

```tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/auth/id-entry')
}
```

That's the entire file. No client component needed — server-side redirect is instant.

### Fix 2 — Add root redirect to `next.config.ts` (belt-and-suspenders)

In the `redirects()` array, add:

```ts
{ source: '/', destination: '/auth/id-entry', permanent: false },
```

Full updated array:
```ts
async redirects() {
  return [
    { source: '/',          destination: '/auth/id-entry',  permanent: false },
    { source: '/login',     destination: '/auth/id-entry',  permanent: false },
    { source: '/about',     destination: '/about.html',     permanent: false },
    { source: '/features',  destination: '/features.html',  permanent: false },
    { source: '/pricing',   destination: '/pricing.html',   permanent: false },
    { source: '/contact',   destination: '/contact.html',   permanent: false },
    { source: '/download',  destination: '/download.html',  permanent: false },
    { source: '/releases',  destination: '/releases.html',  permanent: false },
  ]
},
```

### Fix 3 — Make the employee link on `hr-sign-in` more prominent

**File:** `kaisync-web/src/app/auth/hr-sign-in/page.tsx`

Replace the current small-text footnote section at the bottom:

**Current:**
```tsx
<div className="space-y-2 pt-2">
  <p className="text-center text-[13px] text-slate-500">
    Employee?{' '}
    <Link href="/auth/id-entry" className="text-blue-400 font-medium hover:text-blue-300 transition-colors">
      Use portal code
    </Link>
  </p>
  <p className="text-center text-[13px] text-slate-500">
    New to KaiSync?{' '}
    <Link href="/auth/hr-register" className="text-blue-400 font-medium hover:text-blue-300 transition-colors">
      Register your company
    </Link>
  </p>
</div>
```

**Required:**
```tsx
{/* Employee redirect card */}
<Link
  href="/auth/id-entry"
  className="flex items-center gap-3 p-3 rounded-xl border transition-all duration-200"
  style={{ backgroundColor: 'rgba(59,130,246,0.06)', borderColor: 'rgba(59,130,246,0.2)' }}
  onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = '#3b82f6' }}
  onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(59,130,246,0.2)' }}
>
  <span className="material-icons text-blue-400 text-[20px]">badge</span>
  <div>
    <p className="text-[13px] font-semibold text-white">Employee?</p>
    <p className="text-[11px] text-slate-400">Sign in with company code + login code</p>
  </div>
  <span className="material-icons text-slate-500 ml-auto text-[18px]">arrow_forward_ios</span>
</Link>

<p className="text-center text-[13px] text-slate-500">
  New to KaiSync?{' '}
  <Link href="/auth/hr-register" className="text-blue-400 font-medium hover:text-blue-300 transition-colors">
    Register your company
  </Link>
</p>
```

---

## Engineer Checklist

- [ ] Create `kaisync-web/src/app/page.tsx` with server-side redirect to `/auth/id-entry`
- [ ] Add `{ source: '/', destination: '/auth/id-entry', permanent: false }` to `next.config.ts`
- [ ] Replace the "Employee?" footnote in `hr-sign-in/page.tsx` with the prominent card above
- [ ] Verify: visiting `/` redirects to the role picker
- [ ] Verify: employee credentials `28` + `FN211956` sign in successfully via the Employee portal

No migrations required. No schema changes.
