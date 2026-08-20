# BRIEF — Request Tab: Simplify lines table
## For Claude Code | KaiSync Workforce App

---

## FILE: `src/components/quotes/tabs/RequestTab.tsx`

One change only — the lines table columns.

---

## REMOVE from the lines table

- Unit column
- Catalogue column (the "✓ in catalogue" / "not found" indicator)
- Source column ("manual" / "catalogue" badge)

These are not needed here. The user is just capturing what was requested.
Unit is still stored on the RequestLine (set via the entry row), just not
displayed. Catalogue status and source are Tab 2 concerns.

---

## FINAL TABLE COLUMNS

| # | Type | Code | Name / description | Qty | × |
|---|---|---|---|---|---|

- **#** — row number
- **Type** — coloured badge: Part / Service / Material / Labour
- **Code** — SKU / part number in monospace; `—` for service/labour rows
- **Name / description** — full width, editable inline
- **Qty** — number, editable inline; right-aligned
- **×** — remove row (visible on hover)

No other columns.

---

## DELIVERABLES

- [ ] Unit, Catalogue, Source columns removed from the table
- [ ] Remaining 5 columns: # · Type · Code · Name / description · Qty · ×
- [ ] `tsc --noEmit` — 0 errors
