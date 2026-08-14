'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getUnitLabel } from '@/lib/units'
import RequestTab      from './tabs/RequestTab'
import StockSourcingTab from './tabs/StockSourcingTab'
import PricingTab      from './tabs/PricingTab'
import PreviewTab      from './tabs/PreviewTab'
import type { RequestLine } from '@/types/quotes'

// ─── Tabs ───────────────────────────────────────────────────────────────────────

type Tab = 'request' | 'stock' | 'pricing' | 'preview'

const TABS: { id: Tab; label: string; num: string }[] = [
  { id: 'request', label: 'Request',          num: '1' },
  { id: 'stock',   label: 'Stock & Sourcing', num: '2' },
  { id: 'pricing', label: 'Pricing',          num: '3' },
  { id: 'preview', label: 'Preview',          num: '4' },
]

// ─── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  quoteId: string | null
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function QuoteBuilder({ quoteId: initialQuoteId }: Props) {
  const supabase = createClient()
  const router   = useRouter()

  // ── Auth context ──
  const [companyId,  setCompanyId]  = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [authReady,  setAuthReady]  = useState(false)

  // ── Quote state ──
  const [quoteId,      setQuoteId]      = useState<string | null>(initialQuoteId)
  const [quoteNumber,  setQuoteNumber]  = useState<string>('')
  const [quoteStatus,  setQuoteStatus]  = useState<string>('draft')
  const [quoteTitle,   setQuoteTitle]   = useState<string>('')

  // ── Tab state ──
  const [activeTab,    setActiveTab]    = useState<Tab>('request')
  const [requestLines, setRequestLines] = useState<RequestLine[]>([])
  const [processing,   setProcessing]   = useState(false)
  const [allPriced,    setAllPriced]    = useState(false)

  // ── Tab completion dots ──
  const tabComplete: Record<Tab, boolean> = {
    request:  requestLines.length > 0 || !!quoteId,
    stock:    false,  // sourcing tab manages its own confirmation state
    pricing:  allPriced,
    preview:  false,
  }

  // ── Resolve member on mount ──
  useEffect(() => {
    resolveCurrentMember(supabase).then(m => {
      if (!m) return
      setCompanyId(m.companyId)
      setEmployeeId(m.employeeId)
      setAuthReady(true)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load existing quote on mount ──
  const loadQuote = useCallback(async (id: string) => {
    const { data } = await supabase
      .from('commercial_quotes')
      .select('id, quote_number, status, title')
      .eq('id', id)
      .single()
    if (data) {
      setQuoteNumber(data.quote_number ?? '')
      setQuoteStatus(data.status ?? 'draft')
      setQuoteTitle(data.title ?? '')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (quoteId) void loadQuote(quoteId)
  }, [quoteId, loadQuote])

  // ── Generate a new quote number ──
  async function generateQuoteNumber(cid: string): Promise<string> {
    const year = new Date().getFullYear()
    const { count } = await supabase
      .from('commercial_quotes')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', cid)
    const seq = ((count ?? 0) + 1).toString().padStart(4, '0')
    return `QT-${year}-${seq}`
  }

  // ── "Process items" — save lines to DB ──
  async function handleProcess() {
    if (!companyId || !employeeId || requestLines.length === 0) return
    setProcessing(true)
    try {
      let activeQuoteId = quoteId

      // Create quote if not yet created
      if (!activeQuoteId) {
        const qNum = await generateQuoteNumber(companyId)
        const { data: newQuote, error } = await supabase
          .from('commercial_quotes')
          .insert({
            company_id:   companyId,
            quote_number: qNum,
            status:       'draft',
            title:        quoteTitle.trim() || null,
            created_by:   employeeId,
            updated_by:   employeeId,
          })
          .select('id, quote_number')
          .single()
        if (error) throw error
        activeQuoteId = newQuote.id as string
        setQuoteId(activeQuoteId)
        setQuoteNumber(newQuote.quote_number ?? qNum)
        router.replace(`/dashboard/money/quotes/${activeQuoteId}`)
      }

      // Insert or upsert quote lines
      const lineInserts = requestLines.map((line, idx) => ({
        company_id:       companyId,
        quote_id:         activeQuoteId,
        sort_order:       idx + 1,
        item_type:        line.item_type ?? 'part',
        catalogue_item_id: line.catalogue_item_id,
        variant_id:       line.variant_id,
        description:      line.item_name,
        unit:             getUnitLabel(line.unit_of_measure),
        quantity:         line.qty,
        cost_price:       line.cost_price,
        unit_sell_price:  line.unit_sell_price,
        markup_percent:   0,
        subtotal_cost:    line.cost_price * line.qty,
        subtotal_sell:    line.unit_sell_price * line.qty,
        vat_rate:         0.15,
        vat_amount:       line.unit_sell_price * line.qty * 0.15,
        line_total:       line.unit_sell_price * line.qty * 1.15,
        service_delivery: line.service_delivery,
        is_optional:      false,
        is_excluded:      false,
      }))

      // Delete old lines and re-insert (simple approach for Phase 1)
      await supabase.from('commercial_quote_lines').delete()
        .eq('quote_id', activeQuoteId).eq('company_id', companyId)
      await supabase.from('commercial_quote_lines').insert(lineInserts)

      setActiveTab('stock')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save quote lines')
    } finally {
      setProcessing(false)
    }
  }

  if (!authReady) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-text-secondary text-[13px]">
        <span className="material-icons animate-spin text-primary">refresh</span>
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full max-w-7xl mx-auto px-6 pt-5 pb-4">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-5 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/dashboard/money/quotes')}
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <span className="material-icons">arrow_back</span>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[18px] font-semibold text-text-primary">
                {quoteNumber || 'New quote'}
              </h1>
              {quoteNumber && (
                <span className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full font-medium capitalize',
                  quoteStatus === 'sent' ? 'bg-blue-50 text-blue-600' :
                  quoteStatus === 'accepted' ? 'bg-green-50 text-green-600' :
                  'bg-gray-100 text-gray-600',
                )}>
                  {quoteStatus}
                </span>
              )}
            </div>
            {!quoteId && (
              <input
                value={quoteTitle}
                onChange={e => setQuoteTitle(e.target.value)}
                placeholder="Quote title (optional)"
                className="text-[13px] text-text-secondary bg-transparent border-none outline-none mt-0.5 w-64"
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => activeTab !== 'preview' && setActiveTab('preview')}
            disabled={!quoteId}
            className="h-9 px-4 rounded-lg border border-divider text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => alert('PDF generation coming in Phase 2.')}
            disabled={!allPriced || !quoteId}
            className="h-9 px-5 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            Generate quote
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex border-b border-divider mb-5 shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              if (tab.id !== 'request' && !quoteId) return
              setActiveTab(tab.id)
            }}
            disabled={tab.id !== 'request' && !quoteId}
            className={cn(
              'flex items-center gap-2 px-5 py-3 text-[13px] border-b-2 transition-colors -mb-px whitespace-nowrap disabled:opacity-40',
              activeTab === tab.id
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            <span className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0',
              activeTab === tab.id ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary',
            )}>
              {tab.num}
            </span>
            {tab.label}
            {tabComplete[tab.id] && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'request' && companyId && (
          <RequestTab
            companyId={companyId}
            lines={requestLines}
            onChange={setRequestLines}
            onProcess={handleProcess}
            processing={processing}
          />
        )}

        {activeTab === 'stock' && quoteId && companyId && employeeId && (
          <StockSourcingTab
            quoteId={quoteId}
            quoteNumber={quoteNumber}
            companyId={companyId}
            employeeId={employeeId}
          />
        )}

        {activeTab === 'pricing' && quoteId && companyId && (
          <PricingTab
            quoteId={quoteId}
            companyId={companyId}
            onAllPriced={setAllPriced}
          />
        )}

        {activeTab === 'preview' && quoteId && companyId && (
          <PreviewTab
            quoteId={quoteId}
            companyId={companyId}
          />
        )}
      </div>
    </div>
  )
}
