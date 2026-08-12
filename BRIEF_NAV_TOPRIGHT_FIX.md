# BRIEF — Top Nav Layout Fix
## For Claude Code | KaiSync Workforce App

---

## TARGET LAYOUT

```
⚡ Company │ Overview  My PA  Messages │ divider │ Workforce  Operations  Money  Properties  Insights │ spacer │ 🔔  ⚙  [NN]
```

**Left of divider** — text tabs (icon + label): Overview, My PA, Messages  
**Right of divider** — module tabs (icon + label): Workforce, Operations, Money, Properties, Insights  
**Far right** — icon-only buttons: Notifications, Settings, then Avatar  

---

## CHANGES in `src/components/Sidebar.tsx`

### Top bar — exact new order

```tsx
<header ...>

  {/* Logo */}
  ...logo...

  {/* ── Left text tabs ── */}
  <NavTopBtn href="/dashboard/overview" icon="home" label="Overview"
    active={!activeSection && pathname.startsWith('/dashboard/overview')} />

  {!platformOnly && (
    <>
      {itemVisible({label:'My PA', href:'/dashboard/pa', icon:'task_alt', flag:'myPa'}, flags, isOwner) && (
        <NavTopBtn href="/dashboard/pa" icon="task_alt" label="My PA"
          active={pathname.startsWith('/dashboard/pa')} />
      )}
      {itemVisible({label:'Messages', href:'/dashboard/messages', icon:'chat', flag:'messaging'}, flags, isOwner) && (
        <NavTopBtn href="/dashboard/messages" icon="chat" label="Messages"
          active={pathname.startsWith('/dashboard/messages')} />
      )}
    </>
  )}

  {/* Divider */}
  <div className="w-px bg-divider mx-2 self-stretch shrink-0" />

  {/* ── Module tabs ── */}
  {!platformOnly && sections.map(section => (
    <NavTopBtn key={section.id} href={section.items[0]?.href ?? '#'}
      icon={section.icon} label={section.label}
      active={activeSection?.id === section.id} />
  ))}
  {showPlatform && (
    <NavTopBtn href="/dashboard/platform" icon="admin_panel_settings" label="Platform"
      active={pathname.startsWith('/dashboard/platform')} />
  )}

  <div className="flex-1" />

  {/* ── Right icon buttons ── */}
  {!platformOnly && (
    <>
      <NavIconBtn href="/dashboard/notifications" icon="notifications" label="Notifications"
        active={pathname.startsWith('/dashboard/notifications')} />
      {itemVisible({label:'Settings', href:'/dashboard/settings', icon:'settings', flag:'settings'}, flags, isOwner) && (
        <NavIconBtn href="/dashboard/settings" icon="settings" label="Settings"
          active={pathname.startsWith('/dashboard/settings')} />
      )}
    </>
  )}

  {/* ── Avatar (with dropdown) ── */}
  <div className="flex items-center px-3 border-l border-divider ml-1">
    {/* existing avatar + dropdown unchanged */}
    {/* dropdown still contains: My Profile, Active Sessions, Activity Log, Settings, Install App, Sign out */}
  </div>

</header>
```

---

## `NavTopBtn` and `NavIconBtn` are unchanged from the original brief

`NavTopBtn` = icon + text label, accent underline when active  
`NavIconBtn` = icon only, no label, active tint when active

---

## DELIVERABLES

- [ ] Left of divider: Overview, My PA (if enabled), Messages (if enabled) — all as text tabs
- [ ] Right of divider: module tabs (Workforce, Operations, Money, Properties, Insights)
- [ ] Far right icons: Notifications, Settings (icon only, no label)
- [ ] Far right: Avatar with dropdown (My Profile, Active Sessions, Activity Log, Settings, Install App, Sign out)
- [ ] All `itemVisible` / flag checks preserved
- [ ] `tsc --noEmit` — 0 errors
