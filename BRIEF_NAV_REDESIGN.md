# BRIEF — Navigation Redesign: Top Nav + Collapsible Left Panel
## For Claude Code | KaiSync Workforce App

---

## SCOPE & SAFETY RULES

**Touches only:**
- `src/components/Sidebar.tsx` — full rewrite
- `src/app/dashboard/layout.tsx` — structural change only

**DO NOT touch:**
- `EmployeeSidebar` — employee shell is unchanged
- `src/lib/company-modules.ts` — all flag/permission logic unchanged
- `src/lib/finance-gate.ts` — unchanged
- Any page routes, data fetching, or DB queries

All existing logic (`resolveHrNavFlags`, `itemVisible`, `isItemActive`, `loadCompanyWorkspace`, `isPlatformAdmin`, sign-out, platform-only mode) is preserved exactly — only the rendering changes.

---

## WHAT THE NEW NAV LOOKS LIKE

```
┌─────────────────────────────────────────────────────────────────────┐
│ ⚡ CompanyName │ Overview │ Workforce │ Money │ Operations │ Insights │  ·· PA 🔔 💬 │ ⚙ ↓ [NY] │
├──────────────────────────────────────────────────────────────────────┤
│              │                                                        │
│  Left panel  │   Page content                                         │
│  (module     │                                                        │
│   items)     │                                                        │
│              │                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

- **Top bar** — full width, 42px tall, light surface background
- **Left panel** — appears only when a module tab is active (hidden on Overview)
- **Collapsible** — panel toggles between 176px (labels + icons) and 44px (icons only)
- **Overview** — full-width content, no left panel

---

## FILE 1: `src/app/dashboard/layout.tsx`

### 1a. Root layout structure

Change from left-sidebar + right-content to top-bar + body:

**Before:**
```tsx
<div className="flex h-screen overflow-hidden">
  <Sidebar ... />
  <div className="flex flex-col flex-1 overflow-hidden bg-background">
    <header className="flex items-center h-14 px-5 bg-surface border-b border-divider shrink-0">
      {/* hamburger + user info */}
    </header>
    <main className="flex-1 overflow-y-auto">{children}</main>
  </div>
</div>
```

**After:**
```tsx
<div className="flex flex-col h-screen overflow-hidden">
  <Sidebar
    open={sidebarOpen}
    onToggle={() => setSidebarOpen(v => !v)}
    company={company}
    employee={employee}
    platformOnly={platformOnly}
  />
  <div className="flex flex-1 overflow-hidden">
    <main className="flex-1 overflow-y-auto bg-background">{children}</main>
  </div>
</div>
```

### 1b. Remove the `<header>` entirely

The existing `<header>` (hamburger button + user name + avatar) is removed. All of that information now lives inside the new Sidebar/TopNav component.

### 1c. Keep `sidebarOpen` state as-is

`sidebarOpen` and `setSidebarOpen` stay in layout.tsx and are passed to `Sidebar` as `open`/`onToggle`. No rename needed.

---

## FILE 2: `src/components/Sidebar.tsx` — Full Rewrite

Keep all existing imports, types, data, and logic. Only the JSX and rendering changes.

### 2a. Add `icon` to `NavSection` and `group` to `NavItem`

```typescript
interface NavItem {
  label: string
  href: string
  icon: string
  flag?: keyof HrNavFlags
  ownerOnly?: boolean
  group?: string   // ← ADD: optional sub-section label within a module panel
}

interface NavSection {
  id: string
  label: string
  icon: string    // ← ADD: Material Icon name for the top nav tab
  items: NavItem[]
}
```

### 2b. Update `NAV_SECTIONS` data

Add `icon` to each section and `group` labels to Money items:

```typescript
const NAV_SECTIONS: NavSection[] = [
  {
    id: 'workforce',
    label: 'Workforce',
    icon: 'people',
    items: [
      { label: 'Employees',      href: '/dashboard/employees',      icon: 'people',          flag: 'employees' },
      { label: 'Work Teams',     href: '/dashboard/work-teams',     icon: 'groups',          flag: 'workTeams' },
      { label: 'Leave',          href: '/dashboard/leave',          icon: 'event_available', flag: 'leave' },
      { label: 'Attendance',     href: '/dashboard/attendance',     icon: 'schedule',        flag: 'attendance' },
      { label: 'Team Punch',     href: '/dashboard/team-punch',     icon: 'punch_clock',     flag: 'teamPunch' },
      { label: 'Time Templates', href: '/dashboard/time-templates', icon: 'access_time',     flag: 'timeTemplates' },
      { label: 'Scheduling',     href: '/dashboard/scheduling',     icon: 'calendar_month',  flag: 'scheduling' },
      { label: 'Payroll',        href: '/dashboard/payroll',        icon: 'payments',        flag: 'payroll' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: 'work',
    items: [
      { label: 'Clients',          href: '/dashboard/clients',           icon: 'business',    flag: 'clients' },
      { label: 'Projects',         href: '/dashboard/projects',          icon: 'folder',      flag: 'projects' },
      { label: 'Jobs',             href: '/dashboard/jobs',              icon: 'work',        flag: 'jobs' },
      { label: 'Contractors',      href: '/dashboard/contractors',       icon: 'engineering', flag: 'contractors' },
      { label: 'Incidents',        href: '/dashboard/incidents',         icon: 'warning',     flag: 'incidents' },
      { label: 'Compliance Packs', href: '/dashboard/compliance-packs', icon: 'verified',    flag: 'compliancePacks' },
      { label: 'Inventory',        href: '/dashboard/inventory',         icon: 'inventory_2', flag: 'inventory' },
      { label: 'Assets',           href: '/dashboard/assets',            icon: 'category',    flag: 'assets' },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    icon: 'account_balance_wallet',
    items: [
      { label: 'Finance',           href: '/dashboard/finance',                   icon: 'account_balance', flag: 'finance',     group: 'Finance' },
      { label: 'Quotes',            href: '/dashboard/money/quotes',              icon: 'request_quote',   flag: 'commercial',  group: 'Client' },
      { label: 'Invoices',          href: '/dashboard/money/invoices',            icon: 'receipt_long',    flag: 'commercial',  group: 'Client' },
      { label: 'Credit Notes',      href: '/dashboard/money/credit-notes',        icon: 'undo',            flag: 'commercial',  group: 'Client' },
      { label: 'Price Catalogue',   href: '/dashboard/money/catalogue',           icon: 'sell',            flag: 'commercial',  group: 'Client' },
      { label: 'RFQs',              href: '/dashboard/supply/rfqs',               icon: 'compare_arrows',  flag: 'commercial',  group: 'Procurement' },
      { label: 'Purchase Orders',   href: '/dashboard/supply/purchase-orders',    icon: 'shopping_cart',   flag: 'commercial',  group: 'Procurement' },
      { label: 'Goods Received',    href: '/dashboard/supply/goods-received',     icon: 'local_shipping',  flag: 'commercial',  group: 'Procurement' },
      { label: 'Supplier Invoices', href: '/dashboard/finance/supplier-invoices', icon: 'receipt',         flag: 'commercial',  group: 'Procurement' },
      { label: 'Suppliers',         href: '/dashboard/supply/suppliers',          icon: 'storefront',      flag: 'commercial',  group: 'Procurement' },
    ],
  },
  {
    id: 'properties',
    label: 'Properties',
    icon: 'home_work',
    items: [
      { label: 'Properties', href: '/dashboard/properties', icon: 'home_work', flag: 'properties' },
      { label: 'Residents',  href: '/dashboard/residents',  icon: 'apartment', flag: 'residents' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: 'bar_chart',
    items: [
      { label: 'Reports',              href: '/dashboard/reports',                      icon: 'bar_chart',   flag: 'reports' },
      { label: 'Project Profitability',href: '/dashboard/reports/project-profitability',icon: 'trending_up', flag: 'reports' },
    ],
  },
]
```

Note: the `admin` section (My Profile, Active Sessions, Activity Log) is removed from `NAV_SECTIONS` and handled via the avatar dropdown (see §2e).

### 2c. Active module detection

```typescript
// Which section is currently active (drives which top tab is highlighted)
const activeSection = useMemo(() => {
  return sections.find(section =>
    section.items.some(item => isItemActive(pathname, item.href))
  ) ?? null
}, [pathname, sections])
```

### 2d. Panel collapsed state

Add a new local state for panel collapse (separate from `open` which controls the whole nav):

```typescript
const [panelCollapsed, setPanelCollapsed] = useState(false)
```

The panel is only visible when `activeSection !== null` (i.e. not on Overview or global pages).

### 2e. JSX structure

The component renders TWO things: a `<header>` (top nav bar) and a `<nav>` (left panel). Both are positioned so the parent `flex-col` layout works correctly.

```tsx
return (
  <>
    {/* ── TOP NAV BAR ─────────────────────────────────────── */}
    <header className="flex items-stretch h-[42px] shrink-0 bg-surface border-b border-divider z-30">

      {/* Logo */}
      <div className="flex items-center gap-2 px-3 border-r border-divider shrink-0">
        <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
          <span className="material-icons text-white text-[14px]">bolt</span>
        </div>
        <span className="text-[12px] font-semibold text-text-primary truncate max-w-[120px]">
          {company?.name ?? (platformOnly ? 'KaiSync Platform' : 'KaiSync')}
        </span>
      </div>

      {/* Overview button */}
      <NavTopBtn
        href="/dashboard/overview"
        icon="home"
        label="Overview"
        active={!activeSection && pathname.startsWith('/dashboard/overview')}
      />

      <div className="w-px bg-divider mx-1 self-stretch" />

      {/* Module tabs — hidden if platformOnly */}
      {!platformOnly && sections.map(section => (
        <NavTopBtn
          key={section.id}
          href={section.items[0]?.href ?? '#'}
          icon={section.icon}
          label={section.label}
          active={activeSection?.id === section.id}
        />
      ))}

      {/* Platform Console tab */}
      {showPlatform && (
        <NavTopBtn
          href="/dashboard/platform"
          icon="admin_panel_settings"
          label="Platform"
          active={pathname.startsWith('/dashboard/platform')}
        />
      )}

      <div className="flex-1" />

      {/* Global icon buttons */}
      {!platformOnly && (
        <>
          {itemVisible({ label:'My PA', href:'/dashboard/pa', icon:'task_alt', flag:'myPa' }, flags, isOwner) && (
            <NavIconBtn href="/dashboard/pa" icon="task_alt" label="My PA" active={pathname.startsWith('/dashboard/pa')} />
          )}
          {itemVisible({ label:'Messages', href:'/dashboard/messages', icon:'chat', flag:'messaging' }, flags, isOwner) && (
            <NavIconBtn href="/dashboard/messages" icon="chat" label="Messages" active={pathname.startsWith('/dashboard/messages')} />
          )}
          <NavIconBtn href="/dashboard/notifications" icon="notifications" label="Notifications" active={pathname.startsWith('/dashboard/notifications')} />
          <div className="w-px bg-divider mx-1 self-stretch" />
          {itemVisible({ label:'Settings', href:'/dashboard/settings', icon:'settings', flag:'settings' }, flags, isOwner) && (
            <NavIconBtn href="/dashboard/settings" icon="settings" label="Settings" active={pathname.startsWith('/dashboard/settings')} />
          )}
          <PwaInstallButton className="flex items-center justify-center w-8 h-8 my-auto rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors" />
        </>
      )}

      {/* Avatar + dropdown */}
      <div className="flex items-center gap-2 px-3 border-l border-divider ml-1">
        <div className="relative group">
          <button
            className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-[11px] font-semibold"
            title={displayName}
            aria-label="Account menu"
          >
            {getInitials(displayName)}
          </button>
          {/* Dropdown — visible on hover/focus-within */}
          <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-divider rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-all z-50">
            <div className="px-3 py-2 border-b border-divider">
              <p className="text-[12px] font-medium text-text-primary truncate">{displayName}</p>
              <p className="text-[11px] text-text-secondary">{roleLabel}</p>
            </div>
            <Link href="/dashboard/profile" className="flex items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-hover">
              <span className="material-icons text-[16px]">person</span>My Profile
            </Link>
            <Link href="/dashboard/active-sessions" className="flex items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-hover">
              <span className="material-icons text-[16px]">manage_accounts</span>Active Sessions
            </Link>
            {isOwner && (
              <Link href="/dashboard/activity-log" className="flex items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-hover">
                <span className="material-icons text-[16px]">history</span>Activity Log
              </Link>
            )}
            <div className="border-t border-divider mt-1">
              <button onClick={handleSignOut} className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-hover">
                <span className="material-icons text-[16px]">logout</span>Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    {/* ── LEFT PANEL ───────────────────────────────────────── */}
    {activeSection && (
      <aside
        className={cn(
          'flex flex-col shrink-0 bg-surface border-r border-divider overflow-hidden transition-all duration-200 z-20',
          panelCollapsed ? 'w-11' : 'w-44',
        )}
      >
        {/* Panel header — module name + collapse toggle */}
        <div className="flex items-center justify-between px-2 pt-2 pb-1 shrink-0">
          {!panelCollapsed && (
            <span className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary px-1">
              {activeSection.label}
            </span>
          )}
          <button
            type="button"
            onClick={() => setPanelCollapsed(v => !v)}
            className={cn(
              'w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors',
              panelCollapsed && 'mx-auto',
            )}
            title={panelCollapsed ? 'Expand panel' : 'Collapse panel'}
          >
            <span className="material-icons text-[16px]">
              {panelCollapsed ? 'chevron_right' : 'chevron_left'}
            </span>
          </button>
        </div>

        {/* Panel items — grouped by item.group when present */}
        <nav className="flex-1 overflow-y-auto py-1">
          <PanelItems
            items={activeSection.items}
            flags={flags}
            isOwner={isOwner}
            pathname={pathname}
            collapsed={panelCollapsed}
          />
        </nav>
      </aside>
    )}
  </>
)
```

### 2f. Helper components (define above the main component)

**`NavTopBtn`** — top nav tab button:

```tsx
function NavTopBtn({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-1.5 px-3 text-[12px] border-b-2 transition-colors self-stretch',
        active
          ? 'border-primary text-primary bg-primary/8 font-medium'
          : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover',
      )}
    >
      <span className="material-icons text-[15px]">{icon}</span>
      {label}
    </Link>
  )
}
```

**`NavIconBtn`** — small icon button for global items:

```tsx
function NavIconBtn({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className={cn(
        'flex items-center justify-center w-8 h-8 my-auto rounded-md transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
      )}
    >
      <span className="material-icons text-[18px]">{icon}</span>
    </Link>
  )
}
```

**`PanelItems`** — renders left panel items with optional group headers:

```tsx
function PanelItems({
  items, flags, isOwner, pathname, collapsed,
}: {
  items: NavItem[]; flags: HrNavFlags; isOwner: boolean; pathname: string; collapsed: boolean
}) {
  const visible = items.filter(item => itemVisible(item, flags, isOwner))
  if (visible.length === 0) return null

  // Group items by their `group` property
  const groups: { label: string | null; items: NavItem[] }[] = []
  for (const item of visible) {
    const g = item.group ?? null
    const last = groups[groups.length - 1]
    if (last && last.label === g) {
      last.items.push(item)
    } else {
      groups.push({ label: g, items: [item] })
    }
  }

  return (
    <>
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.label && !collapsed && (
            <p className="text-[9px] font-semibold uppercase tracking-widest text-text-secondary px-3 pt-3 pb-1">
              {group.label}
            </p>
          )}
          {group.items.map(item => {
            const active = isItemActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-2 mx-1 mb-0.5 rounded-md transition-colors',
                  collapsed ? 'justify-center px-0 py-2' : 'px-2 py-1.5',
                  active
                    ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary rounded-l-none'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover',
                )}
              >
                <span className={cn('material-icons shrink-0', collapsed ? 'text-[18px]' : 'text-[16px]')}>
                  {item.icon}
                </span>
                {!collapsed && (
                  <span className="text-[12px] truncate">{item.label}</span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
    </>
  )
}
```

---

## COLOUR TOKENS

Use the app's existing Tailwind classes throughout. Do not hardcode hex values.

| Element | Class pattern |
|---|---|
| Top bar background | `bg-surface` |
| Top bar border | `border-divider` |
| Active tab text | `text-primary` |
| Active tab underline | `border-primary` |
| Active tab tint | `bg-primary/8` |
| Active panel item tint | `bg-primary/10` |
| Active panel left border | `border-primary` |
| Panel text | `text-text-secondary` |
| Panel hover | `hover:bg-surface-hover` |

If `bg-primary/8` or `surface-hover` aren't in the existing Tailwind config, use `bg-primary/10` and `hover:bg-gray-100 dark:hover:bg-white/5` as fallbacks — check `tailwind.config.*` first.

---

## PLATFORM-ONLY MODE

When `platformOnly = true`:
- Top bar shows: logo + Platform Console tab + avatar
- No module tabs, no global icon buttons (My PA, Messages etc.)
- No left panel
- Same sign-out behaviour

---

## DELIVERABLES

- [ ] `layout.tsx` — root div is `flex-col`, `<header>` removed, inner div is `flex flex-1`
- [ ] `Sidebar.tsx` — renders `<header>` (top nav) + `<aside>` (left panel), not a left sidebar
- [ ] `NavSection.icon` and `NavItem.group` fields added
- [ ] `NAV_SECTIONS` updated with icons + group labels on Money items
- [ ] Top nav: logo, Overview, module tabs, global icons (My PA, Messages, Notifications, Settings, PWA install), avatar dropdown
- [ ] Avatar dropdown: name/role, My Profile, Active Sessions, Activity Log (owner), sign out
- [ ] Left panel: visible only when a module tab is active, hidden on Overview/global pages
- [ ] Left panel: collapsible (176px ↔ 44px icon rail) via toggle button
- [ ] Left panel: group sub-headers for Money (Finance / Client / Procurement)
- [ ] Active states: accent underline + tint on top tab; accent left border + tint on panel item
- [ ] Font sizes: 12px nav labels, 10px section sub-headers, never larger
- [ ] `tsc --noEmit` — 0 errors
- [ ] Visual check: click through all modules, collapse panel, sign out still works
