'use client'

import { PaymentsList } from '@/components/money/PaymentsList'

/** Money out → Bills & expenses → Payments made: supplier bills, contractor payouts and other money out. */
export default function PaymentsMadePage() {
  return <PaymentsList direction="outgoing" />
}
