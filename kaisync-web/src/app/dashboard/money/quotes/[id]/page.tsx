import QuoteBuilder from '@/components/quotes/QuoteBuilder'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditQuotePage({ params }: Props) {
  const { id } = await params
  return <QuoteBuilder quoteId={id} />
}
