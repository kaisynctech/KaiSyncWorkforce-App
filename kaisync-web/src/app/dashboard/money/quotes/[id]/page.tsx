import SimpleQuoteBuilder from '@/components/quotes/SimpleQuoteBuilder'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditQuotePage({ params }: Props) {
  const { id } = await params
  return <SimpleQuoteBuilder quoteId={id} />
}
