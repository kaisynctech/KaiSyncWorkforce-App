/**
 * Overview paints the core dashboard before the commercial summary.
 * Quotes and invoice figures stay hidden until quotes.view succeeds
 * and those queries return without error.
 */

export type CommercialPhase = 'idle' | 'hidden' | 'loading' | 'ready' | 'error'

export type CommercialSnapshot = {
  phase: CommercialPhase
  openQuotes: number
  outstanding: number
  overdue: number
}

export function initialCommercial(): CommercialSnapshot {
  return { phase: 'idle', openQuotes: 0, outstanding: 0, overdue: 0 }
}

export function hiddenCommercial(): CommercialSnapshot {
  return { phase: 'hidden', openQuotes: 0, outstanding: 0, overdue: 0 }
}

export function loadingCommercial(): CommercialSnapshot {
  return { phase: 'loading', openQuotes: 0, outstanding: 0, overdue: 0 }
}

export function errorCommercial(): CommercialSnapshot {
  return { phase: 'error', openQuotes: 0, outstanding: 0, overdue: 0 }
}

export function readyCommercial(
  openQuotes: number,
  outstanding: number,
  overdue: number,
): CommercialSnapshot {
  return { phase: 'ready', openQuotes, outstanding, overdue }
}

/** Same reduction the Overview invoice tile used while it blocked the page. */
export function sumOutstanding(rows: readonly { balance_due?: unknown }[]): number {
  return rows.reduce((sum, row) => sum + Number(row.balance_due), 0)
}

export function showCommercialFigures(phase: CommercialPhase): boolean {
  return phase === 'ready'
}

/** Quote and invoice actions follow the permission result, not the summary figures. */
export function showCommercialActions(phase: CommercialPhase): boolean {
  return phase === 'loading' || phase === 'ready' || phase === 'error'
}

/** Core dashboard visibility does not wait on the commercial phase. */
export function overviewPresentation(coreLoading: boolean, phase: CommercialPhase) {
  return {
    showCoreLoading: coreLoading,
    showCoreDashboard: !coreLoading,
    showCommercialFigures: !coreLoading && showCommercialFigures(phase),
    showCommercialActions: !coreLoading && showCommercialActions(phase),
    showCommercialError: !coreLoading && phase === 'error',
  }
}

export function isCurrentLoad(requestId: number, currentId: number): boolean {
  return requestId === currentId
}

export function applyIfCurrent<T>(requestId: number, currentId: number, next: T, previous: T): T {
  if (!isCurrentLoad(requestId, currentId)) return previous
  return next
}
