# BRIEF — Top Nav: Midnight Colour Theme
## For Claude Code | KaiSync Workforce App

---

## SCOPE

**Touches only the `<header>` element inside `src/components/Sidebar.tsx`.**

- Left panel (`<aside>`) — **DO NOT TOUCH**
- Page content, routes, logic — **DO NOT TOUCH**
- This is purely a colour change on the top nav bar

Read `BRIEF_NAV_REDESIGN.md` first. The structure has already been built.
This brief overrides the colour tokens on the `<header>` only.

---

## THE CHANGE

The top nav bar moves from the light surface theme to a dark "Midnight" theme.

| Element | Before | After |
|---|---|---|
| Header background | `bg-surface` | `bg-[#0C111D]` |
| Header border-bottom | `border-divider` | `border-white/8` |
| Logo text | `text-text-primary` | `text-white` |
| Logo divider | `border-divider` | `border-white/10` |
| Module tab default | `text-text-secondary` | `text-white/45` |
| Module tab hover bg | `hover:bg-surface-hover` | `hover:bg-white/7` |
| Module tab hover text | `hover:text-text-primary` | `hover:text-white/85` |
| Module tab active underline | `border-primary` | `border-[#3B5CF6]` |
| Module tab active text | `text-primary` | `text-white font-medium` |
| Module tab active tint | `bg-primary/8` | `bg-[#3B5CF6]/15` |
| Vertical dividers | `bg-divider` | `bg-white/10` |
| Icon button default | `text-text-secondary` | `text-white/50` |
| Icon button hover | `hover:text-text-primary hover:bg-surface-hover` | `hover:text-white/90 hover:bg-white/8` |
| Icon button active | `bg-primary/10 text-primary` | `bg-[#3B5CF6]/18 text-[#3B5CF6]` |
| Avatar background | `bg-primary` | `bg-[#3B5CF6]` |
| Avatar dropdown | `bg-surface border-divider` | unchanged (light — dropdown can stay light) |

---

## NavTopBtn — updated classes

```tsx
function NavTopBtn({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-1.5 px-3 text-[12px] border-b-2 transition-colors self-stretch',
        active
          ? 'border-[#3B5CF6] text-white font-medium bg-[#3B5CF6]/15'
          : 'border-transparent text-white/45 hover:text-white/85 hover:bg-white/7',
      )}
    >
      <span className="material-icons text-[15px]">{icon}</span>
      {label}
    </Link>
  )
}
```

## NavIconBtn — updated classes

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
          ? 'bg-[#3B5CF6]/18 text-[#3B5CF6]'
          : 'text-white/50 hover:text-white/90 hover:bg-white/8',
      )}
    >
      <span className="material-icons text-[18px]">{icon}</span>
    </Link>
  )
}
```

## Header element — updated bg + border

```tsx
<header className="flex items-stretch h-[42px] shrink-0 bg-[#0C111D] border-b border-white/8 z-30">
```

## Logo section — updated text + divider

```tsx
<div className="flex items-center gap-2 px-3 border-r border-white/10 shrink-0">
  <div className="w-6 h-6 rounded-md bg-[#3B5CF6] flex items-center justify-center">
    <span className="material-icons text-white text-[14px]">bolt</span>
  </div>
  <span className="text-[12px] font-semibold text-white truncate max-w-[120px]">
    {company?.name ?? (platformOnly ? 'KaiSync Platform' : 'KaiSync')}
  </span>
</div>
```

## Vertical dividers in header

Change all `<div className="w-px bg-divider ...">` inside the `<header>` to:
```tsx
<div className="w-px bg-white/10 mx-1 self-stretch" />
```

## Avatar button — updated bg

```tsx
<button
  className="w-7 h-7 rounded-full bg-[#3B5CF6] flex items-center justify-center text-white text-[11px] font-semibold"
  ...
>
```

## Avatar dropdown — keep light theme

The dropdown popover (`absolute right-0 top-full ...`) stays with `bg-surface border-divider` —
light dropdown on dark nav is intentional, creates clear contrast.

---

## INTERACTION STATES SUMMARY

| State | Background | Text | Bottom border |
|---|---|---|---|
| Default | transparent | white/45 | transparent |
| Hover | white/7 | white/85 | transparent |
| Active | #3B5CF6/15 | white (full) | #3B5CF6 |
| Click flash | handled by browser active state | — | — |

---

## DELIVERABLES

- [ ] `<header>` bg changed to `bg-[#0C111D]`, border to `border-white/8`
- [ ] `NavTopBtn` uses midnight colour classes (see above)
- [ ] `NavIconBtn` uses midnight colour classes (see above)
- [ ] Logo text is white, logo icon bg is `#3B5CF6`
- [ ] All vertical dividers inside header use `bg-white/10`
- [ ] Avatar bg is `#3B5CF6`
- [ ] Left panel (`<aside>`) is **unchanged**
- [ ] Avatar dropdown stays light theme
- [ ] `tsc --noEmit` — 0 errors
- [ ] Visual check: active tab underline shows in blue, hover shows subtle white tint
