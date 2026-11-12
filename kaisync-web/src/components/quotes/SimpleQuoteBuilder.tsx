'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { createProject } from '@/lib/projects'
import { createJob } from '@/lib/jobs'
import { createSupplyRfqFromQuote } from '@/lib/supply-rfq'
import { downloadQuotePdf, openQuoteMailto, quotePdfBase64 } from '@/lib/quote-pdf'
import { previewQuoteEmail, sendQuoteEmailViaResend } from '@/lib/send-quote-email'
import { EmailComposer } from '@/components/email/EmailComposer'
import { draftEdits, type EmailDraft } from '@/lib/email-preview'
import { emptyRecipients, isEmail, RecipientsInput, saveNewContacts, type Recipients } from '@/components/email/RecipientsInput'
import { SenderNote } from '@/components/email/SenderNote'
import { companyLetterhead, type Letterhead } from '@/lib/letterhead'
import {
  companyQuoteVat,
  loadedQuoteVat,
  quoteMoney,
  vatPercentLabel,
  type QuoteVatChoice,
} from '@/lib/quote-vat'
import { escapeIlike } from '@/lib/list-pagination'
import { LineItemsEditor, QuoteTotalsRows } from '@/components/money/LineItemsEditor'
import { createInvoiceFromQuote, openInvoiceForQuote } from '@/lib/money/quote-invoice'
import { CurrencyPicker } from '@/components/money/CurrencyPicker'
import { formatCurrency } from '@/lib/currencies'
import { asItemType, lineQty, lineTotal, loadPickItems, type EditorLine, type ItemType, type PickItem } from '@/lib/line-items'
import { BuyoutPanel, SupplyPill, type BuyoutChoice, type BuyoutQuoteLine } from '@/components/quotes/BuyoutPanel'
import { ensureBuyout, loadBuyout, type Buyout } from '@/lib/money/buyout'
import { priceAfterChoice, supplyModeOf, type SupplyMode } from '@/lib/money/quote-supply'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SimpleQuoteLine {
  id:                 string | null   // DB row id; null for unsaved lines
  tempId:             string          // client-side key
  description:        string
  qty:                number
  unit:               string
  unit_price:         number
  total:              number           // computed: qty × unit_price
  catalogue_item_id:  string | null
  sort_order:         number
  /** Where the line came from: a job service (fixed price), catalogue, inventory, or the user's own line. */
  item_type:          ItemType
  source_id:          string | null
  hint?:              string | null
  /** Cost of one unit to the business (office only). */
  unit_cost?:         number | null
  /** Discount on the line, in %. total is after the discount. */
  discount_pct?:      number | null
  /** How it is supplied (null: worked out from the item, see quote-supply). */
  supply_mode?:       SupplyMode | null
  /** Buyout: the supplier chosen for it, and their reply. */
  supplier_id?:       string | null
  chosen_response_line_id?: string | null
}

type ClientRow = {
  id: string
  name: string
  email?: string | null
  legal_name?: string | null
  client_code?: string | null
  contact_person?: string | null
  currency?: string | null
}

const CLIENT_PICK_COLUMNS = 'id, name, email, legal_name, client_code, contact_person, currency'

function clientPickDetail(row: ClientRow): string {
  return [row.legal_name && row.legal_name !== row.name ? row.legal_name : null, row.client_code, row.contact_person]
    .filter(Boolean)
    .join(' · ')
}
type LinkOpt = { id: string; title: string; label?: string | null }
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayPlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}


function blankLine(): SimpleQuoteLine {
  return {
    id:                crypto.randomUUID(),
    tempId:            crypto.randomUUID(),
    description:       '',
    qty:               1,
    unit:              'each',
    unit_price:        0,
    total:             0,
    catalogue_item_id: null,
    sort_order:        0,
    item_type:         'custom',
    source_id:         null,
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  quoteId: string | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SimpleQuoteBuilder({ quoteId: initialQuoteId }: Props) {
  const supabase = createClient()
  const router   = useRouter()
  const searchParams = useSearchParams()
  const preJobId = searchParams.get('job_id')
  const preDealId = searchParams.get('deal_id')
  const preClientId = searchParams.get('client_id') || searchParams.get('clientId')

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [companyId,  setCompanyId]  = useState<string | null>(null)
  const [companyName, setCompanyName] = useState('KaiSync')
  const [letterhead, setLetterhead] = useState<Letterhead | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [authReady,  setAuthReady]  = useState(false)

  // ── Quote meta ────────────────────────────────────────────────────────────
  const [quoteId,     setQuoteId]     = useState<string | null>(initialQuoteId)
  const [quoteNumber, setQuoteNumber] = useState<string | null>(null)
  const [status,      setStatus]      = useState('draft')
  const [title,       setTitle]       = useState('')
  const [clientId,    setClientId]    = useState<string | null>(null)
  const [validUntil,  setValidUntil]  = useState(todayPlus(14))
  const [notes,       setNotes]       = useState('')
  const [dealId,      setDealId]      = useState<string | null>(null)
  const [jobId,       setJobId]       = useState<string | null>(null)
  const [vatOn,       setVatOn]       = useState(true)
  const [vatRate,     setVatRate]     = useState(0.15)

  // ── Lines ─────────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<SimpleQuoteLine[]>([])

  // ── Clients list ──────────────────────────────────────────────────────────
  const [clients,        setClients]        = useState<ClientRow[]>([])
  const [chosenClient,   setChosenClient]   = useState<ClientRow | null>(null)
  // Currency: defaults from the client (or company home), overridable on this quote.
  const [homeCurrency, setHomeCurrency] = useState('ZAR')
  const [quoteCurrency, setQuoteCurrency] = useState('ZAR')
  const [currencyTouched, setCurrencyTouched] = useState(false)
  const [fxRate, setFxRate] = useState('')
  const [dailyRate, setDailyRate] = useState<number | null>(null)
  const quoteCurrencyRef = useRef('ZAR')
  const homeCurrencyRef = useRef('ZAR')
  const fxRateRef = useRef('')
  useEffect(() => { quoteCurrencyRef.current = quoteCurrency }, [quoteCurrency])
  useEffect(() => { homeCurrencyRef.current = homeCurrency }, [homeCurrency])
  useEffect(() => { fxRateRef.current = fxRate }, [fxRate])
  const foreign = quoteCurrency !== homeCurrency
  const fxNum = Number(fxRate.replace(',', '.'))
  const bookRate = fxNum > 0 ? fxNum : dailyRate
  const [clientListError, setClientListError] = useState<string | null>(null)
  const [clientSearch,   setClientSearch]   = useState('')
  const [clientDropOpen, setClientDropOpen] = useState(false)
  const [addingClient,   setAddingClient]   = useState(false)
  const [newClientName,  setNewClientName]  = useState('')
  const [newClientEmail, setNewClientEmail] = useState('')
  const [creatingClient, setCreatingClient] = useState(false)

  // ── Optional project / job link ───────────────────────────────────────────
  const [projects,   setProjects]   = useState<LinkOpt[]>([])
  const [jobs,       setJobs]       = useState<LinkOpt[]>([])
  const [linkOpen,   setLinkOpen]   = useState(false)

  // ── UI ────────────────────────────────────────────────────────────────────
  const [saveState,       setSaveState]       = useState<SaveState>('idle')
  const [showSendModal,   setShowSendModal]   = useState(false)
  const [sendBusy,        setSendBusy]        = useState(false)
  const [showAcceptModal, setShowAcceptModal] = useState(false)
  const [showWhatsNext,   setShowWhatsNext]   = useState(false)
  const [sentNote,        setSentNote]        = useState<string | null>(null)
  const [sendRcpt,        setSendRcpt]        = useState<Recipients>(emptyRecipients())
  const [sendDraft,       setSendDraft]       = useState<EmailDraft | null>(null)
  const [automationDealId, setAutomationDealId] = useState<string | null>(null)
  const [automationRfqId,  setAutomationRfqId]  = useState<string | null>(null)
  const [automationNote,   setAutomationNote]   = useState<string | null>(null)
  const [actionBusy,      setActionBusy]      = useState(false)
  const [actionError,     setActionError]     = useState<string | null>(null)
  const [rfqBusy,         setRfqBusy]         = useState(false)

  // ── Mutable refs (for use inside async callbacks without stale closures) ──
  const isLoaded       = useRef(false)
  // An accepted quote is an order: it is read-only until someone chooses "Make changes" (and confirms).
  const [unlocked, setUnlocked] = useState(false)
  const [confirmUnlock, setConfirmUnlock] = useState(false)
  // A draft that was never sent can be deleted (after asking).
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const lockedRef = useRef(false)
  // The order's open invoice, if it has one ("Open invoice" instead of "Create invoice").
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null)
  // An existing quote shows "Loading…" until it has loaded, so nothing is typed into an empty form first.
  const [dataLoaded, setDataLoaded] = useState(!initialQuoteId)
  const autoSaveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const quoteIdRef    = useRef<string | null>(initialQuoteId)
  const companyIdRef  = useRef<string | null>(null)
  const employeeIdRef = useRef<string | null>(null)
  const titleRef      = useRef('')
  const clientIdRef   = useRef<string | null>(null)
  const validUntilRef = useRef(todayPlus(14))
  const notesRef      = useRef('')
  const statusRef     = useRef('draft')
  const dealIdRef     = useRef<string | null>(null)
  const jobIdRef      = useRef<string | null>(null)
  const linesRef      = useRef<SimpleQuoteLine[]>([])
  const quoteNumberRef = useRef<string | null>(null)
  const clientSearchSeq = useRef(0)
  const vatOnRef      = useRef(true)
  const vatRateRef    = useRef(0.15)
  const companyVatRef = useRef<QuoteVatChoice>({ vatOn: true, vatRate: 0.15 })

  // Keep refs in sync with state on every render
  quoteIdRef.current     = quoteId
  companyIdRef.current   = companyId
  employeeIdRef.current  = employeeId
  titleRef.current       = title
  clientIdRef.current    = clientId
  validUntilRef.current  = validUntil
  notesRef.current       = notes
  statusRef.current      = status
  dealIdRef.current      = dealId
  jobIdRef.current       = jobId
  linesRef.current       = lines
  quoteNumberRef.current = quoteNumber
  vatOnRef.current       = vatOn
  vatRateRef.current     = vatRate

  // ── Resolve auth on mount ──────────────────────────────────────────────────
  useEffect(() => {
    resolveCurrentMember(supabase).then(async m => {
      if (!m) return
      setCompanyId(m.companyId)
      setEmployeeId(m.employeeId)
      companyIdRef.current  = m.companyId
      employeeIdRef.current = m.employeeId
      const [{ data: company }, { data: home }] = await Promise.all([
        supabase
          .from('companies')
          .select('name, is_vat_registered, default_vat_rate')
          .eq('id', m.companyId)
          .maybeSingle(),
        supabase.rpc('company_home_currency' as never, { p_company_id: m.companyId } as never),
      ])
      const row = company as { name?: string; is_vat_registered?: boolean; default_vat_rate?: number } | null
      const hc = typeof home === 'string' && home ? home : 'ZAR'
      setHomeCurrency(hc)
      if (!quoteIdRef.current && !currencyTouched) {
        setQuoteCurrency(hc)
        quoteCurrencyRef.current = hc
      }
      if (row?.name) setCompanyName(row.name)
      const choice = companyQuoteVat({
        isVatRegistered: row?.is_vat_registered,
        defaultVatRate: row?.default_vat_rate,
      })
      companyVatRef.current = choice
      if (!quoteIdRef.current) {
        setVatOn(choice.vatOn)
        setVatRate(choice.vatRate)
        vatOnRef.current = choice.vatOn
        vatRateRef.current = choice.vatRate
      }
      setAuthReady(true)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load data after auth resolves ──────────────────────────────────────────
  useEffect(() => {
    if (!authReady || !companyId) return
    void loadData(companyId).finally(() => setDataLoaded(true))
    void companyLetterhead(supabase, companyId).then(setLetterhead)
  }, [authReady, companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const locked = status === 'accepted' && !unlocked
  useEffect(() => { lockedRef.current = locked }, [locked])
  useEffect(() => {
    if (status !== 'accepted' || !companyId || !quoteId) return
    let live = true
    void openInvoiceForQuote(supabase, companyId, quoteId).then(id => { if (live) setOpenInvoiceId(id) })
    return () => { live = false }
  }, [status, companyId, quoteId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!companyId) return
    const handle = setTimeout(() => { void searchClients(companyId, clientSearch) }, 200)
    return () => clearTimeout(handle)
  }, [companyId, clientSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  async function rememberClient(cid: string, clientRowId: string | null) {
    if (!clientRowId) return
    const { data } = await supabase
      .from('clients')
      .select(CLIENT_PICK_COLUMNS)
      .eq('company_id', cid)
      .eq('id', clientRowId)
      .maybeSingle()
    if (!data) return
    const row = data as ClientRow
    setChosenClient(row)
    setClientSearch(row.name)
  }

  async function searchClients(cid: string, term: string) {
    const seq = ++clientSearchSeq.current
    let query = supabase
      .from('clients')
      .select(CLIENT_PICK_COLUMNS)
      .eq('company_id', cid)
      .order('name')
      .limit(40)
    const q = term.trim()
    if (q) {
      const escaped = escapeIlike(q)
      query = query.or(
        `name.ilike.%${escaped}%,email.ilike.%${escaped}%,legal_name.ilike.%${escaped}%,client_code.ilike.%${escaped}%,contact_person.ilike.%${escaped}%`,
      )
    }
    const { data, error } = await query
    if (seq !== clientSearchSeq.current) return
    if (error) {
      setClientListError(error.message)
      setClients([])
      return
    }
    setClientListError(null)
    setClients((data ?? []) as ClientRow[])
  }

  async function loadData(cid: string) {
    const [{ data: pData }, { data: jData }] = await Promise.all([
      supabase
        .from('client_deals')
        .select('id, title, project_code')
        .eq('company_id', cid)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('jobs')
        .select('id, title, job_code')
        .eq('company_id', cid)
        .order('created_at', { ascending: false })
        .limit(200),
    ])
    setProjects(
      ((pData ?? []) as { id: string; title: string; project_code: string | null }[]).map(p => ({
        id: p.id,
        title: p.title,
        label: p.project_code,
      })),
    )
    setJobs(
      ((jData ?? []) as { id: string; title: string; job_code: string | null }[]).map(j => ({
        id: j.id,
        title: j.title,
        label: j.job_code,
      })),
    )

    // Load existing quote
    const qid = quoteIdRef.current
    if (qid) {
      const [{ data: qData }, { data: lData }] = await Promise.all([
        supabase
          .from('commercial_quotes')
          .select('*')
          .eq('id', qid)
          .eq('company_id', cid)
          .maybeSingle(),
        supabase
          .from('commercial_quote_lines')
          .select('*')
          .eq('quote_id', qid)
          .order('sort_order'),
      ])

      if (qData) {
        const q = qData as Record<string, unknown>
        const qNum = (q.quote_number as string | null) ?? null
        setQuoteNumber(qNum);      quoteNumberRef.current = qNum
        setStatus((q.status as string) ?? 'draft')
        setTitle((q.title as string) ?? '')
        const cid2 = (q.client_id as string | null) ?? null
        setClientId(cid2);         clientIdRef.current = cid2
        if (q.currency) {
          setQuoteCurrency(String(q.currency))
          setCurrencyTouched(true)
          quoteCurrencyRef.current = String(q.currency)
        }
        if ((q.rate_source as string | null) === 'manual' && q.exchange_rate) {
          setFxRate(String(q.exchange_rate))
        }
        const vu = (q.valid_until as string | null) ?? todayPlus(14)
        setValidUntil(vu);         validUntilRef.current = vu
        const n = (q.scope_notes as string | null) ?? ''
        setNotes(n);               notesRef.current = n
        const did = (q.deal_id as string | null) ?? null
        setDealId(did);            dealIdRef.current = did
        const jid = (q.job_id as string | null) ?? null
        setJobId(jid);             jobIdRef.current = jid
        if (did || jid) setLinkOpen(true)

        await rememberClient(cid, cid2)
      }

      if (lData && lData.length > 0) {
        const mapped: SimpleQuoteLine[] = (lData as Record<string, unknown>[]).map(row => ({
          id:                (row.id as string),
          tempId:            crypto.randomUUID(),
          description:       (row.description as string) ?? '',
          qty:               Number(row.quantity ?? 1),
          unit:              (row.unit as string) ?? 'each',
          unit_price:        Number(row.unit_sell_price ?? 0),
          total:             Number(row.quantity ?? 1) * Number(row.unit_sell_price ?? 0),
          catalogue_item_id: (row.catalogue_item_id as string | null) ?? null,
          sort_order:        Number(row.sort_order ?? 0),
          item_type:         row.job_service_id ? 'service' : row.inventory_item_id ? 'inventory' : row.catalogue_item_id ? 'catalogue' : 'custom',
          source_id:         ((row.job_service_id ?? row.inventory_item_id ?? row.catalogue_item_id) as string | null) ?? null,
          unit_cost:         Number(row.cost_price ?? 0) > 0 ? Number(row.cost_price) : null,
          discount_pct:      Number(row.discount_percent ?? 0) > 0 ? Number(row.discount_percent) : null,
          supply_mode:       (row.supply_mode as SupplyMode | null) ?? null,
          supplier_id:       (row.supplier_id as string | null) ?? null,
          chosen_response_line_id: (row.chosen_response_line_id as string | null) ?? null,
        }))
        // total is after the line's discount.
        for (const m of mapped) m.total = lineTotal({ type: m.item_type, qty: m.qty, unitPrice: m.unit_price, discountPct: m.discount_pct })
        setLines(mapped)
        linesRef.current = mapped
      }

      const loaded = loadedQuoteVat({
        lineRates: ((lData ?? []) as Record<string, unknown>[]).map(row => Number(row.vat_rate ?? 0)),
        subtotal: Number((qData as { subtotal?: number } | null)?.subtotal ?? 0),
        company: companyVatRef.current,
      })
      setVatOn(loaded.vatOn)
      setVatRate(loaded.vatRate)
      vatOnRef.current = loaded.vatOn
      vatRateRef.current = loaded.vatRate
    } else if (preJobId || preDealId || preClientId) {
      // Prefill from deep-link (e.g. Jobs → New quote)
      if (preClientId) {
        setClientId(preClientId)
        clientIdRef.current = preClientId
        await rememberClient(cid, preClientId)
      }
      if (preDealId) {
        setDealId(preDealId)
        dealIdRef.current = preDealId
        setLinkOpen(true)
      }
      if (preJobId) {
        setJobId(preJobId)
        jobIdRef.current = preJobId
        setLinkOpen(true)
      }
    }

    isLoaded.current = true
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function doSave(overrideStatus?: string): Promise<string | null> {
    const cid = companyIdRef.current
    const eid = employeeIdRef.current
    if (!cid || !eid) return null

    setSaveState('saving')
    try {
      let qid  = quoteIdRef.current
      let qNum = quoteNumberRef.current

      // Generate quote number on first save
      if (!qNum) {
        const { data: n } = await (supabase.rpc as any)(
          'generate_quote_number', { p_company_id: cid }
        )
        qNum = n as string
        setQuoteNumber(qNum)
        quoteNumberRef.current = qNum
      }

      const newStatus = overrideStatus ?? statusRef.current
      const ls = linesRef.current
      const lineSubtotal = ls.reduce((s, l) => s + l.total, 0)
      // What the work costs the business (office only): kept on the quote so profit can be tracked.
      const costTotal = Math.round(ls.reduce((s, l) => s + l.qty * (Number(l.unit_cost) || 0), 0) * 100) / 100
      const money = quoteMoney(lineSubtotal, vatOnRef.current, vatRateRef.current)
      const lineVat = money.vat
      const lineTotal = money.total
      const rate = money.vatRate

      // Upsert quote header
      const curr = quoteCurrencyRef.current || homeCurrencyRef.current || 'ZAR'
      const rateTyped = Number(fxRateRef.current.replace(',', '.'))
      const isForeign = curr !== homeCurrencyRef.current
      const payload: Record<string, unknown> = {
        company_id:   cid,
        quote_number: qNum,
        client_id:    clientIdRef.current,
        deal_id:      dealIdRef.current,
        job_id:       jobIdRef.current,
        title:        titleRef.current.trim() || 'Untitled Quote',
        status:       newStatus,
        valid_until:  validUntilRef.current,
        scope_notes:  notesRef.current.trim() || null,
        subtotal:     lineSubtotal,
        vat_amount:   lineVat,
        total_amount: lineTotal,
        cost_total:   costTotal,
        gross_profit: Math.round((lineSubtotal - costTotal) * 100) / 100,
        gross_margin_percent: lineSubtotal > 0 ? Math.round(((lineSubtotal - costTotal) / lineSubtotal) * 10000) / 100 : 0,
        currency:     curr,
        exchange_rate: isForeign && rateTyped > 0 ? rateTyped : null,
        rate_source:   isForeign && rateTyped > 0 ? 'manual' : null,
        updated_at:   new Date().toISOString(),
      }
      if (!qid) payload.created_by = eid
      if (qid)  payload.id = qid
      if (overrideStatus === 'sent') {
        payload.sent_at = new Date().toISOString()
      }
      if (overrideStatus === 'accepted') {
        payload.accepted_at = new Date().toISOString()
      }
      if (overrideStatus === 'declined') {
        payload.declined_at = new Date().toISOString()
      }

      const { data: saved, error: saveErr } = await supabase
        .from('commercial_quotes')
        .upsert(payload)
        .select('id')
        .maybeSingle()
      if (saveErr) throw saveErr
      if (!saved) throw new Error('No data returned from upsert')

      const savedId = (saved as Record<string, unknown>).id as string

      if (!qid) {
        // New quote — update state + URL
        setQuoteId(savedId)
        quoteIdRef.current = savedId
        router.replace(`/dashboard/money/quotes/${savedId}`)
      }

      if (overrideStatus) {
        setStatus(overrideStatus)
        statusRef.current = overrideStatus
      }

      // Save lines: each line keeps its id (suppliers' prices and purchase orders point at it); removed lines are deleted.
      for (const l of ls) if (!l.id) l.id = crypto.randomUUID()
      const keepIds = ls.map(l => l.id as string)
      const del = supabase.from('commercial_quote_lines').delete().eq('quote_id', savedId)
      const { error: delErr } = keepIds.length ? await del.not('id', 'in', `(${keepIds.join(',')})`) : await del
      if (delErr) throw delErr
      if (ls.length > 0) {
        const { error: lineErr } = await supabase.from('commercial_quote_lines').upsert(
          ls.map((l, i) => ({
            id:                l.id,
            company_id:        cid,
            quote_id:          savedId,
            sort_order:        i,
            description:       l.description,
            quantity:          l.qty,
            unit:              l.unit,
            unit_sell_price:   l.unit_price,
            catalogue_item_id: l.item_type === 'catalogue' ? l.source_id ?? l.catalogue_item_id : l.catalogue_item_id,
            job_service_id:    l.item_type === 'service' ? l.source_id : null,
            inventory_item_id: l.item_type === 'inventory' ? l.source_id : null,
            source_type:       l.item_type === 'inventory' ? 'inventory' : l.item_type === 'catalogue' ? 'catalogue' : 'manual',
            cost_price:        Number(l.unit_cost) || 0,
            markup_percent:    Number(l.unit_cost) > 0 && l.qty > 0 ? Math.round(((l.total / l.qty - Number(l.unit_cost)) / Number(l.unit_cost)) * 10000) / 100 : 0,
            discount_percent:  Math.min(100, Math.max(0, Number(l.discount_pct) || 0)),
            subtotal_cost:     Math.round(l.qty * (Number(l.unit_cost) || 0) * 100) / 100,
            subtotal_sell:     l.total,
            vat_rate:          rate,
            vat_amount:        l.total * rate,
            line_total:        l.total * (1 + rate),
            is_optional:       false,
            is_excluded:       false,
            item_type:         l.item_type === 'service' ? 'labour' : 'material',
            supply_mode:       supplyModeOf(l.supply_mode, l.item_type, l.qty, onHandOf(l)),
            supplier_id:       l.supplier_id ?? null,
            chosen_response_line_id: l.chosen_response_line_id ?? null,
          })),
        )
        if (lineErr) throw lineErr
      }

      setSaveState('saved')
      if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current)
      savedFadeTimer.current = setTimeout(() => setSaveState('idle'), 2000)
      return savedId

    } catch (err) {
      console.error('Quote save failed', err)
      setSaveState('error')
      return null
    }
  }

  async function handleDeleteDraft() {
    const cid = companyIdRef.current
    const qid = quoteIdRef.current
    if (!cid || !qid) return
    setDeleting(true)
    setActionError(null)
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    lockedRef.current = true // no autosave while it goes
    // Only a draft that was never sent; its lines go with it.
    const { data, error } = await supabase.from('commercial_quotes').delete()
      .eq('id', qid).eq('company_id', cid).eq('status', 'draft').is('sent_at', null).select('id')
    setDeleting(false)
    if (error || !data?.length) {
      lockedRef.current = false
      setConfirmDelete(false)
      setActionError(error?.message ?? 'Only a draft that was never sent can be deleted.')
      return
    }
    router.push('/dashboard/money/quotes')
  }

  // ── Auto-save scheduler ────────────────────────────────────────────────────
  function scheduleAutoSave() {
    if (!isLoaded.current || lockedRef.current) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      // A new quote is only saved once it has a client or a line, so opening New quote and leaving
      // doesn't leave an empty "Untitled Quote" draft behind.
      if (!quoteIdRef.current && !clientIdRef.current && linesRef.current.length === 0) return
      void doSave()
    }, 1500)
  }

  // ── Field updaters (each sets state + ref + schedules auto-save) ───────────
  function updateTitle(v: string) {
    setTitle(v); titleRef.current = v; scheduleAutoSave()
  }
  function selectClient(id: string | null, name: string, row?: ClientRow | null) {
    setClientId(id); clientIdRef.current = id
    setChosenClient(row ?? null)
    setClientSearch(name); scheduleAutoSave()
  }
  function updateValidUntil(v: string) {
    setValidUntil(v); validUntilRef.current = v; scheduleAutoSave()
  }
  function updateNotes(v: string) {
    setNotes(v); notesRef.current = v; scheduleAutoSave()
  }
  function updateDeal(v: string | null) {
    setDealId(v); dealIdRef.current = v; scheduleAutoSave()
  }
  function updateJob(v: string | null) {
    setJobId(v); jobIdRef.current = v; scheduleAutoSave()
  }
  function updateVatOn(on: boolean) {
    setVatOn(on)
    vatOnRef.current = on
    scheduleAutoSave()
  }

  // ── Line operations ────────────────────────────────────────────────────────
  function updateLine(tempId: string, patch: Partial<SimpleQuoteLine>) {
    setLines(prev => {
      const next = prev.map(l => {
        if (l.tempId !== tempId) return l
        const merged = { ...l, ...patch }
        if (merged.item_type === 'service') merged.qty = 1
        merged.total = merged.qty * merged.unit_price
        return merged
      })
      linesRef.current = next
      return next
    })
    scheduleAutoSave()
  }

  function removeLine(tempId: string) {
    setLines(prev => {
      const next = prev.filter(l => l.tempId !== tempId)
      linesRef.current = next
      return next
    })
    scheduleAutoSave()
  }

  // ── Items editor (shared with invoices) ─────────────────────────────────────
  const [pickItems, setPickItems] = useState<PickItem[]>([])
  const [pickLoading, setPickLoading] = useState(true)

  // Services (with this client's agreed prices), catalogue and inventory for the picker.
  useEffect(() => {
    if (!companyId) return
    let alive = true
    setPickLoading(true)
    loadPickItems(supabase, companyId, clientId || null)
      .then(r => { if (alive) setPickItems(r) })
      .catch(() => { if (alive) setPickItems([]) })
      .finally(() => { if (alive) setPickLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, clientId])

  // A new client brings their currency (unless the currency was chosen by hand).
  useEffect(() => {
    if (currencyTouched) return
    const next = chosenClient?.currency || homeCurrency
    setQuoteCurrency(next)
    quoteCurrencyRef.current = next
  }, [chosenClient, homeCurrency, currencyTouched])

  useEffect(() => {
    if (!foreign) { setDailyRate(null); return }
    let live = true
    void supabase.rpc('fx_rate', { p_from: quoteCurrency, p_to: homeCurrency, p_day: null })
      .then(({ data }) => { if (live) setDailyRate(Number(data) > 0 ? Number(data) : null) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foreign, quoteCurrency, homeCurrency])

  const editorLines: EditorLine[] = lines.map(l => ({
    key: l.tempId,
    type: l.item_type,
    sourceId: l.source_id,
    description: l.description,
    qty: l.qty,
    unitPrice: l.unit_price,
    unit: l.unit,
    hint: l.hint ?? null,
    unitCost: l.unit_cost ?? null,
    discountPct: l.discount_pct ?? null,
  }))

  function handleEditorChange(next: EditorLine[]) {
    const byKey = new Map(linesRef.current.map(l => [l.tempId, l]))
    const mapped: SimpleQuoteLine[] = next.map((e, i) => {
      const prev = byKey.get(e.key)
      const sameItem = !!prev && prev.item_type === e.type && prev.source_id === e.sourceId
      return {
        id:                prev?.id ?? crypto.randomUUID(),
        tempId:            e.key,
        description:       e.description,
        qty:               lineQty(e),
        unit:              e.unit || prev?.unit || 'each',
        unit_price:        e.unitPrice,
        total:             lineTotal(e),
        catalogue_item_id: e.type === 'catalogue' ? e.sourceId : prev?.catalogue_item_id ?? null,
        sort_order:        i,
        item_type:         e.type,
        source_id:         e.sourceId,
        hint:              e.hint ?? null,
        unit_cost:         e.unitCost ?? null,
        discount_pct:      e.discountPct ?? null,
        supply_mode:       sameItem ? prev?.supply_mode ?? null : null,
        supplier_id:       sameItem ? prev?.supplier_id ?? null : null,
        chosen_response_line_id: sameItem ? prev?.chosen_response_line_id ?? null : null,
      }
    })
    setLines(mapped)
    linesRef.current = mapped
    scheduleAutoSave()
  }

  // ── How lines are supplied, and the Buyout tab ────────────────────────────
  function onHandOf(l: Pick<SimpleQuoteLine, 'item_type' | 'source_id'>): number | null {
    if (l.item_type !== 'inventory' || !l.source_id) return null
    return pickItems.find(p => p.type === 'inventory' && p.sourceId === l.source_id)?.onHand ?? null
  }
  const modeOf = (l: SimpleQuoteLine) => supplyModeOf(l.supply_mode, l.item_type, l.qty, onHandOf(l))

  function setSupplyMode(tempId: string, mode: SupplyMode) {
    setLines(prev => {
      const next = prev.map(l => (l.tempId === tempId ? { ...l, supply_mode: mode, ...(mode === 'outsource' ? {} : { supplier_id: null, chosen_response_line_id: null }) } : l))
      linesRef.current = next
      return next
    })
    scheduleAutoSave()
  }

  const [quoteView, setQuoteView] = useState<'items' | 'buyout'>('items')
  const [buyout, setBuyout] = useState<Buyout | null>(null)
  const [keepMode, setKeepMode] = useState<'margin' | 'price'>(() => {
    try { return localStorage.getItem('kaisync.buyout.keep') === 'price' ? 'price' : 'margin' } catch { return 'margin' }
  })
  const [defaultMargin, setDefaultMargin] = useState<number>(() => {
    try { const n = Number(localStorage.getItem('kaisync.buyout.margin')); return n > 0 && n < 95 ? n : 25 } catch { return 25 }
  })
  function rememberKeep(k: 'margin' | 'price') { setKeepMode(k); try { localStorage.setItem('kaisync.buyout.keep', k) } catch { /* fine */ } }
  function rememberMargin(n: number) { setDefaultMargin(n); try { localStorage.setItem('kaisync.buyout.margin', String(n)) } catch { /* fine */ } }

  async function reloadBuyout() {
    const cid = companyIdRef.current
    const qid = quoteIdRef.current
    if (!cid || !qid) return
    setBuyout(await loadBuyout(supabase, cid, qid))
  }

  // Suppliers' replies for the Supply pills (once the quote is open).
  useEffect(() => {
    if (!dataLoaded || !companyId || !quoteId) return
    void loadBuyout(supabase, companyId, quoteId).then(setBuyout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded, companyId, quoteId])

  /** Saves the quote and brings the buyout in step with its outsourced lines. Returns an error, or null. */
  async function ensureQuoteBuyout(): Promise<string | null> {
    const cid = companyIdRef.current
    const qid = await doSave()
    if (!qid || !cid) return 'Save the quote first (it needs a client or a line).'
    const out = linesRef.current.filter(l => modeOf(l) === 'outsource' && l.id && l.description.trim())
    const r = await ensureBuyout(supabase, {
      companyId: cid, quoteId: qid, employeeId: employeeIdRef.current, title: titleRef.current || 'Request for quotation',
      dealId: dealIdRef.current, lines: out.map(l => ({ id: l.id as string, description: l.description, qty: l.qty, unit: l.unit })),
    })
    if ('error' in r) return r.error
    await reloadBuyout()
    return null
  }

  async function openBuyout() {
    setQuoteView('buyout')
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /** A supplier's price (or your own cost) chosen in the Buyout tab: it goes on the quote line. */
  function chooseForLine(quoteLineId: string, choice: BuyoutChoice) {
    setLines(prev => {
      const next = prev.map(l => {
        if (l.id !== quoteLineId) return l
        const cost = 'ownCost' in choice ? choice.ownCost : choice.cost
        const price = priceAfterChoice({ cost, prevCost: l.unit_cost, prevPrice: l.unit_price, discountPct: l.discount_pct, keep: keepMode, defaultMarginPct: defaultMargin })
        const merged: SimpleQuoteLine = {
          ...l, unit_cost: cost, unit_price: price,
          supplier_id: 'ownCost' in choice ? null : choice.supplierId,
          chosen_response_line_id: 'ownCost' in choice ? null : choice.responseLineId,
        }
        merged.total = lineTotal({ type: merged.item_type, qty: merged.qty, unitPrice: merged.unit_price, discountPct: merged.discount_pct })
        return merged
      })
      linesRef.current = next
      return next
    })
    scheduleAutoSave()
  }

  const outsourcedLines: BuyoutQuoteLine[] = lines.filter(l => l.id && modeOf(l) === 'outsource').map(l => ({
    id: l.id as string, description: l.description, qty: l.qty, unit: l.unit, unitCost: l.unit_cost ?? null,
    supplierId: l.supplier_id ?? null, chosenResponseLineId: l.chosen_response_line_id ?? null,
  }))
  const sourcing = (() => {
    const chosen = outsourcedLines.filter(l => l.chosenResponseLineId || (l.unitCost ?? 0) > 0).length
    const waiting = outsourcedLines.filter(l => {
      if (l.chosenResponseLineId || (l.unitCost ?? 0) > 0) return false
      const bl = buyout?.lines.find(b => b.quoteLineId === l.id)
      return !!bl && (buyout?.recipients ?? []).some(r => r.status !== 'pending' && (!r.lineIds || r.lineIds.includes(bl.rfqLineId)))
    }).length
    return { count: outsourcedLines.length, chosen, waiting }
  })()

  function lineExtra(e: EditorLine) {
    const l = lines.find(x => x.tempId === e.key)
    if (!l || !e.description.trim()) return null
    const mode = modeOf(l)
    const onHand = onHandOf(l)
    const sel = 'h-6 rounded-md border border-divider bg-background px-1.5 text-[11.5px] text-text-primary focus:outline-none focus:border-primary/60'
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {mode === 'stock' ? (
          <>
            <span className="h-6 px-2 rounded-full bg-sky-50 text-sky-800 text-[11px] font-semibold inline-flex items-center gap-1">
              <span className="material-icons !text-[13px]">inventory_2</span>From stock{onHand != null ? ` · ${onHand.toLocaleString('en-ZA')} on hand` : ''}
            </span>
            {!locked && <button type="button" onClick={() => setSupplyMode(l.tempId, 'outsource')} className="text-[11.5px] text-primary hover:underline">Outsource instead</button>}
          </>
        ) : (
          <>
            <select value={mode} disabled={locked} aria-label="How this line is supplied" className={sel}
              onChange={ev => setSupplyMode(l.tempId, ev.target.value as SupplyMode)}>
              <option value="outsource">Outsource</option>
              <option value="service">Service</option>
            </select>
            {mode === 'outsource' && l.id && (
              <SupplyPill line={{ id: l.id, description: l.description, qty: l.qty, unit: l.unit, unitCost: l.unit_cost ?? null, supplierId: l.supplier_id ?? null, chosenResponseLineId: l.chosen_response_line_id ?? null }}
                buyout={buyout} currency={quoteCurrency} onOpenBuyout={() => void openBuyout()} />
            )}
            {l.item_type === 'inventory' && (onHand ?? 0) >= Math.max(l.qty, 1) && !locked && (
              <button type="button" onClick={() => setSupplyMode(l.tempId, 'stock')} className="text-[11.5px] text-primary hover:underline">Use stock ({onHand})</button>
            )}
          </>
        )}
      </div>
    )
  }

  // ── Add new client ─────────────────────────────────────────────────────────
  async function handleCreateClient() {
    if (!newClientName.trim() || !companyId) return
    setCreatingClient(true)
    const { data } = await supabase
      .from('clients')
      .insert({
        company_id: companyId,
        name:       newClientName.trim(),
        email:      newClientEmail.trim() || null,
      })
      .select(CLIENT_PICK_COLUMNS)
      .maybeSingle()
    if (data) {
      const c = data as ClientRow
      setClients(prev => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
      selectClient(c.id, c.name, c)
    }
    setCreatingClient(false)
    setAddingClient(false)
    setNewClientName('')
    setNewClientEmail('')
    setClientDropOpen(false)
  }

  // ── Mark as sent ───────────────────────────────────────────────────────────
  async function handleMarkAsSent() {
    await doSave('sent')
    setShowSendModal(false)
  }

  function buildPdfInput() {
    const client = chosenClient?.id === clientIdRef.current ? chosenClient : clients.find(c => c.id === clientIdRef.current)
    return {
      currency: quoteCurrency,
      quote_number: quoteNumberRef.current,
      title: titleRef.current.trim() || 'Untitled quote',
      status: statusRef.current,
      valid_until: validUntilRef.current,
      notes: notesRef.current.trim() || null,
      client_name: client?.name ?? null,
      client_email: client?.email ?? null,
      company_name: companyName,
      letterhead,
      lines: linesRef.current.map(l => ({
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        unit_price: l.unit_price,
        total: l.total,
        discount_pct: Number(l.discount_pct) || 0,
      })),
      ...(() => {
        const money = quoteMoney(
          linesRef.current.reduce((s, l) => s + l.total, 0),
          vatOnRef.current,
          vatRateRef.current,
        )
        return { subtotal: money.subtotal, vat: money.vat, total: money.total, vatRate: money.vatRate }
      })(),
    }
  }

  function handleDownloadPdf() {
    downloadQuotePdf(buildPdfInput())
  }

  /** Prefer Resend Edge send when configured; otherwise mailto + PDF download. */
  async function handleSendWithMailto() {
    setSendBusy(true)
    setActionError(null)
    const qid = await doSave()
    if (!qid) {
      setSendBusy(false)
      return
    }
    const pdf = buildPdfInput()
    const to = sendRcpt.to.trim() || pdf.client_email || ''
    const resend = await sendQuoteEmailViaResend(supabase, {
      quoteId: qid,
      pdfBase64: quotePdfBase64(pdf),
      recipientEmail: to,
      cc: sendRcpt.cc,
      bodyText: draftEdits(sendDraft).body_text,
      filename: `Quote_${(pdf.quote_number || 'draft').replace(/[^\w.-]+/g, '_')}.pdf`,
      subject: draftEdits(sendDraft).subject ?? `Quote ${pdf.quote_number ?? ''} – ${pdf.title || 'Quotation'}`.trim(),
    })

    if (resend.ok) {
      setStatus('sent')
      statusRef.current = 'sent'
      setShowSendModal(false)
      setSendBusy(false)
      const cid = clientIdRef.current
      const saved = sendRcpt.saveNew && cid && companyIdRef.current
        ? await saveNewContacts(supabase, { companyId: companyIdRef.current, clientId: cid, clientEmail: pdf.client_email, emails: [to, ...sendRcpt.cc] })
        : 0
      // Sent is not accepted: the client accepts online or you press Mark accepted.
      setSentNote(`Emailed to ${resend.recipient_email ?? to}${sendRcpt.cc.length ? ` (cc ${sendRcpt.cc.join(', ')})` : ''}.${saved ? ` ${saved} new contact${saved === 1 ? '' : 's'} saved.` : ''} They can accept it online from the email, or press Mark accepted when they confirm.`)
      return
    }

    if (resend.reason === 'send_failed') {
      setActionError(resend.message ?? 'Email send failed. You can still use mailto.')
    }

    downloadQuotePdf(pdf)
    openQuoteMailto({
      to: to || pdf.client_email,
      quoteNumber: pdf.quote_number,
      title: pdf.title,
      companyName: companyName,
    })
    await doSave('sent')
    setShowSendModal(false)
    setSendBusy(false)
  }

  async function handleMarkAccepted() {
    setActionError(null)
    setAutomationDealId(null)
    setAutomationRfqId(null)
    setAutomationNote(null)
    const id = await doSave('accepted')
    setShowAcceptModal(false)
    if (!id) {
      setActionError('Could not mark quote as accepted. Try saving again.')
      return
    }
    try {
      const res = await fetch('/api/automations/quote-accepted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: id }),
      })
      if (res.ok) {
        const body = await res.json() as {
          skipped?: boolean
          results?: Array<Record<string, unknown>>
        }
        if (!body.skipped && Array.isArray(body.results)) {
          let dealFromAuto: string | null = null
          let rfqFromAuto: string | null = null
          for (const r of body.results) {
            if (typeof r.deal_id === 'string') dealFromAuto = r.deal_id
            if (typeof r.rfq_id === 'string') rfqFromAuto = r.rfq_id
          }
          if (dealFromAuto) {
            setAutomationDealId(dealFromAuto)
            setDealId(dealFromAuto)
            dealIdRef.current = dealFromAuto
          }
          if (rfqFromAuto) setAutomationRfqId(rfqFromAuto)
          if (dealFromAuto || rfqFromAuto) {
            setAutomationNote('Automation created follow-up records for this quote.')
          }
        }
      }
    } catch {
      /* automation failure must not interrupt the quote flow */
    }
    setShowWhatsNext(true)
  }

  async function handleCreateProjectFromQuote() {
    const cid = companyIdRef.current
    const qid = quoteIdRef.current
    if (!cid || !qid) return
    setActionBusy(true)
    setActionError(null)
    const result = await createProject(supabase, {
      companyId: cid,
      title: titleRef.current.trim() || quoteNumberRef.current || 'Project from quote',
      clientId: clientIdRef.current,
      status: 'in_progress',
      assignCode: true,
      notes: notesRef.current.trim() || null,
    })
    if (!result.ok) {
      setActionError(result.message)
      setActionBusy(false)
      return
    }
    setDealId(result.data.id)
    dealIdRef.current = result.data.id
    await supabase
      .from('commercial_quotes')
      .update({ deal_id: result.data.id })
      .eq('id', qid)
      .eq('company_id', cid)
    setActionBusy(false)
    setShowWhatsNext(false)
    router.push(`/dashboard/projects/${result.data.id}`)
  }

  async function handleCreateJobFromQuote() {
    const cid = companyIdRef.current
    const eid = employeeIdRef.current
    const qid = quoteIdRef.current
    if (!cid || !qid) return
    setActionBusy(true)
    setActionError(null)
    const result = await createJob(supabase, {
      companyId: cid,
      title: titleRef.current.trim() || quoteNumberRef.current || 'Job from quote',
      clientId: clientIdRef.current,
      dealId: dealIdRef.current,
      createdByEmployeeId: eid,
      assignCode: true,
      status: 'open',
    })
    if (!result.ok) {
      setActionError(result.message)
      setActionBusy(false)
      return
    }
    setJobId(result.data.id)
    jobIdRef.current = result.data.id
    await supabase
      .from('commercial_quotes')
      .update({ job_id: result.data.id })
      .eq('id', qid)
      .eq('company_id', cid)
    setActionBusy(false)
    setShowWhatsNext(false)
    router.push(`/dashboard/jobs/${result.data.id}`)
  }

  async function handleCreateInvoiceFromQuote() {
    const cid = companyIdRef.current
    const eid = employeeIdRef.current
    const qid = quoteIdRef.current
    if (!cid || !qid) return
    setActionBusy(true)
    setActionError(null)
    // Any unsaved change goes in first; then the same rules as everywhere else (one open invoice per quote).
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); await doSave() }
    const r = await createInvoiceFromQuote(supabase, { companyId: cid, quoteId: qid, employeeId: eid })
    setActionBusy(false)
    if ('error' in r) { setActionError(r.error); return }
    setShowWhatsNext(false)
    router.push(r.created ? `/dashboard/money/invoices/${r.id}/edit` : `/dashboard/money/invoices/${r.id}`)
  }

  async function handleCreateRfqFromQuote() {
    const cid = companyIdRef.current
    const eid = employeeIdRef.current
    setRfqBusy(true)
    setActionError(null)
    const savedId = await doSave()
    if (!savedId || !cid) {
      setActionError('Save the quote before creating an RFQ.')
      setRfqBusy(false)
      return
    }
    const result = await createSupplyRfqFromQuote(supabase, {
      companyId: cid,
      quoteId: savedId,
      employeeId: eid,
      dealId: dealIdRef.current,
      reuseExisting: true,
    })
    setRfqBusy(false)
    if (!result.ok) {
      setActionError(result.message)
      return
    }
    router.push(`/dashboard/supply/rfqs/${result.data.id}`)
  }

  // ── Computed totals ────────────────────────────────────────────────────────
  const subtotal = lines.reduce((s, l) => s + l.total, 0)
  const money = quoteMoney(subtotal, vatOn, vatRate)
  const vat = money.vat
  const total = money.total
  const linkedProject = projects.find(p => p.id === dealId)
  const linkedJob = jobs.find(j => j.id === jobId)

  // ── Client dropdown ────────────────────────────────────────────────────────
  const clientName = chosenClient?.id === clientId ? chosenClient.name : (clients.find(c => c.id === clientId)?.name ?? '')

  // ── Render ────────────────────────────────────────────────────────────────

  if (!authReady || !dataLoaded) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-text-secondary text-[13px]">
        <span className="material-icons animate-spin text-primary text-[20px]">refresh</span>
        Loading…
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full px-6 py-6 flex flex-col gap-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => router.push('/dashboard/money/quotes')}
              className="shrink-0 text-text-secondary hover:text-text-primary transition-colors"
            >
              <span className="material-icons">arrow_back</span>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[18px] font-semibold text-text-primary">
                  {quoteNumber ?? 'New quote'}
                </h1>
                {status !== 'draft' && (
                  <span className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full font-medium capitalize',
                    status === 'sent'     ? 'bg-amber-50 text-amber-700' :
                    status === 'accepted' ? 'bg-green-50 text-green-600' :
                    status === 'declined' ? 'bg-red-50 text-red-600' :
                    'bg-surface-elevated text-text-secondary',
                  )}>
                    {status.replace('_', ' ')}
                  </span>
                )}
              </div>
              <input
                value={title}
                onChange={e => updateTitle(e.target.value)}
                disabled={locked}
                placeholder="Quote title (optional)"
                className="text-[13px] text-text-secondary bg-transparent border-none outline-none mt-0.5 w-72 placeholder-text-secondary/40"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* Save state indicator */}
            {saveState === 'saving' && (
              <span className="text-[12px] text-text-secondary flex items-center gap-1">
                <span className="material-icons text-[14px] animate-spin">refresh</span>
                Saving…
              </span>
            )}
            {saveState === 'saved' && (
              <span className="text-[12px] text-green-600 flex items-center gap-1">
                <span className="material-icons text-[14px]">check_circle</span>
                Saved
              </span>
            )}
            {saveState === 'error' && (
              <button
                type="button"
                onClick={() => void doSave()}
                className="text-[12px] text-red-500 flex items-center gap-1 hover:text-red-600"
              >
                <span className="material-icons text-[14px]">error_outline</span>
                Save failed — retry
              </button>
            )}

            {!locked && (
            <button
              type="button"
              onClick={() => void doSave()}
              disabled={saveState === 'saving'}
              className="h-9 px-4 rounded-lg border border-divider text-[13px] text-text-secondary font-medium hover:bg-surface-elevated transition-colors disabled:opacity-50"
            >
              {status === 'draft' ? 'Save draft' : 'Save'}
            </button>
            )}
            {status === 'draft' && quoteId && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="h-9 px-3 rounded-lg border border-divider text-[13px] text-text-secondary font-medium hover:bg-red-50 hover:text-error transition-colors flex items-center gap-1"
              >
                <span className="material-icons text-[15px]">delete</span>
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="h-9 px-4 rounded-lg border border-divider text-[13px] text-text-secondary font-medium hover:bg-surface-elevated transition-colors flex items-center gap-1"
            >
              <span className="material-icons text-[15px]">picture_as_pdf</span>
              PDF
            </button>
            {status !== 'accepted' && status !== 'declined' && (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    const email = (chosenClient?.id === clientId ? chosenClient.email : clients.find(c => c.id === clientId)?.email) ?? ''
                    setSendRcpt(emptyRecipients(email))
                    setSendDraft(null)
                    setActionError(null)
                    // The preview reads the saved quote, so save the latest changes first.
                    if (!(await doSave())) return
                    setShowSendModal(true)
                  }}
                  disabled={saveState === 'saving'}
                  className="h-9 px-4 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  Send quote
                </button>
                <button
                  type="button"
                  onClick={() => setShowAcceptModal(true)}
                  disabled={saveState === 'saving'}
                  className="h-9 px-4 rounded-lg border border-divider text-[13px] text-text-secondary font-medium hover:bg-surface-elevated transition-colors disabled:opacity-50"
                >
                  Mark accepted
                </button>
              </>
            )}
            {status === 'accepted' && (
              <button
                type="button"
                onClick={() => { setActionError(null); setShowWhatsNext(true) }}
                className="h-9 px-5 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors"
              >
                What&apos;s next?
              </button>
            )}
          </div>
        </div>

        {status === 'accepted' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                <span className="material-icons text-[20px]">check</span>
              </span>
              <div>
                <p className="text-[14.5px] font-semibold text-emerald-900">Quote accepted{clientName ? ` by ${clientName}` : ''}</p>
                <p className="text-[12.5px] text-emerald-800">It&apos;s now an order. See everything for it in one place: invoices, payments, purchasing and credit notes.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
            <Link
              href={`/dashboard/money/orders/${quoteId}`}
              className="h-11 px-5 rounded-xl border border-emerald-300 bg-white text-emerald-800 text-[14px] font-semibold flex items-center gap-2 hover:bg-emerald-100"
            >
              <span className="material-icons text-[18px]">assignment_turned_in</span>
              Open order
            </Link>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void handleCreateInvoiceFromQuote()}
              className="h-11 px-5 rounded-xl bg-emerald-600 text-white text-[14px] font-semibold flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-60"
            >
              <span className="material-icons text-[18px]">receipt_long</span>
              {actionBusy ? 'Opening…' : openInvoiceId ? 'Open invoice' : 'Create invoice'}
            </button>
            </div>
          </div>
        )}

        {status === 'accepted' && (locked ? (
          confirmUnlock ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
              <p className="text-[13px] font-semibold text-amber-900">Change an accepted quote?</p>
              <p className="text-[12.5px] text-amber-900">
                The client accepted this quote as it is. Changes are saved on the quote only: {openInvoiceId ? 'its invoice is not changed, so check the invoice too' : 'the invoice made from it later will use the changes'}, and the client isn&apos;t told.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmUnlock(false)} className="h-8 px-3 rounded-lg border border-amber-300 bg-white text-[12.5px] text-amber-900 font-medium">Keep it locked</button>
                <button type="button" onClick={() => { setUnlocked(true); setConfirmUnlock(false) }} className="h-8 px-3 rounded-lg bg-amber-600 text-white text-[12.5px] font-semibold">Make changes</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-divider bg-surface-elevated px-4 py-2">
              <p className="text-[12.5px] text-text-secondary flex items-center gap-1.5">
                <span className="material-icons !text-[15px] !leading-none">lock</span>
                Locked: this quote is an order now, so its lines, prices and client can&apos;t be changed by accident.
              </p>
              <button type="button" onClick={() => setConfirmUnlock(true)} className="h-7 px-3 rounded-lg border border-divider bg-surface text-[12px] font-medium text-text-primary hover:bg-surface-elevated">Make changes</button>
            </div>
          )
        ) : (
          <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-[12.5px] text-amber-900 flex items-center gap-1.5">
            <span className="material-icons !text-[15px] !leading-none">edit</span>
            You&apos;re changing an accepted quote. {openInvoiceId ? 'Its invoice is not changed: check it too.' : ''}
            <button type="button" onClick={() => setUnlocked(false)} className="ml-auto h-7 px-3 rounded-lg border border-amber-300 bg-white text-[12px] font-medium">Lock again</button>
          </p>
        ))}

        {sentNote && !actionError && (
          <p className="text-[12px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <span className="material-icons text-[15px]">mark_email_read</span>
            <span className="flex-1">{sentNote}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setSentNote(null)} className="text-emerald-700 hover:text-emerald-900">
              <span className="material-icons text-[15px]">close</span>
            </button>
          </p>
        )}

        {confirmDelete && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 space-y-2">
            <p className="text-[13px] font-semibold text-red-900">Delete draft {quoteNumber ?? ''}?</p>
            <p className="text-[12.5px] text-red-900">The quote and its lines are removed for good. Only drafts that were never sent can be deleted.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-8 px-3 rounded-lg border border-red-200 bg-white text-[12.5px] text-red-900 font-medium">Keep it</button>
              <button type="button" disabled={deleting} onClick={() => void handleDeleteDraft()} className="h-8 px-3 rounded-lg bg-red-600 text-white text-[12.5px] font-semibold disabled:opacity-60">{deleting ? 'Deleting…' : 'Delete draft'}</button>
            </div>
          </div>
        )}

        {actionError && !showWhatsNext && !showAcceptModal && (
          <p className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {actionError}
          </p>
        )}

        {/* An accepted quote is locked: everything in here is read-only until "Make changes". */}
        <fieldset disabled={locked} className="min-w-0 m-0 p-0 border-0 flex flex-col gap-6">
        {/* ── Quote meta ── */}
        <div className="rounded-xl border border-divider bg-surface px-4 py-3 grid grid-cols-2 sm:grid-cols-12 gap-x-3 gap-y-2.5">

          {/* Customer combobox */}
          <div className="col-span-2 sm:col-span-5 relative">
            <label className="block text-[10.5px] text-text-secondary uppercase tracking-wide mb-1">
              Customer
            </label>
            <input
              type="text"
              placeholder="Search or select client…"
              value={clientSearch}
              onChange={e => { setClientSearch(e.target.value); setClientDropOpen(true) }}
              onFocus={() => setClientDropOpen(true)}
              onBlur={() => setTimeout(() => setClientDropOpen(false), 160)}
              className="w-full h-8 rounded-lg border border-divider bg-surface px-2.5 text-[12.5px] text-text-primary focus:outline-none focus:border-primary transition-colors"
            />

            {/* Client dropdown */}
            {clientDropOpen && !addingClient && (
              <div className="absolute left-0 top-full mt-1 z-50 w-full bg-surface border border-divider rounded-xl shadow-xl py-1 max-h-48 overflow-y-auto">
                {clients.map(c => {
                  const detail = clientPickDetail(c)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={() => { selectClient(c.id, c.name, c); setClientDropOpen(false) }}
                      className={cn(
                        'w-full text-left px-3 py-2 text-[13px] hover:bg-surface-elevated transition-colors',
                        c.id === clientId ? 'text-primary font-medium' : 'text-text-primary',
                      )}
                    >
                      <span className="block">{c.name}</span>
                      {detail && <span className="block text-[11px] text-text-secondary">{detail}</span>}
                    </button>
                  )
                })}
                {clients.length === 0 && (
                  <p className="px-3 py-2 text-[12px] text-text-secondary">
                    {clientListError ?? (clientSearch.trim() ? 'No clients found' : 'No clients yet')}
                  </p>
                )}
                <div className="border-t border-divider mt-1 pt-1">
                  <button
                    type="button"
                    onMouseDown={() => { setAddingClient(true); setClientDropOpen(false) }}
                    className="w-full text-left px-3 py-2 text-[12px] text-primary hover:bg-surface-elevated transition-colors flex items-center gap-1"
                  >
                    <span className="material-icons text-[14px]">add</span>
                    Add new client
                  </button>
                </div>
              </div>
            )}

            {/* Add new client inline form */}
            {addingClient && (
              <div className="mt-2 p-3 rounded-lg border border-divider bg-surface-elevated space-y-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="Client name *"
                  value={newClientName}
                  onChange={e => setNewClientName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && void handleCreateClient()}
                  className="w-full h-8 rounded-md border border-divider bg-surface px-2.5 text-[12px] focus:outline-none focus:border-primary transition-colors"
                />
                <input
                  type="email"
                  placeholder="Email (optional)"
                  value={newClientEmail}
                  onChange={e => setNewClientEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && void handleCreateClient()}
                  className="w-full h-8 rounded-md border border-divider bg-surface px-2.5 text-[12px] focus:outline-none focus:border-primary transition-colors"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setAddingClient(false); setNewClientName(''); setNewClientEmail('') }}
                    className="h-7 px-3 text-[11px] text-text-secondary border border-divider rounded-md hover:bg-surface transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateClient()}
                    disabled={!newClientName.trim() || creatingClient}
                    className="h-7 px-3 text-[11px] text-white bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {creatingClient ? 'Creating…' : 'Create client'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quote number */}
          <div className="col-span-1 sm:col-span-2 sm:order-3">
            <label className="block text-[10.5px] text-text-secondary uppercase tracking-wide mb-1">
              Quote #
            </label>
            <div className="h-8 flex items-center text-[12.5px] text-text-secondary px-2.5 rounded-lg border border-divider bg-surface-elevated">
              {quoteNumber ?? '— (auto)'}
            </div>
          </div>

          {/* Valid until */}
          <div className="col-span-1 sm:col-span-2 sm:order-4">
            <label className="block text-[10.5px] text-text-secondary uppercase tracking-wide mb-1">
              Valid until
            </label>
            <input
              type="date"
              value={validUntil}
              onChange={e => updateValidUntil(e.target.value)}
              className="w-full h-8 rounded-lg border border-divider bg-surface px-2.5 text-[12.5px] text-text-primary focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Currency and, for a foreign currency, the exchange rate (can be changed) */}
          <div className="col-span-2 sm:col-span-3 sm:order-2">
            <CurrencyPicker
              compact
              value={quoteCurrency}
              allowDefault={false}
              homeCurrency={homeCurrency}
              label="Currency"
              onChange={c => {
                const next = c ?? homeCurrency
                setQuoteCurrency(next)
                quoteCurrencyRef.current = next
                setCurrencyTouched(true)
                scheduleAutoSave()
              }}
            />
          </div>
          {foreign && (
            <div className="col-span-2 sm:col-span-12 sm:order-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-text-secondary">
              <span className="text-[10.5px] uppercase tracking-wide">Exchange rate</span>
              <span>1 {quoteCurrency} =</span>
              <input
                inputMode="decimal"
                value={fxRate}
                aria-label="Exchange rate"
                onChange={e => { setFxRate(e.target.value); scheduleAutoSave() }}
                placeholder={dailyRate ? dailyRate.toFixed(4) : 'today'}
                className="w-24 h-7 rounded-md border border-divider bg-surface px-2 text-right text-[12.5px] text-text-primary focus:outline-none focus:border-primary transition-colors"
              />
              <span>{homeCurrency}{fxNum > 0 ? '' : " (today's rate)"}</span>
              {bookRate && bookRate > 0 && (
                <span>· ≈ {formatCurrency(Math.round(total * bookRate * 100) / 100, homeCurrency)} in your books</span>
              )}
            </div>
          )}
        </div>

        {/* ── Optional project / job link ── */}
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <button
              type="button"
              onClick={() => setLinkOpen(v => !v)}
              className="text-primary font-medium hover:underline"
            >
              {linkOpen ? 'Hide project and job' : 'Link a project or job'}
            </button>
            {!linkOpen && (linkedProject || linkedJob) && (
              <span className="text-text-secondary">
                {[linkedProject?.title, linkedJob?.title].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
          {linkOpen && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] text-text-secondary uppercase tracking-wide mb-1.5">
                  Project
                </label>
                <select
                  value={dealId ?? ''}
                  onChange={e => updateDeal(e.target.value || null)}
                  className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="">— None —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.label ? `${p.label} · ${p.title}` : p.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-secondary uppercase tracking-wide mb-1.5">
                  Job
                </label>
                <select
                  value={jobId ?? ''}
                  onChange={e => updateJob(e.target.value || null)}
                  className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary transition-colors"
                >
                  <option value="">— None —</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>
                      {j.label ? `${j.label} · ${j.title}` : j.title}
                    </option>
                  ))}
                </select>
                {jobId && (
                  <Link
                    href={`/dashboard/jobs/${jobId}`}
                    className="inline-block mt-1.5 text-[12px] text-primary hover:underline"
                  >
                    Open job
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Items | Buyout ── */}
        <div className="flex items-center gap-5 border-b border-divider -mb-2" role="tablist" aria-label="Quote sections">
          {([['items', 'Items'], ['buyout', 'Buyout']] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={quoteView === k}
              onClick={() => (k === 'buyout' ? void openBuyout() : setQuoteView('items'))}
              className={cn('pb-2 -mb-px text-[13.5px] font-semibold border-b-2 flex items-center gap-1.5', quoteView === k ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary')}>
              {label}
              {k === 'buyout' && sourcing.waiting > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10.5px]">{sourcing.waiting} waiting</span>}
            </button>
          ))}
        </div>

        {quoteView === 'buyout' && companyId ? (
          <BuyoutPanel companyId={companyId} buyout={buyout} lines={outsourcedLines} currency={quoteCurrency} readOnly={locked}
            ensure={ensureQuoteBuyout} reload={reloadBuyout} onChoose={chooseForLine}
            keep={keepMode} onKeep={rememberKeep} defaultMargin={defaultMargin} onDefaultMargin={rememberMargin} />
        ) : (
        <>
        <LineItemsEditor lines={editorLines} onChange={handleEditorChange} items={pickItems} itemsLoading={pickLoading} startOpen={!initialQuoteId} currency={quoteCurrency} showCost readOnly={locked} lineExtra={lineExtra} />

        {sourcing.count > 0 && (
          <div className="-mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-text-primary">
              <b>Sourcing</b> <span className="text-text-secondary">· {sourcing.count} outsourced {sourcing.count === 1 ? 'item' : 'items'} · {sourcing.chosen} with a cost price{sourcing.waiting ? ` · ${sourcing.waiting} waiting for replies` : ''}</span>
              <span className="block text-[11.5px] text-text-secondary">Buyout is optional: you can always type a cost price yourself. Click a supplier pill to see everyone asked.</span>
            </p>
            <button type="button" onClick={() => void openBuyout()} className="h-9 px-4 rounded-lg bg-primary text-white text-[13px] font-semibold hover:bg-primary/90">Buyout</button>
          </div>
        )}

        {/* ── Notes ── */}
        <div className="rounded-xl border border-divider overflow-hidden">
          <div className="px-4 py-1.5 border-b border-divider bg-surface-elevated">
            <span className="text-[11px] text-text-secondary uppercase tracking-wide">
              Notes
            </span>
          </div>
          <textarea
            rows={2}
            value={notes}
            onChange={e => updateNotes(e.target.value)}
            placeholder="Payment terms, warranty, scope exclusions…"
            className="w-full px-4 py-2 text-[13px] text-text-primary bg-surface resize-y focus:outline-none placeholder-text-secondary/40"
          />
        </div>
        {/* ── Totals: rows in the same columns as the items ── */}
        <QuoteTotalsRows lines={editorLines} currency={quoteCurrency} vatOn={vatOn} readOnly={locked}
          vatLabel={vatOn ? `VAT (${vatPercentLabel(vatRate)}%)` : 'VAT'} vat={vat} total={total} onVat={updateVatOn} />

        <p className="-mt-2 px-1 text-[11.5px] text-text-secondary flex items-start gap-1">
          <span className="material-icons !text-[13px] !leading-[1.4]">lock</span>
          Cost price and margin are only for your team. They never show on the quote PDF or the client&apos;s page. Change the margin to set the selling price from the cost.
        </p>
        </>
        )}
        </fieldset>


      </div>

      {/* ── Send quote ── */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="relative bg-surface rounded-xl shadow-2xl w-full max-w-xl mx-4 p-6 max-h-[92vh] overflow-y-auto">
            <h3 className="text-[15px] font-semibold text-text-primary mb-1">Send quote</h3>
            <p className="text-[13px] text-text-secondary mb-3">
              {clientName || 'The client'} gets the quote PDF and a link to accept it online.
              {dealId ? ' Linked project clients will also see it in the portal.' : ''}
            </p>
            <div className="flex flex-col gap-3 mb-4">
              {companyId && <SenderNote companyId={companyId} mode="personal" />}
              {companyId && (
                <RecipientsInput value={sendRcpt} onChange={setSendRcpt} companyId={companyId} clientId={clientId}
                  clientEmail={(chosenClient?.id === clientId ? chosenClient.email : clients.find(c => c.id === clientId)?.email) ?? null}
                  disabled={sendBusy} />
              )}
              {quoteId && (
                <EmailComposer draft={sendDraft} onDraft={setSendDraft} disabled={sendBusy}
                  load={edits => previewQuoteEmail(supabase, { quoteId, recipientEmail: sendRcpt.to.trim(), cc: sendRcpt.cc, edits })} />
              )}
              {actionError && <p className="text-[12px] text-error">{actionError}</p>}
            </div>
            <div className="flex flex-col gap-2 mb-5">
              <button
                type="button"
                disabled={sendBusy || !isEmail(sendRcpt.to)}
                onClick={() => void handleSendWithMailto()}
                className="h-10 px-4 rounded-lg bg-primary text-white text-left text-[13px] font-medium hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <span className="material-icons text-[18px]">send</span>
                {sendBusy ? 'Sending…' : 'Email quote & mark sent'}
              </button>
              <button
                type="button"
                disabled={sendBusy}
                onClick={handleDownloadPdf}
                className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <span className="material-icons text-[18px]">picture_as_pdf</span>
                Download PDF only
              </button>
              <button
                type="button"
                disabled={sendBusy}
                onClick={() => void handleMarkAsSent()}
                className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-secondary hover:bg-surface-elevated transition-colors disabled:opacity-50"
              >
                Mark as sent only
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={sendBusy}
                onClick={() => setShowSendModal(false)}
                className="h-9 px-4 rounded-lg border border-divider text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mark accepted confirmation ── */}
      {showAcceptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="relative bg-surface rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-[15px] font-semibold text-text-primary mb-2">Mark as accepted?</h3>
            <p className="text-[13px] text-text-secondary mb-6">
              The client has accepted this quote
              {clientName ? ` (${clientName})` : ''}. You can create a project, job, or invoice next.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowAcceptModal(false)}
                className="h-9 px-4 rounded-lg border border-divider text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleMarkAccepted()}
                className="h-9 px-5 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors"
              >
                Mark accepted
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── What's next? ── */}
      {showWhatsNext && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="relative bg-surface rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h3 className="text-[15px] font-semibold text-text-primary mb-1">What&apos;s next?</h3>
            <p className="text-[13px] text-text-secondary mb-5">
              Quote accepted. Create follow-up work now, or skip and do it later.
            </p>
            {automationNote && (
              <p className="text-[12px] text-text-primary mb-3 bg-surface-elevated border border-divider rounded-lg px-3 py-2">
                {automationNote}
                {' '}
                <a href="/dashboard/settings?tab=automations" className="text-primary underline underline-offset-2">
                  Manage automations
                </a>
              </p>
            )}
            {actionError && (
              <p className="text-[12px] text-red-600 mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {actionError}
              </p>
            )}
            <div className="flex flex-col gap-2">
              {automationDealId ? (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => {
                    setShowWhatsNext(false)
                    router.push(`/dashboard/projects/${automationDealId}`)
                  }}
                  className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-50"
                >
                  Open project (from automation)
                </button>
              ) : (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void handleCreateProjectFromQuote()}
                  className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-50"
                >
                  Create Project
                </button>
              )}
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleCreateJobFromQuote()}
                className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-50"
              >
                Create Job
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void handleCreateInvoiceFromQuote()}
                className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-50"
              >
                Create Invoice
              </button>
              {automationRfqId ? (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => {
                    setShowWhatsNext(false)
                    router.push(`/dashboard/supply/rfqs/${automationRfqId}`)
                  }}
                  className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-50"
                >
                  Open RFQ (from automation)
                </button>
              ) : (
                <button
                  type="button"
                  disabled={actionBusy || rfqBusy}
                  onClick={() => void handleCreateRfqFromQuote()}
                  className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-50"
                >
                  Ask suppliers for prices
                </button>
              )}
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => { setShowWhatsNext(false); setActionError(null) }}
                className="h-10 px-4 rounded-lg text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors disabled:opacity-50"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
