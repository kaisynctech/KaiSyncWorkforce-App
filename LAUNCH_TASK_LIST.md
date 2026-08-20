# KaiSync Launch Task List
## Prioritised for Claude Code | Updated 2026-08-20

---

## P0 — Launch Blockers (must ship before launch)

These are blocking. Do not launch without them.

### 1. Nav: Midnight colour theme
**Brief:** `BRIEF_NAV_MIDNIGHT_THEME.md`
Colour-only change to the `<header>` in `Sidebar.tsx`. Fast win, makes the
app look finished.

### 2. Unified Inventory & Services
**Brief:** `MISSION_BRIEF_INVENTORY_SERVICES.md`
**Migration:** `supabase/migrations/20260812000100_inventory_services.sql`
Replaces the old price catalogue with a proper unified inventory/services
page. Foundational — everything else (stock adjustments, variants, rate card
in quote builder) depends on this being in place.

### 3. Stock Adjustment Log
**Brief:** `MISSION_BRIEF_STOCK_ADJUSTMENTS.md`
**Migration:** `supabase/migrations/20260812000200_stock_adjustments.sql`
Requires #2 above. Gives users the ability to record stock in/out with an
immutable audit trail.

### 4. Simple Quote Builder
**Brief:** `MISSION_BRIEF_SIMPLE_QUOTE_BUILDER.md`
The core quoting flow for launch. Single-screen: customer → lines → totals →
mark as sent. The 4-tab complex builder code stays untouched but unused.

---

## P1 — Launch Polish (strong to have, not hard blockers)

Ship these alongside P0 if capacity allows; defer if pressed for time.

### 5. Item Form Redesign
**Brief:** `BRIEF_ITEM_FORM_REDESIGN.md`
Side drawer → centred modal, 4 tabs (Details / Pricing / Stock & Suppliers /
Alternative numbers). Improves the inventory management UX significantly.
Not blocking but users will notice if the item form feels clunky.

---

## P2 — Post-Launch (explicit defer)

Do NOT build these before launch. Schedule for the first post-launch sprint.

### 6. Request Tab: Simplify lines table
**Brief:** `BRIEF_REQUEST_TAB_TABLE_SIMPLIFY.md`
Improvement to the 4-tab complex builder which isn't used at launch anyway.

### 7. Request Tab: "From catalogue" modal
**Brief:** `BRIEF_REQUEST_TAB_CATALOGUE_SEARCH.md`
Same — 4-tab complex builder, post-launch.

### 8. Item Variants
**Brief:** `MISSION_BRIEF_ITEM_VARIANTS.md`
**Migration:** `supabase/migrations/20260812000300_item_variants.sql`
Advanced — same part, multiple brand/condition combinations with independent
stock. Real need but not day-one.

---

## Gaps to assess before launch (no brief written yet)

These don't have briefs yet. Need a quick review to decide if they're P0:

| Area | Question | Action needed? |
|---|---|---|
| Onboarding | Is there a first-run flow for a brand new company? | Check — may need a basic setup wizard |
| Empty states | Do all key pages (Quotes, Invoices, Employees) have helpful empty states? | Spot-check |
| Auth / password reset | Does Supabase Auth email reset work end-to-end? | Test manually |
| Mobile responsiveness | Key pages usable on a phone or tablet? | Spot-check |
| Error boundaries | What happens if a Supabase query fails — blank screen or graceful message? | Spot-check |
| Seeded data | Can a new company log in and immediately try quoting without setup friction? | Test with fresh company |

---

## Execution order for Claude Code

```
1. BRIEF_NAV_MIDNIGHT_THEME.md
2. 20260812000100_inventory_services.sql  →  MISSION_BRIEF_INVENTORY_SERVICES.md
3. 20260812000200_stock_adjustments.sql   →  MISSION_BRIEF_STOCK_ADJUSTMENTS.md
4. MISSION_BRIEF_SIMPLE_QUOTE_BUILDER.md
5. BRIEF_ITEM_FORM_REDESIGN.md             (P1 — if time allows)
```

Migrations 2 and 3 must be applied before their respective briefs are executed.
Brief 4 (Simple Quote Builder) can run in parallel with 2–3 as it touches
different files.
```
