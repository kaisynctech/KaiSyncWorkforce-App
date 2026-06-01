# 05 — KaiFlow Design System & UI Architecture

The KaiFlow Design System is the centralised, reusable UI framework that gives
every module a consistent, enterprise-grade look (Xero / Stripe / Linear design
language: spacious, clean, data-rich, premium). It is **additive** — it extends
the existing token dictionaries without redefining any existing key, so every
screen that already ships keeps working unchanged.

## Where it lives

| Layer | Location | Purpose |
|-------|----------|---------|
| Colour tokens | `Resources/Styles/Colors.xaml` | Brand, status, text, surface, sidebar colours |
| Base styles | `Resources/Styles/Styles.xaml` | Typography, cards, KPI, data tables, buttons, pills, empty state |
| **Design tokens** | `Resources/Styles/DesignTokens.xaml` | Spacing / radius / padding scales, chip tints, chart palette, new component styles |
| **Reusable controls** | `Controls/*.xaml(.cs)` | `KpiCard`, `StatusChip`, `SectionHeader`, `EmptyStateView`, `ChartCard` |
| **Chart drawables** | `Controls/KaiFlowCharts.cs`, `Controls/FinanceCharts.cs` | MAUI-native `IDrawable` charts (no third-party / webview / HTML) |

All three dictionaries are merged globally in `App.xaml`:

```7:13:KaiFlow.Timesheets.Maui/App.xaml
        <ResourceDictionary>
            <ResourceDictionary.MergedDictionaries>
                <ResourceDictionary Source="Resources/Styles/Colors.xaml" />
                <ResourceDictionary Source="Resources/Styles/Styles.xaml" />
                <ResourceDictionary Source="Resources/Styles/DesignTokens.xaml" />
            </ResourceDictionary.MergedDictionaries>
        </ResourceDictionary>
```

## Design tokens

### Spacing (8pt grid)

| Key | Value | Typical use |
|-----|-------|-------------|
| `SpaceXs` | 4 | Icon ↔ text gap |
| `SpaceSm` | 8 | Inner element spacing |
| `SpaceMd` | 12 | Default control spacing |
| `SpaceLg` | 16 | Card padding / section gap |
| `SpaceXl` | 24 | Page gutter |
| `SpaceXxl` | 32 | Major section separation |
| `Space3Xl` | 48 | Hero / empty-state padding |

### Radius

`RadiusSm` 8 · `RadiusMd` 12 · `RadiusLg` 16 · `RadiusXl` 20 · `RadiusPill` 999

### Standard paddings (`Thickness`)

`PadPage` 20 · `PadCard` 16 · `PadTight` 12,10 · `PadChip` 10,4

### Chart palette

`Chart1..Chart6` provide a fixed, consistent series-colour order so the same
category renders the same colour across every dashboard. `ChartAxis` and
`ChartTrack` standardise axis/track tints.

### New component styles

`SectionTitle`, `ElevatedCard`, `ChartCardBorder`, `FilterChip` /
`FilterChipActive`, `SearchEntry`, `SkeletonBlock`, `CaptionMuted`.

## Reusable controls

Add the namespace once per page:

```xml
xmlns:kf="clr-namespace:KaiFlow.Timesheets.Controls"
```

### `KpiCard`

```xml
<kf:KpiCard Title="Revenue (MTD)"
            Value="R 1.24M"
            Delta="12.4%" DeltaPositive="True"
            Caption="vs last month"
            Accent="{StaticResource Chart2}" />
```

Title, large value, an optional ▲/▼ delta (auto green/red) and a muted caption.
The accent drives a small status dot so a grid of tiles reads at a glance.

### `StatusChip`

```xml
<kf:StatusChip Text="Paid"    Status="success" />
<kf:StatusChip Text="Overdue" Status="error" />
<kf:StatusChip Text="Draft"   Status="info" />
```

`Status` accepts semantic values (`success | warning | error | info | neutral`)
plus common domain synonyms (`paid`, `overdue`, `pending`, `approved`,
`cancelled`, …). Colours resolve from design tokens so chips are uniform across
invoices, jobs, incidents, payroll, contractors.

### `SectionHeader`

```xml
<kf:SectionHeader Title="Recent invoices"
                  Subtitle="Last 30 days"
                  ActionText="View all"
                  ActionCommand="{Binding ViewAllInvoicesCommand}" />
```

### `EmptyStateView`

```xml
<CollectionView ItemsSource="{Binding Items}">
    <CollectionView.EmptyView>
        <kf:EmptyStateView Glyph="📭"
                           Title="No invoices yet"
                           Message="Create your first invoice to get started."
                           ActionText="New invoice"
                           ActionCommand="{Binding NewInvoiceCommand}" />
    </CollectionView.EmptyView>
</CollectionView>
```

### `ChartCard`

A framed container with title/subtitle, an optional trailing slot (legend /
range selector) and a host that accepts any chart view:

```xml
<kf:ChartCard Title="Cash flow" Subtitle="6 months" ChartHeight="220">
    <kf:ChartCard.ChartContent>
        <GraphicsView x:Name="CashFlowChart" />
    </kf:ChartCard.ChartContent>
</kf:ChartCard>
```

## MAUI-native charting

All charts are dependency-free `IDrawable`s rendered through `GraphicsView`
(no Python, no webview, no HTML). Assign a drawable to a `GraphicsView.Drawable`
and call `Invalidate()` when data changes.

| Drawable | File | Use |
|----------|------|-----|
| `BarSeriesDrawable` | `FinanceCharts.cs` | Single / grouped bars |
| `CategoryBarsDrawable` | `FinanceCharts.cs` | Horizontal proportion bars |
| `LineSeriesDrawable` | `KaiFlowCharts.cs` | Line + optional area fill |
| `DonutChartDrawable` | `KaiFlowCharts.cs` | Donut / pie with centre caption |
| `SparklineDrawable` | `KaiFlowCharts.cs` | Inline KPI-tile trend line |
| `StackedBarDrawable` | `KaiFlowCharts.cs` | Stacked component bars |

Generic drawables consume `ChartValue` (`Label`, `Value`, optional `ColorHex`)
or `ChartStack`/`ChartSegment`, keeping charts decoupled from domain models.

```csharp
CashFlowChart.Drawable = new LineSeriesDrawable
{
    Points = new[]
    {
        new ChartValue("Jan", 820_000),
        new ChartValue("Feb", 910_000),
        new ChartValue("Mar", 1_240_000),
    },
    LineColor = Color.FromArgb("#3B82F6"),
};
CashFlowChart.Invalidate();
```

## Enterprise table system

Reusable tabular infrastructure for invoices, payroll, jobs, incidents, and reports.

| Piece | Location | Role |
|-------|----------|------|
| `TableQuery` | `Controls/Table/TableQuery.cs` | In-memory filter → search → sort → paginate |
| `FilterToolbar` | `Controls/FilterToolbar.xaml` | Search entry + filter chip slot + trailing actions |
| `EnterpriseTableView` | `Controls/EnterpriseTableView.xaml` | Sticky header, virtualised rows, empty state, pagination footer |

ViewModels call `TableQuery.Apply(...)` with domain predicates and sort selectors;
the table control stays presentational. First adoption: **Finance → Invoices**
(`FinanceInvoicesPage` — sortable columns, 25-row pages, `StatusChip` per row).

```csharp
var result = TableQuery.Apply(new TableQueryOptions<FinanceInvoice>
{
    Source = _all,
    SearchText = SearchText,
    MatchesSearch = (i, q) => i.InvoiceNumber?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false,
    Predicate = StatusFilter == "paid" ? i => i.StatusRaw == "paid" : null,
    SortKey = SortColumn,
    SortAscending = SortAscending,
    SortSelectors = new() { ["issue"] = i => i.IssueDate, ["total"] = i => i.TotalAmount },
    PageIndex = PageIndex,
    PageSize = 25,
});
Invoices = new ObservableCollection<FinanceInvoice>(result.Page);
PageSummary = result.PageSummary;
```

## Adoption guidance

1. **New screens** should compose `KpiCard`, `StatusChip`, `SectionHeader`,
   `EmptyStateView`, `ChartCard` rather than hand-rolling layout.
2. **Existing screens** migrate incrementally and safely — swap inline status
   pills for `StatusChip`, ad-hoc KPI blocks for `KpiCard`, bespoke empty labels
   for `EmptyStateView`. Behaviour/bindings stay identical.
3. Always reference spacing/radius/colour **tokens**; never hard-code values.
4. Charts are MAUI-native only; reuse the shared drawables and `Chart1..6` palette.

## Roadmap — remaining UI/UX phases

The token layer + control library + native charts are the foundation. The
remaining phases build on them, module by module, with a build check each step:

| Phase | Scope | Status |
|-------|-------|--------|
| 1 — Design system | Tokens, controls, charts | ✅ Delivered |
| 12 — Component architecture | `KpiCard`, `StatusChip`, `SectionHeader`, `EmptyStateView`, `ChartCard` | ✅ Delivered |
| 5 — Native charting | Line/area/donut/sparkline/stacked drawables | ✅ Delivered |
| 2 — Global layout standardisation | Apply tokens/controls per module | ▶ Next, incremental |
| 3 — Dashboard framework | Widget grid + personalisation on top of `KpiCard`/`ChartCard` | Planned |
| 4 / 9 — Reporting & telemetry centre | Executive dashboard + telemetry KPIs/charts on Reports | ✅ Delivered |
| 7 — Enterprise table system | `TableQuery`, `FilterToolbar`, `EnterpriseTableView` | ✅ Delivered (Invoices + Payroll) |
| 8 — Filtering UX | `FilterToolbar` (search + chip slot) | ✅ Core delivered; saved presets planned |
| 10 — Export centre | `ExportHistoryService` + Reports export centre UI | ✅ Core delivered (device-local history) |
| 11 — Performance | Virtualisation, off-thread chart prep | Cross-cutting |
