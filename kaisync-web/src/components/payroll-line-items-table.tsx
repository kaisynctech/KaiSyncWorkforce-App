import type { PayrollLineItem } from '@/types/database'

const fmtR = (n: number) =>
  `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface Props {
  items: PayrollLineItem[]
  showAsDeductions?: boolean
  emptyMessage?: string
}

export function PayrollLineItemsTable({ items, showAsDeductions, emptyMessage }: Props) {
  if (items.length === 0) {
    return <p className="text-text-secondary text-[13px]">{emptyMessage ?? 'No items.'}</p>
  }
  return (
    <table className="w-full">
      <tbody>
        {items.map((item, i) => (
          <tr key={i} className="border-b border-divider last:border-0">
            <td className="data-td text-text-primary text-[13px]">{item.label}</td>
            <td
              className="data-td text-right text-[13px] w-[110px]"
              style={{ color: showAsDeductions ? 'var(--color-error)' : 'var(--color-text-primary)' }}
            >
              {fmtR(item.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
