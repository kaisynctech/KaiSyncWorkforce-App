'use client'

import { QuotesList } from '@/components/money/QuotesList'

/** Money → Incoming Quotes: quotes the business receives (contractor quotes and supplier replies to RFQs). */
export default function IncomingQuotesPage() {
  return <QuotesList kind="incoming" />
}
