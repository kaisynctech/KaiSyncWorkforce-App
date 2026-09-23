'use client'

type Props = {
  page: number
  pageCount: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  label?: string
}

export function ListPagination({ page, pageCount, total, pageSize, onPageChange, label = 'rows' }: Props) {
  if (total <= pageSize && pageCount <= 1) return null
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
      <p className="text-[12px] text-text-secondary">
        {from}–{to} of {total} {label}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40"
        >
          Previous
        </button>
        <span className="text-[12px] text-text-secondary">
          Page {page} / {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className="btn-outlined h-8 px-3 text-[12px] disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}
