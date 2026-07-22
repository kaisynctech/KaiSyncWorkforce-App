# KaiFlow Web Platform — Phase 1 Architecture Specification

**Version:** 1.0  
**Date:** 2026-07-09  
**Scope:** Auth flow + HR Dashboard + Employees + HR Settings (~15 screens)  
**Tech stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase JS client  
**Design mandate:** Pixel-faithful parity with the MAUI Windows/Android app. Same colours, same typography, same spacing, same component behaviour. The only difference is medium — browser instead of native.

---

## 1. Project Scaffold

### 1.1 Initialisation

```bash
npx create-next-app@latest kaisync-web \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*"

cd kaisync-web
npm install @supabase/supabase-js @supabase/ssr
npm install lucide-react clsx tailwind-merge
```

### 1.2 Directory Structure

```
src/
├── app/
│   ├── layout.tsx                   # Root layout — fonts, globals
│   ├── page.tsx                     # Redirects → /auth/id-entry
│   ├── auth/
│   │   ├── id-entry/page.tsx        # Company code entry
│   │   ├── hr-sign-in/page.tsx
│   │   ├── hr-register/page.tsx
│   │   ├── hr-register-verify/page.tsx
│   │   ├── hr-register-company/page.tsx
│   │   └── layout.tsx               # Auth layout (centred card)
│   └── dashboard/
│       ├── layout.tsx               # Sidebar + top bar shell
│       ├── overview/page.tsx        # Tab 0: Overview
│       ├── employees/page.tsx       # Tab 2: Employees / Teams / Leave / Pending
│       ├── leave/page.tsx           # Tab: Leave
│       ├── attendance/page.tsx      # Tab: Attendance
│       ├── jobs/page.tsx
│       ├── payroll/page.tsx
│       └── settings/page.tsx        # HR Settings
├── components/
│   ├── auth/                        # AuthCard, PasswordField, OtpInput
│   ├── sidebar/                     # Sidebar, SidebarItem, NavBadge
│   ├── dashboard/                   # KpiCard, WelcomeBanner, AttendanceCard
│   ├── employees/                   # EmployeeTable, LeaveList, PendingTable
│   ├── settings/                    # ModuleToggle, BranchCard, ExportPanel
│   └── ui/                          # Button, Input, Label, Badge, Divider, SearchBar
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # Browser Supabase client
│   │   ├── server.ts                # Server Supabase client (RSC)
│   │   └── middleware.ts            # Session refresh middleware
│   └── utils.ts                     # cn(), formatDate(), etc.
├── types/
│   └── database.ts                  # Generated from Supabase — supabase gen types
└── middleware.ts                    # Auth guard — redirect unauthenticated to /auth/id-entry
```

### 1.3 Environment Variables

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://vcivtjwreybaxgtdhtou.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
```

### 1.4 Middleware (auth guard)

```typescript
// src/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // Refresh session cookie on every request
  // If no session and path is under /dashboard → redirect to /auth/hr-sign-in
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

---

## 2. Design System — Tailwind Configuration

The Tailwind config **exactly mirrors** `Colors.xaml`, `DesignTokens.xaml`, and `Styles.xaml`. All colour names are kept 1:1 with the XAML keys so the codebase stays self-documenting.

### 2.1 `tailwind.config.ts`

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ── Colours (exact from Colors.xaml) ──────────────────────────
      colors: {
        background: '#F3F5FB',        // BackgroundDark
        surface: '#FFFFFF',           // SurfaceCard / SurfaceDark
        'surface-elevated': '#F9FAFB',// SurfaceElevated
        primary: {
          DEFAULT: '#3B82F6',         // Primary
          dark:    '#1D4ED8',         // PrimaryDark
          light:   '#60A5FA',         // PrimaryLight
        },
        accent: '#3B82F6',
        'accent-light': '#93C5FD',
        error:   '#EF4444',
        'error-dark': '#FEE2E2',
        success: '#22C55E',
        'success-dark': '#DCFCE7',
        warning: '#F59E0B',
        'warning-dark': '#FEF3C7',
        text: {
          primary:   '#111827',       // TextPrimary
          secondary: '#6B7280',       // TextSecondary
          disabled:  '#9CA3AF',       // TextDisabled
          inverse:   '#FFFFFF',
        },
        divider: '#E5E7EB',
        border:  '#D1D5DB',
        sidebar: {
          bg:     '#0F172A',          // SidebarBackground
          active: '#DBEAFE',          // SidebarActive
        },
        // Chart palette
        chart1: '#3B82F6',
        chart2: '#22C55E',
        chart3: '#F59E0B',
        chart4: '#8B5CF6',
        chart5: '#EC4899',
        chart6: '#14B8A6',
      },
      // ── Spacing (8pt grid from DesignTokens.xaml) ─────────────────
      spacing: {
        'xs':  '4px',   // SpaceXs
        'sm':  '8px',   // SpaceSm
        'md':  '12px',  // SpaceMd
        'lg':  '16px',  // SpaceLg
        'xl':  '24px',  // SpaceXl
        'xxl': '32px',  // SpaceXxl
        '3xl': '48px',  // Space3Xl
      },
      // ── Border radius (DesignTokens.xaml) ─────────────────────────
      borderRadius: {
        'sm':   '8px',   // RadiusSm
        'md':   '12px',  // RadiusMd
        'lg':   '16px',  // RadiusLg
        'xl':   '20px',  // RadiusXl
        'pill': '999px', // RadiusPill
      },
      // ── Typography (Styles.xaml — Poppins) ────────────────────────
      fontFamily: {
        poppins: ['Poppins', 'sans-serif'],
      },
      fontSize: {
        // HeadlineLarge: 28/Bold, HeadlineMedium: 22/Bold, HeadlineSmall: 18/SemiBold
        'headline-lg': ['28px', { lineHeight: '1.2', fontWeight: '700' }],
        'headline-md': ['22px', { lineHeight: '1.2', fontWeight: '700' }],
        'headline-sm': ['18px', { lineHeight: '1.3', fontWeight: '600' }],
        // Body: 15/Medium, 14/Regular, 13/Regular
        'body-lg':  ['15px', { lineHeight: '1.5', fontWeight: '500' }],
        'body-md':  ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        'body-sm':  ['13px', { lineHeight: '1.5', fontWeight: '400' }],
        // Caption/Label
        'caption':       ['12px', { lineHeight: '1.4', fontWeight: '400' }],
        'label-section': ['11px', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '0.05em' }],
        'label-field':   ['13px', { lineHeight: '1.4', fontWeight: '600' }],
      },
    },
  },
  plugins: [],
}

export default config
```

### 2.2 Font Loading (`src/app/layout.tsx`)

```typescript
import { Poppins } from 'next/font/google'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className={`${poppins.variable} font-poppins bg-background text-text-primary`}>
        {children}
      </body>
    </html>
  )
}
```

### 2.3 Shared UI Primitives

These are the direct equivalents of the XAML style resources.

#### Button variants

| XAML Style        | Web equivalent                                                                 |
|-------------------|--------------------------------------------------------------------------------|
| PrimaryButton     | `bg-primary text-white rounded-md h-[52px] font-semibold px-4`                |
| OutlinedButton    | `border border-primary text-primary bg-transparent rounded-md h-[52px]`       |
| SecondaryButton   | `bg-white border border-divider rounded-md h-[44px] text-text-primary`        |
| DangerButton      | `bg-error text-white rounded-md h-[52px] font-semibold`                       |
| TextButton        | `bg-transparent text-text-secondary font-medium`                              |

#### Input (DarkEntry equivalent)

```tsx
<input className="w-full h-12 px-3 rounded-sm bg-surface-elevated text-body-md 
                  text-text-primary border border-border placeholder-text-disabled
                  focus:outline-none focus:ring-2 focus:ring-primary/40" />
```

#### Card (CardFrame equivalent)

```tsx
<div className="bg-surface rounded-lg border border-divider p-4 shadow-sm">
```

#### DataTable header cell

```tsx
<th className="text-[12px] font-semibold text-text-secondary uppercase tracking-wide py-[10px] px-[14px]">
```

#### DataTable body cell

```tsx
<td className="text-[13px] font-medium text-text-primary min-h-[44px] px-[14px] py-[10px]">
```

#### Section label (LabelSection equivalent)

```tsx
<p className="text-label-section text-text-secondary uppercase tracking-widest">
```

---

## 3. Routing Structure

Mirrors the MAUI `AppShell.xaml` route registration exactly.

```
/                              → redirect → /auth/id-entry
/auth/id-entry                 → IdEntryPage      (company code entry)
/auth/hr-sign-in               → HrSignInPage
/auth/hr-register              → HrRegisterPage
/auth/hr-register-verify       → HrRegisterVerifyCodePage
/auth/hr-register-company      → HrRegisterCompanyDetailsPage
/dashboard                     → redirect → /dashboard/overview
/dashboard/overview            → HrDashboard Tab 0: Overview
/dashboard/my-profile          → HrDashboard Tab: My Profile
/dashboard/employees           → HrDashboard Tab: Employees (sub-tabs: Employees / Teams / Templates)
/dashboard/leave               → HrDashboard Tab: Leave
/dashboard/attendance          → HrDashboard Tab: Attendance
/dashboard/jobs                → HrDashboard Tab: Jobs
/dashboard/projects            → HrDashboard Tab: Projects
/dashboard/payroll             → HrDashboard Tab: Payroll
/dashboard/messages            → HrDashboard Tab: Messages
/dashboard/settings            → HrSettingsPage
```

All `/dashboard/*` routes are wrapped in the `DashboardLayout` which renders the sidebar + top bar.

---

## 4. Auth Screens

All auth screens share the same layout: `bg-background`, vertically and horizontally centred content, `max-width: 480px`, using a white card with `border-radius: 24px`, `padding: 24px`.

### 4.1 Auth Layout (`src/app/auth/layout.tsx`)

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-8">
      <div className="w-full max-w-[480px]">
        {children}
      </div>
    </div>
  )
}
```

### 4.2 HR Sign-In (`/auth/hr-sign-in`)

**Source:** `Views/Auth/HrSignInPage.xaml`

Layout — top to bottom:
1. **Brand label:** `"KaiSync Workforce"` — `text-[20px] font-bold text-center text-text-primary`, `mb-6`
2. **Card** (`bg-white rounded-[20px] border border-divider p-6 shadow-none`):
   - **Email field:** label `"Email address"` (LabelField), then `<input type="email">` (DarkEntry)
   - **Password field:** label `"Password"` (LabelField), then password input with show/hide toggle button on the right (60px wide text button showing eye icon — `👁` or `EyeOff`)
   - **Error label:** `text-[13px] text-error font-regular` — hidden when no error
   - **"Sign in as HR"** — PrimaryButton, full width
   - **ActivityIndicator:** `<div className="flex justify-center"><Spinner color="primary" /></div>` — visible only when loading
   - **"New company? Register here"** — OutlinedButton, full width, `mt-2`, navigates to `/auth/hr-register`

Password show/hide pattern:
```tsx
<div className="relative">
  <input type={showPassword ? 'text' : 'password'} className="w-full h-12 ..." />
  <button
    type="button"
    onClick={() => setShowPassword(p => !p)}
    className="absolute right-0 top-0 h-12 w-[60px] text-text-secondary text-sm"
  >
    {showPassword ? 'Hide' : 'Show'}
  </button>
</div>
```

**Supabase call:**
```typescript
await supabase.auth.signInWithPassword({ email, password })
// On success → router.push('/dashboard/overview')
```

### 4.3 HR Register (`/auth/hr-register`)

**Source:** `Views/Auth/HrRegisterPage.xaml`

Layout — `bg-background`, no card wrapper, `padding: 32px`, `spacing: 16px`:
1. **Headline:** `"Create Company Account"` — HeadlineMedium (22px bold)
2. **Email field** — DarkEntry, label `"Email address"`
3. **Password field** — DarkEntry with show/hide toggle, label `"Password"`
4. **Confirm password field** — DarkEntry with show/hide toggle, label `"Confirm password"`
5. **Error label** — `text-error text-[13px]`, hidden when no error
6. **"Continue"** — PrimaryButton, full width
7. **ActivityIndicator** — centered, visible when loading

**Supabase call:**
```typescript
await supabase.auth.signUp({ email, password })
// On success → router.push('/auth/hr-register-verify')
// Pass email via query param or session storage (not localStorage)
```

### 4.4 HR Register Verify Code (`/auth/hr-register-verify`)

**Source:** `Views/Auth/HrRegisterVerifyCodePage.xaml`

Layout — centred, max-width 480px:
1. **"KaiSync Workforce"** — 22px bold, centered
2. **"Check your email"** — 20px bold, centered, `mt-2`
3. **Subtext:** `"We sent a verification code to {email}"` — 13px regular, text-secondary, centered, `mt-1.5`
4. **Card** (`bg-white rounded-[24px] border border-divider p-6`, `mt-7`):
   - **"Verification code"** field — LabelField + numeric input (`inputMode="numeric"`, DarkEntry, placeholder `"6-digit code from your email"`)
   - **Error label** — text-error, hidden when no error
   - **"Continue"** — PrimaryButton, full width
   - **"Resend code"** — text link button, `text-primary font-semibold text-[13px]`, centered
   - **"Use a different email"** — text button, `text-text-secondary text-[12px]`, centered
   - **ActivityIndicator** — centered, visible when loading

**Supabase call:**
```typescript
await supabase.auth.verifyOtp({ email, token: code, type: 'signup' })
// On success → router.push('/auth/hr-register-company')
```

### 4.5 HR Register Company Details (`/auth/hr-register-company`)

**Source:** `Views/Auth/HrRegisterCompanyDetailsPage.xaml`

Layout — centred, max-width 480px:
1. **"KaiSync Workforce"** — 22px bold, centered
2. **"Set up your company"** — 20px bold, centered, `mt-2`
3. **Subtext:** `"Your company code will be generated automatically."` — 13px regular, text-secondary, centered
4. **Card** (`bg-white rounded-[24px] border border-divider p-6`, `mt-7`):
   - **"Company name"** — LabelField + Entry (`placeholder="e.g. Acme Corporation"`)
   - **"Your first name"** — LabelField + Entry
   - **"Your last name (optional)"** — LabelField + Entry
   - **"Your role in the company"** — LabelField, then **2-column toggle button group:**
     - `"Company Owner"` — left button
     - `"HR / Admin"` — right button
     - Active state: `bg-primary text-white`, inactive: `bg-[#F3F4F6] text-text-secondary`
     - Both: `rounded-[10px] h-10 font-medium text-[13px]`
     - Below, when HR/Admin selected: `"You can assign the actual owner later from HR Settings."` — 12px regular text-secondary
   - **Error label** — text-error
   - **"Create company"** — PrimaryButton, full width
   - **ActivityIndicator** — centered, visible when loading

**Supabase call:**  
Call the existing `create_company` RPC or INSERT into companies directly, then insert company_relationships row, then `router.push('/dashboard/overview')`.

---

## 5. Dashboard Layout

**Source:** `Views/Hr/HrDashboardPage.xaml`, `Views/Shared/SidebarView.xaml`

The dashboard is a full-viewport two-column grid: sidebar on the left, content area on the right.

### 5.1 Dashboard Layout Component (`src/app/dashboard/layout.tsx`)

```tsx
<div className="flex h-screen overflow-hidden bg-[#0F172A]">
  <Sidebar />
  <div className="flex flex-col flex-1 bg-background overflow-hidden">
    <TopBar />
    <main className="flex-1 overflow-y-auto">
      {children}
    </main>
  </div>
</div>
```

### 5.2 Sidebar (`src/components/sidebar/Sidebar.tsx`)

**Source:** `Views/Shared/SidebarView.xaml`

The sidebar has three states — **Expanded** (220px), **Collapsed** (56px — icons only), **Hidden** (0px). State persists in `useState` (not localStorage — not supported in this environment). Default: Expanded.

**Background:** `bg-[#0F172A]` (SidebarBackground)

**Branding block** (Expanded only):
```tsx
<div className="px-5 pt-7 pb-4">
  <span className="font-bold text-[21px] text-white">KaiSync</span>
  <span className="block font-regular text-[11px] text-[#64748B] -mt-0.5">Workforce</span>
  <div className="h-px bg-[#1E293B] mt-3.5 mb-2.5" />
  {/* Company name in primary-light, code in #475569 */}
  <span className="font-semibold text-[12px] text-[#60A5FA] truncate block">{companyName}</span>
  <span className="font-regular text-[11px] text-[#475569]">Code: {companyCode}</span>
</div>
```

**Navigation items** — scrollable, `px-[10px] space-y-[1px]`:

Each nav item follows this pattern:
```tsx
<button
  onClick={...}
  className={cn(
    "w-full flex items-center gap-[10px] px-3 py-[10px] rounded-sm transition-colors",
    isActive ? "bg-[#1E3A5F]" : "bg-transparent hover:bg-white/5"
  )}
>
  <MaterialIcon
    code={iconCode}
    size={19}
    color={isActive ? '#60A5FA' : '#64748B'}
  />
  {isSidebarExpanded && (
    <span className={cn("text-[13px] font-medium", isActive ? "text-white" : "text-[#94A3B8]")}>
      {label}
    </span>
  )}
  {badge && <NavBadge count={badge} color={badgeColor} />}
</button>
```

**Section headings** (Expanded only):
```tsx
<p className="text-[10px] font-medium text-[#475569] tracking-[0.08em] ml-3 mt-3 mb-0.5 uppercase">
  {sectionName}
</p>
```

**Full nav item list** (in order, exactly matching SidebarView.xaml):

*Top items (no section heading):*
- Toggle sidebar — `menu` icon (cycles Expanded → Collapsed → Expanded)
- Overview — `dashboard` icon (`&#xE871;`)
- My Profile — `person` icon (`&#xE853;`)
- Messages — `chat_bubble` icon (`&#xE0BF;`) — with badge count (blue #3B82F6)

*Section: PEOPLE & WORK*
- Employees — `group` icon (`&#xE7EF;`) — shown when `ShowEmployeesNav`
- Leave — `event` icon (`&#xE916;`) — badge (amber #F59E0B) with pending count
- Attendance — `fingerprint` icon (`&#xE192;`)
- Jobs — `work` icon (`&#xE8F9;`) — badge (blue) with active job count
- Projects — `folder` icon (`&#xE2C8;`) — badge (blue) with project count

*Section: OPERATIONS*
- Payroll — `payment` icon (`&#xE8A1;`) — badge (amber) with pending payment count
- Finance — `account_balance` icon
- Contractors — `engineering` icon (`&#xE7EE;`)
- Clients — `face` icon (`&#xE7FD;`)
- Inventory — `inventory` icon (`&#xE8D3;`)
- Suppliers, Assets, Properties (same pattern)

*Section: ANALYTICS*
- Incidents — badge (red #EF4444)
- Reports
- Scheduling

*Section: COMMS*
- Notifications
- Activity Log — owner-only

*Section: ADMIN*
- Settings

**Note on Material Icons for web:** Use Google Material Icons font or `@material-icons/font` npm package. Load via `<link>` in `layout.tsx`:
```html
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
```
Then render with: `<span className="material-icons" style={{fontSize: 19}}>dashboard</span>`

### 5.3 Top Bar

**Source:** Top `Grid Row="0"` in HrDashboardPage.xaml — height 56px, `bg-white`, bottom border `border-b border-divider`

```tsx
<header className="h-14 bg-surface border-b border-divider flex items-center px-0 pr-6">
  {/* Sidebar toggle — 56px wide, icon only */}
  <button className="w-14 h-14 flex items-center justify-center text-text-secondary">
    <span className="material-icons text-[20px]">{sidebarIcon}</span>
  </button>
  {/* Active tab title — HeadlineSmall */}
  <h1 className="text-headline-sm ml-1 flex-1">{activeTabTitle}</h1>
  {/* Current user chip — shown when employee resolved */}
  <div className="bg-surface-elevated border border-divider rounded-sm px-2 py-1">
    <span className="text-[12px] font-medium text-text-secondary">{currentEmployee?.fullName}</span>
  </div>
</header>
```

---

## 6. HR Dashboard — Overview Tab (`/dashboard/overview`)

**Source:** `HrDashboardPage.xaml` — Tab 0: Overview (line 51–381)

`<ScrollView>` equivalent: `<div className="p-6 space-y-[18px] overflow-y-auto">`

### 6.1 Subscription Banner

Shown when `showSubscriptionBanner`:
```tsx
<div className="rounded-[10px] px-[14px] py-3 bg-[#422006]">
  <p className="text-[12px] font-medium text-[#FCD34D]">{subscriptionBannerText}</p>
</div>
```

### 6.2 Onboarding Prompt

Shown when `showOnboardingPrompt`:
```tsx
<div className="rounded-[10px] px-[14px] py-3 bg-[#1E3A5F] flex items-center justify-between">
  <p className="text-[12px] font-medium text-[#93C5FD]">Complete your company setup wizard to unlock all features.</p>
  <button className="bg-primary text-white text-[11px] h-8 px-3 rounded-sm font-medium ml-4 whitespace-nowrap">
    Start setup
  </button>
</div>
```

### 6.3 Welcome Banner

Dark gradient card, `rounded-[14px] px-5 py-[18px]`, background: `linear-gradient(135deg, #1E3A5F 0%, #0F172A 100%)`:
```tsx
<div className="rounded-[14px] px-5 py-[18px] flex justify-between items-center"
     style={{background: 'linear-gradient(135deg, #1E3A5F 0%, #0F172A 100%)'}}>
  <div className="space-y-1">
    <p className="text-[13px] text-[#94A3B8]">{timeGreeting}</p>
    <p className="text-[22px] font-bold text-white">{employeeName}</p>
    <p className="text-[13px] font-medium text-[#60A5FA]">{companyName}</p>
  </div>
  <p className="text-[12px] text-[#94A3B8] text-right">{todayDate}</p>
</div>
```

### 6.4 Self-Punch Card

Dark gradient card, `rounded-[14px] px-[18px] py-[14px]`, background: `linear-gradient(135deg, #0F172A 0%, #1E3A5F 100%)`:

```tsx
<div className="rounded-[14px] px-[18px] py-[14px] flex justify-between items-center gap-4"
     style={{background: 'linear-gradient(135deg, #0F172A 0%, #1E3A5F 100%)'}}>
  <div className="space-y-1 flex-1">
    <div className="flex items-center gap-2">
      {/* Status dot: #22C55E (clocked in) or #64748B (out) */}
      <div className={cn("w-[10px] h-[10px] rounded-full", clockedIn ? 'bg-[#22C55E]' : 'bg-[#64748B]')} />
      <span className="text-[14px] font-semibold text-white">
        {clockedIn ? 'You are Clocked In' : 'You are Clocked Out'}
      </span>
    </div>
    <p className="text-[12px] text-[#94A3B8]">Today: {todayHours}</p>
    {punchAddress && <p className="text-[11px] text-[#64748B] truncate max-w-[200px]">{punchAddress}</p>}
    <button className="text-[12px] font-medium text-[#60A5FA] mt-0.5">
      Clock in/out for my team →
    </button>
  </div>
  <button
    className={cn(
      "h-11 px-[18px] rounded-[10px] font-semibold text-[13px] text-white whitespace-nowrap",
      clockedIn ? 'bg-error' : 'bg-success'
    )}
  >
    {clockedIn ? 'Clock Out' : 'Clock In'}
  </button>
</div>
```

### 6.5 KPI Rows

Two rows of 3 KPI cards each. Each card: dark gradient (`#0F172A → #1E3A5F`), `rounded-[14px] p-4`, 44px icon circle, 24px bold number, 11px regular label.

**KPI Row 1:**
- Employees — icon `group` (#60A5FA on blue-30% bg)
- Clocked In — icon `manage_accounts` (#4ADE80 on green-30% bg)
- Active Jobs — icon `work` (#FCD34D on amber-30% bg)

**KPI Row 2:**
- Pending Leave — icon `event_busy` (#C084FC on purple-30% bg)
- Open Incidents — icon `warning` (#FCA5A5 on red-30% bg)
- Pending Pay — icon `payment` (#60A5FA on blue-30% bg)

```tsx
<div className="grid grid-cols-3 gap-[14px]">
  {kpis.map(kpi => (
    <div key={kpi.label}
         className="rounded-[14px] p-4 flex items-center gap-3"
         style={{background: 'linear-gradient(135deg, #0F172A 0%, #1E3A5F 100%)'}}>
      <div className={cn("w-11 h-11 rounded-full flex items-center justify-center", kpi.iconBg)}>
        <span className="material-icons text-[22px]" style={{color: kpi.iconColor}}>{kpi.icon}</span>
      </div>
      <div>
        <p className="text-[24px] font-bold text-white leading-none">{kpi.value}</p>
        <p className="text-[11px] text-[#94A3B8] mt-0.5">{kpi.label}</p>
      </div>
    </div>
  ))}
</div>
```

### 6.6 Today's Attendance Card

White card (`bg-surface border border-divider rounded-lg p-5`):

- Section label: `"TODAY'S ATTENDANCE"` + right-aligned `{clockedIn} / {total}` (clocked count in primary)
- Progress bar: `h-[6px] rounded-full bg-divider` with inner `bg-primary` at attendance %
- Label: `"employees currently clocked in"` — 12px regular text-secondary
- Divider + on-leave row (green #DCFCE7 badge + names)
- Divider + absent row (amber #FEF3C7 badge + names)
- Divider + "NOT SIGNED IN TODAY" list with `Mark Absent` button per employee

### 6.7 Quick Actions Card

White card:
- Section label: `"QUICK ACTIONS"`
- Row of buttons: `"+ Add Employee"` (primary), `"+ New Job"` (bg `#1E293B` text-white)

---

## 7. HR Dashboard — Employees Tab (`/dashboard/employees`)

**Source:** `HrDashboardPage.xaml` Tab 2 (lines 455–707) and `Views/Hr/HrEmployeesPage.xaml`

> **Note:** The MAUI app has the Employees view in two places: as a tab inside HrDashboardPage (overview context) and as a standalone HrEmployeesPage (deeper management). The web consolidates these into `/dashboard/employees` as the primary employees route. Behaviour matches HrEmployeesPage.

### 7.1 Sub-tab Toggle

Segmented control: `Employees | Teams | Leave | Pending`

```tsx
<div className="bg-surface rounded-[10px] p-[3px] inline-flex gap-0.5">
  {tabs.map(tab => (
    <button
      key={tab.value}
      className={cn(
        "px-3 h-[36px] rounded-sm font-semibold text-[12px] transition-colors",
        activeTab === tab.value
          ? "bg-primary text-white"
          : "bg-transparent text-text-secondary"
      )}
    >
      {tab.label}
      {tab.badge > 0 && (
        <span className={cn("ml-1 text-[10px] font-bold px-1 py-0.5 rounded-full text-white", tab.badgeColor)}>
          {tab.badge}
        </span>
      )}
    </button>
  ))}
</div>
```

Badge colours: Leave → amber `bg-warning`, Pending → red `bg-error`

### 7.2 Branch Filter

```tsx
<div className="flex items-center gap-2 bg-surface border border-divider rounded-lg px-2">
  <span className="text-caption text-text-secondary">Branch:</span>
  <select className="flex-1 bg-transparent text-text-primary py-2 outline-none text-body-md">
    <option>All Branches</option>
    {branches.map(b => <option key={b.id}>{b.name}</option>)}
  </select>
</div>
```

### 7.3 Employees Sub-tab

**Header controls** (flex wrap, justify-end):
- Search: `<input placeholder="Search employees…" className="... bg-surface-elevated" />`
- Type filter pills: `All types | Permanent | Contract | Part-Time | Student`
  - Active: `bg-primary text-white rounded-full h-9 px-3 text-[11px]`
  - Inactive: `bg-[#E5E7EB] text-[#374151]`
- Action buttons: `Import` (surface-elevated + border) + `+ Add` (primary), both `h-9 rounded-[10px]`

**Employee table:**

| Col | Header | Width |
|-----|--------|-------|
| 0 | Name | 2fr |
| 1 | Position | 1fr |
| 2 | Branch | 1fr |
| 3 | Role | 100px |
| 4 | Type | 88px |

- Header row: `bg-surface-elevated text-label-section text-text-secondary py-[10px] px-[14px]`
- Body rows: `bg-surface hover:bg-surface-elevated cursor-pointer`, divider between rows
- Name cell: initials avatar (28×28, `bg-primary text-white rounded-full`) + name in primary colour
- Click row → navigate to employee detail page (Phase 2 scope)
- Row actions on hover: `Edit` + `Delete` buttons appear on right (equivalent to MAUI SwipeView)

### 7.4 Teams Sub-tab

- `"+ Create Team"` primary button header
- Card list: each card `bg-surface border border-divider rounded-lg p-4`, name (BodyLarge) + description (Caption) + member count badge (SidebarActive bg, primary text)

### 7.5 Leave Sub-tab

**On-leave-today banner:** `bg-[#DCFCE7] border border-[#86EFAC] rounded-[10px] p-3` with bullet list

**Leave requests list** — compact row per request:
- 32px initials circle (coloured by leave type)
- Employee name (13px semibold) + period (11px secondary)
- Right: leave type badge + days text
- If pending: `"✓ Approve"` (green) + `"✕ Reject"` (red) — 28px height buttons
- If not pending: status text coloured by status (approved=green, declined=red)
- Divider line at bottom of each row

**Status filter pills:** `Pending | Approved | Declined | All`

### 7.6 Pending Sub-tab

**Banner** (when has pending): amber `bg-warning-dark border border-[#FCD34D]` — "Pending Employee Requests" + `"Approve All"` button

**Pending table:**

| Col | Header |
|-----|--------|
| 0 | Name (2fr) |
| 1 | Email (1fr) |
| 2 | Requested (110px) |
| 3 | Actions |

Actions per row: `Approve` (green, h-[30px]) + `Reject` (red, h-[30px])

---

## 8. HR Dashboard — Leave Tab (`/dashboard/leave`)

**Source:** `HrDashboardPage.xaml` Tab 20 (lines 710–795)

- Header: `"Leave requests and approvals"` (caption) + pending count badge (amber)
- Search: placeholder `"Search by employee or leave type…"`
- List: same compact leave row format as §7.5

---

## 9. HR Dashboard — Attendance Tab (`/dashboard/attendance`)

**Source:** `HrDashboardPage.xaml` Tab 2 (lines 798–897)

**Period filter pills (horizontal scroll):**
```
Today | Past Week | Past Month | All | Custom
```
Active: `bg-primary text-white rounded-full`, Custom active: `bg-[#8B5CF6]`

**Custom date range row** (shown when period = "custom"):
- From date picker + To date picker (both in `border border-divider rounded-sm` wrappers)
- `"Apply"` button — primary

**Search + export row:**
- Search (fills remaining width)
- `"Excel"` button — `bg-[#16A34A] text-white`
- `"PDF"` button — `bg-[#DC2626] text-white`

**KPI summary (2 cols):**
- Total Hours — KpiNumber (24px bold primary) + "Total Hours" (11px secondary)
- Sessions count

**Attendance table:** `ShowEmployeeColumn=true`, session rows with clock in/out times, duration, location.

---

## 10. HR Dashboard — Payroll Tab (`/dashboard/payroll`)

**Source:** `HrDashboardPage.xaml` lines 931–994

- Header: `"Payment approvals"` (caption) + `"Full Payroll View"` primary button
- Horizontally scrollable table (min 720px wide):

| Col | Header | Width |
|-----|--------|-------|
| Employee | 150px |
| Period | 120px |
| Gross | 85px right-aligned |
| Deduct. | 85px right-aligned |
| Net | 85px right-aligned (primary colour) |
| Status | 80px |

---

## 11. HR Settings (`/dashboard/settings`)

**Source:** `Views/Hr/HrSettingsPage.xaml`

Single-column scrollable page, `padding: 16px`, `gap: 16px`.

### 11.1 Company Info Header Card

```tsx
<div className="bg-surface border border-divider rounded-lg p-4">
  <h2 className="text-headline-md">{company.name}</h2>
  <div className="flex items-center justify-between mt-2">
    <span className="text-body-sm text-text-secondary">Company Code: {company.code}</span>
    <button className="text-primary text-[12px] font-medium bg-surface-elevated h-8 px-3 rounded-sm">Copy</button>
  </div>
  <p className="text-body-sm text-text-secondary mt-1">Plan: {company.planCode}</p>
</div>
```

### 11.2 Feature Modules Card

- Section label: `"FEATURE MODULES"`
- Description paragraph
- `Enable all` + `Disable all` secondary buttons (right-aligned)
- Divider
- Module list: each row `flex justify-between items-center py-[10px]`:
  - Left: module title (BodyLarge) + description (Caption, text-secondary)
  - Right: `<Toggle>` (switch — use a custom React toggle component matching MAUI Switch appearance with `OnColor=#3B82F6`)
  - Bottom divider
- `"Open Payroll Settings"` text-style button (shown when payroll enabled)
- `"Save Module Settings"` PrimaryButton

### 11.3 Company Details Card

- Section label: `"COMPANY DETAILS"`
- Left: company name + email + phone + address (stacked, caption)
- Right: `"Edit"` TextButton (top-aligned)
- Clicking Edit → modal or navigate to edit form

### 11.4 Location Rules Card (Owner/Admin only)

- Section label: `"LOCATION RULES"`
- Description paragraph
- Toggle: `"Enforce branch sign-in radius"` — full-width flex row
- Radius picker: 3 buttons `200 m | 500 m | 1 km` (grid-cols-3)
- Selected radius display
- `"Save Location Rules"` PrimaryButton

### 11.5 Branches Card (Owner/Admin only)

- Section label: `"BRANCHES"` + `"+ Add"` button (right)
- Branch list: each branch card `p-3` with name + location status + `Edit` TextButton + `✕` error text delete button

### 11.6 Leave Policies Card

- Section label: `"LEAVE POLICIES"`
- Description
- 2-row grid: `Annual Leave (days/year)` label + numeric input (80px wide), `Sick Leave (days/year)` same
- `"Save Leave Policies"` PrimaryButton

### 11.7 Subscription Plan Card (Owner/Admin only)

- Section label: `"SUBSCRIPTION PLAN"`
- Plan display box (`bg-surface-elevated border border-divider rounded-[10px] p-3`):
  - Current plan name + "Active subscription" (success colour) or "Inactive or trial" (warning)
- Note: `"Plan changes are handled by KaiFlow billing — not from this screen."`
- `"Request plan change"` SecondaryButton

### 11.8 HR Access & Roles Card

- Section label: `"HR ACCESS & ROLES"`
- Employee list: each row — 44px initials circle (SidebarActive bg, primary text) + name + position + access level badge (surface-elevated bg, primary text, border-divider)

### 11.9 Security Card

- Section label: `"SECURITY"`
- `"Change Password"` button — `bg-surface-elevated text-text-primary rounded-[10px] h-11 w-full`

### 11.10 Feedback Card

- Section label: `"FEEDBACK"`
- Description
- `"Send Feedback"` SecondaryButton

### 11.11 Data Snapshot Card (Owner/Admin only)

- Section label: `"DATA SNAPSHOT"`
- Description: `"This snapshot records a count of your company's records. It does not contain your actual data and cannot be used to restore your account."`
- `"Take Snapshot"` button (`bg-surface-elevated`)
- Spinner when busy
- Past snapshots list when any exist (date + `"Metadata only — not restorable"`)

### 11.12 Data Export Card (Owner/Admin only)

- Section label: `"DATA EXPORT"`
- Description + warning line (`⚠ Export includes sensitive data...` in warning colour)
- **State-driven content:**
  - **Idle:** `"Request Export"` button (surface-elevated)
  - **Processing:** spinner + `"Generating export…"`
  - **Completed:** `"Download ready"` + expiry + `"Download"` primary button + `"Request New Export"` secondary
  - **Failed:** error message + `"Retry Export"` button
- Past exports list: date + "Expired" label

### 11.13 Danger Zone Card

- `border-error bg-[#FEF2F2]` border/background
- Section label: `"DANGER ZONE"` in error colour
- `"These actions are permanent and cannot be undone."` — body-sm
- `"Transfer Ownership"` — `border border-error text-error bg-transparent rounded-[10px] h-11` (Owner only)
- `"Sign Out"` — DangerButton (`bg-error text-white`)

---

## 12. Supabase Integration Notes

### 12.1 Client Setup

```typescript
// src/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

### 12.2 Server Client (RSC / Server Actions)

```typescript
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

export function createClient() {
  const cookieStore = cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: (cs) => cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } }
  )
}
```

### 12.3 Key RPC / Table calls (Phase 1 subset)

All RPCs and table names are identical to what the MAUI app already uses — no backend changes needed.

| MAUI call | Web equivalent |
|-----------|---------------|
| `supabase.from('employees').select(...)` | Same |
| `supabase.from('companies').select(...)` | Same |
| `supabase.from('leave_requests').select(...)` | Same |
| `supabase.from('timesheet_punches').select(...)` | Same |
| `supabase.rpc('user_company_ids')` | Same |
| `supabase.auth.signInWithPassword(...)` | Same |
| `supabase.auth.signUp(...)` | Same |
| `supabase.auth.verifyOtp(...)` | Same |
| `supabase.auth.signOut()` | Same |

### 12.4 Auth State

Use `supabase.auth.onAuthStateChange(...)` in a top-level provider to keep the session fresh. Alternatively use the `@supabase/ssr` middleware pattern which automatically refreshes on every server request.

### 12.5 RLS

All existing RLS policies apply unchanged. The Supabase JS client sends the user's JWT automatically on every request — RLS enforces the same access rules on the web as it does in the MAUI app.

---

## 13. Phase 1 Delivery Checklist

| Item | Status |
|------|--------|
| Next.js project scaffold + Tailwind config | ⬜ |
| Supabase client setup (browser + server + middleware) | ⬜ |
| Auth layout + HR Sign-In screen | ⬜ |
| HR Register screen | ⬜ |
| HR Register Verify Code screen | ⬜ |
| HR Register Company Details screen | ⬜ |
| Dashboard layout (sidebar + top bar) | ⬜ |
| Sidebar — all nav items, 3-state collapsing | ⬜ |
| Overview tab | ⬜ |
| Employees tab (Employees / Teams / Leave / Pending sub-tabs) | ⬜ |
| Leave tab | ⬜ |
| Attendance tab (period filter + export + table) | ⬜ |
| Payroll tab | ⬜ |
| Settings page (all 13 sections) | ⬜ |
| Shared UI primitives (Button, Input, Badge, Card, Divider, DataTable) | ⬜ |
| TypeScript types generated from Supabase | ⬜ |
| Auth guard middleware | ⬜ |

---

## 14. Out of Scope for Phase 1

The following exist in the MAUI app but are deferred to later web phases. They must not be stubbed or partially implemented — simply do not create the routes.

- Employee dashboard (EmployeeDashboardPage)
- Employee login / OTP flow
- Jobs detail page
- Projects detail page
- Contractors, Finance, Inventory, Suppliers, Assets, Properties
- Messages / Notifications
- Activity Log
- Reports, Scheduling
- Platform Console (KaiSync operators)
- Create/Edit employee forms (navigate to — show "Coming soon" placeholder)
- My Profile edit
- My Payslips, My Leave, My Documents

---

## 15. Engineering Handoff Notes

1. **No XAML, no MAUI, no .NET** — the web project lives in a separate repo/folder. The Supabase backend and all its RPCs/tables/policies are shared and untouched.

2. **Design parity is non-negotiable.** Refer to §2 for exact colour values. Do not approximate — use the hex codes verbatim. If Tailwind purges an arbitrary value, add it to `safelist` in `tailwind.config.ts`.

3. **Session persistence** — use Supabase's cookie-based session via `@supabase/ssr`. Do NOT use `localStorage` for session data.

4. **Material Icons** — use the Google-hosted font. Icon codes are Unicode codepoints from the XAML (e.g. `&#xE871;` = `` = `dashboard`). A mapping table between XAML codes and icon names is available at https://fonts.google.com/icons.

5. **Sidebar toggle state** — use `useState` in the dashboard layout (Expanded / Collapsed). Collapsed = icon-only (56px). The MAUI sidebar has a third state — Hidden (0px width) — which exists for very narrow native windows. **Do not implement the Hidden state on web.** Two states only: Expanded (220px) and Collapsed (56px). A browser user can resize their window; the sidebar should remain accessible at minimum icon-only width.

6. **Tables on web** — use native `<table>` elements (not CSS grid) for the data tables so they get correct screen-reader semantics and column sizing.

7. **Date formatting** — use `Intl.DateTimeFormat` rather than a library. Format: `dd MMM yyyy` (e.g. `09 Jul 2026`).

8. **Generate TypeScript types** after Phase 1 schema is confirmed stable:
   ```bash
   npx supabase gen types typescript --project-id vcivtjwreybaxgtdhtou > src/types/database.ts
   ```
