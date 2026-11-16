'use client'

import { PaymentsList } from '@/components/money/PaymentsList'

/** Money in → Payments received. */
export default function PaymentsReceivedPage() {
  return <PaymentsList direction="incoming" />
}
