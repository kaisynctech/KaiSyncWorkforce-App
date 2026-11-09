'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  StatusFilterTabs,
  TAB_ALL,
  countByStatusTab,
  filterByStatusTab,
  type StatusTabDef,
} from '@/components/ui/StatusFilterTabs'
import { ResetFiltersButton } from '@/components/ui/MoneyListFilters'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, totalPages } from '@/lib/list-pagination'

export { TAB_ALL, countByStatusTab, filterByStatusTab }
export type { StatusTabDef }

/** Search + reset + optional status pills — same toolbar language as Money lists. */
export function PortalListToolbar({
  search,
  onSearch,
  placeholder,
  resetDisabled,
  onReset,
  tabs,
  statusTabId,
  counts,
  onStatusChange,
  trailing,
}: {
  search: string
  onSearch: (v: string) => void
  placeholder: string
  resetDisabled: boolean
  onReset: () => void
  tabs?: StatusTabDef[]
  statusTabId?: string
  counts?: Record<string, number>
  onStatusChange?: (id: string) => void
  trailing?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 min-w-[160px]">
        <span className="material-icons text-text-disabled text-[16px]">search</span>
        <input
          type="search"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-0 text-[12px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
        />
      </div>
      <ResetFiltersButton disabled={resetDisabled} onReset={onReset} />
      {tabs && statusTabId != null && onStatusChange && (
        <StatusFilterTabs
          tabs={tabs}
          value={statusTabId}
          counts={counts ?? {}}
          onChange={onStatusChange}
        />
      )}
      {trailing}
    </div>
  )
}

/** Dense pager matching Operations / Money lists. */
export function PortalListPager({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  onPageSize: (n: number) => void
}) {
  const pages = totalPages(total, pageSize)
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 border-t border-divider bg-surface">
      <p className="text-[11px] text-text-secondary tabular-nums">
        {total === 0 ? '0 rows' : `${from}–${to} of ${total}`}
      </p>
      <div className="flex items-center gap-1.5">
        <select
          aria-label="Rows per page"
          value={pageSize}
          onChange={e => onPageSize(Number(e.target.value))}
          className="h-8 px-2 rounded-md border border-border bg-surface text-[11px] text-text-primary"
        >
          {PAGE_SIZE_OPTIONS.map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  )
}

/** Client-side page slice + page state that resets when the filtered set shrinks. */
export function usePortalListPaging<T>(rows: T[]) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const pages = totalPages(rows.length, pageSize)
  const safePage = Math.min(page, pages)
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return rows.slice(start, start + pageSize)
  }, [rows, safePage, pageSize])

  function changePageSize(n: number) {
    setPageSize(n)
    setPage(1)
  }

  function changePage(p: number) {
    setPage(Math.max(1, Math.min(p, pages)))
  }

  function resetPage() {
    setPage(1)
  }

  return {
    page: safePage,
    pageSize,
    pageRows,
    total: rows.length,
    setPage: changePage,
    setPageSize: changePageSize,
    resetPage,
  }
}
