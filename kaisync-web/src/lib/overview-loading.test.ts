import { describe, expect, it } from 'vitest'
import {
  applyIfCurrent,
  errorCommercial,
  hiddenCommercial,
  initialCommercial,
  loadingCommercial,
  overviewPresentation,
  readyCommercial,
  showCommercialActions,
  showCommercialFigures,
  sumOutstanding,
} from '@/lib/overview-loading'

describe('overview loading', () => {
  it('shows the core dashboard while the commercial summary is still pending', () => {
    const view = overviewPresentation(false, loadingCommercial().phase)

    expect(view.showCoreLoading).toBe(false)
    expect(view.showCoreDashboard).toBe(true)
    expect(view.showCommercialFigures).toBe(false)
    expect(view.showCommercialError).toBe(false)
  })

  it('shows commercial figures only after a permitted summary resolves', () => {
    const pending = loadingCommercial()
    const ready = readyCommercial(4, sumOutstanding([{ balance_due: 1500 }, { balance_due: 25.5 }]), 2)

    expect(showCommercialFigures(pending.phase)).toBe(false)
    expect(showCommercialFigures(ready.phase)).toBe(true)
    expect(ready).toEqual({ phase: 'ready', openQuotes: 4, outstanding: 1525.5, overdue: 2 })
    expect(showCommercialActions(ready.phase)).toBe(true)
  })

  it('keeps quotes and invoices hidden when quotes.view is not granted', () => {
    const hidden = hiddenCommercial()

    expect(showCommercialFigures(hidden.phase)).toBe(false)
    expect(showCommercialActions(hidden.phase)).toBe(false)
    expect(hidden.openQuotes).toBe(0)
    expect(hidden.outstanding).toBe(0)
    expect(hidden.overdue).toBe(0)
  })

  it('does not replace the core dashboard or publish figures when the summary fails', () => {
    const failed = errorCommercial()
    const view = overviewPresentation(false, failed.phase)

    expect(view.showCoreDashboard).toBe(true)
    expect(view.showCoreLoading).toBe(false)
    expect(view.showCommercialFigures).toBe(false)
    expect(view.showCommercialError).toBe(true)
    expect(failed.outstanding).toBe(0)
    expect(showCommercialActions(failed.phase)).toBe(true)
  })

  it('drops a stale commercial result when a newer load is current', () => {
    const current = readyCommercial(9, 400, 1)
    const stale = readyCommercial(1, 5, 0)

    expect(applyIfCurrent(1, 2, stale, current)).toEqual(current)
    expect(applyIfCurrent(2, 2, stale, current)).toEqual(stale)
  })

  it('keeps an idle summary free of figures before the permission check', () => {
    const idle = initialCommercial()

    expect(showCommercialFigures(idle.phase)).toBe(false)
    expect(showCommercialActions(idle.phase)).toBe(false)
    expect(sumOutstanding([])).toBe(0)
    expect(sumOutstanding([{ balance_due: null }, { balance_due: '20' }])).toBe(20)
  })
})