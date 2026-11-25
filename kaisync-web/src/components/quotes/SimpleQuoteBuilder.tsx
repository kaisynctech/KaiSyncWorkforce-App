'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { repOptions, commissionError } from '@/lib/commission'
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
import { createInvoiceFromQuote, openInvoiceForQuote } from '@/lib/money/quote-invoice'
import { CurrencyPicker } from '@/components/money/CurrencyPicker'
import { formatCurrency } from '@/lib/currencies'
import { lineTotal, loadPickItems, type EditorLine, type ItemType, type PickItem } from '@/lib/line-items'
import { BuyoutPanel, SupplyPill, type BuyoutChoice, type BuyoutQuoteLine } from '@/components/quotes/BuyoutPanel'
import { ensureBuyout, loadBuyout, type Buyout } from '@/lib/money/buyout'
import { priceAfterChoice, supplyModeOf, type SupplyMode } from '@/lib/money/quote-supply'
import { DocumentChain } from '@/components/money/DocumentChain'
import { QuoteClientActivity } from '@/components/quotes/QuoteClientActivity'
import { whatsAppUrl } from '@/lib/whatsapp'
import { TemplateLines, engineOf } from '@/components/quotes/TemplateLines'
import { QuoteDocumentPreview } from '@/components/quotes/QuoteDocumentPreview'
import { HEADER_LABEL, loadTemplates, type QuoteTemplate } from '@/lib/quote-templates'
import { processOrder } from '@/lib/money/order-supply'
import { PERIOD_LABEL, engineLineTotal, orderedForDisplay, quoteTotals, withContingency, type RecurringPeriod } from '@/lib/quote-engine'

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
  /** Template quotations (piece 7): section / phase, industry fields, option for another line, repeats. */
  section?:           string | null
  extra?:             Record<string, string>
  /** id of the line this one is an option for (shown to the client, not counted). */
  option_of?:         string | null
  recurring?:         RecurringPeriod | null
  /** The contingency line the quotation keeps up to date. */
  is_contingency?:    boolean
}

type ClientRow = {
  id: string
  name: string
  email?: string | null
  legal_name?: string | null
  client_code?: string | null
  contact_person?: string | null
  currency?: string | null
  phone?: string | null
  mobile?: string | null
  address?: string | null
  billing_address?: string | null
  vat_number?: string | null
}

/** "Classic" (no template) shows in the same table as the templates: item, qty, unit, rate, total, and cost/margin for the team. */
const CLASSIC_TEMPLATE: QuoteTemplate = {
  id: '', company_id: '', name: 'Classic', business_type: null, is_default: false, archived_at: null, terms: null,
  features: ['products', 'services', 'cost_margin'], header_fields: [], defaults: { valid_days: 30, payment_terms_days: 30, deposit_pct: null, margin_pct: null },
  columns: [
    { key: 'item', label: 'Item', visible: true, team_only: false }, { key: 'qty', label: 'Qty', visible: true, team_only: false },
    { key: 'unit', label: 'Unit', visible: true, team_only: false }, { key: 'rate', label: 'Rate', visible: true, team_only: false },
    { key: 'total', label: 'Total', visible: true, team_only: false }, { key: 'cost', label: 'Cost', visible: true, team_only: true },
    { key: 'margin', label: 'Margin', visible: true, team_only: true },
  ],
}

const CLIENT_PICK_COLUMNS = 'id, name, email, legal_name, client_code, contact_person, currency, phone, mobile, address, billing_address, vat_number'

/** Per-quote details kept in header_values (no own columns): who it goes to, the client's VAT number, delivery. */
const HV = { contactName: '__contact_name', contactEmail: '__contact_email', contactPhone: '__contact_phone', clientVat: '__client_vat', delivery: '__delivery' } as const
/** Template header fields shown in "Details" under their own names (not with the other template fields). */
const OWN_HEADER = new Set(['site_address', 'client_order_no'])
type Contact = { name: string; email: string | null; phone: string | null; note: string | null }

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
  const [employeeName, setEmployeeName] = useState('')
  const [letterhead, setLetterhead] = useState<Letterhead | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [authReady,  setAuthReady]  = useState(false)

  // ── Quote meta ────────────────────────────────────────────────────────────
  const [quoteId,     setQuoteId]     = useState<string | null>(initialQuoteId)
  const [quoteNumber, setQuoteNumber] = useState<string | null>(null)
  const [status,      setStatus]      = useState('draft')
  /** The client's name and signature when they accepted online (printed on the quote). */
  const [acceptedSig, setAcceptedSig] = useState<{ name: string; at: string | null; signature: string | null } | null>(null)
  const [title,       setTitle]       = useState('')
  const [clientId,    setClientId]    = useState<string | null>(null)
  const [validUntil,  setValidUntil]  = useState(todayPlus(14))
  const [notes,       setNotes]       = useState('')
  const [dealId,      setDealId]      = useState<string | null>(null)
  const [jobId,       setJobId]       = useState<string | null>(null)
  const [vatOn,       setVatOn]       = useState(true)
  const [salesRep,    setSalesRep]    = useState<string | null>(null)
  const [repList,     setRepList]     = useState<{ id: string; name: string | null }[]>([])
  const [repNote,     setRepNote]     = useState<string | null>(null)
  // Rep whose commission on this quote has been (partly) paid out: the rep can't change any more.
  const [paidRepId,   setPaidRepId]   = useState<string | null>(null)
  const paidRepRef = useRef<string | null>(null)
  useEffect(() => { paidRepRef.current = paidRepId }, [paidRepId])
  // Quotation template (piece 7). null: a quotation from before templates, which looks and works as before.
  const [templates,   setTemplates]   = useState<QuoteTemplate[]>([])
  const [templateId,  setTemplateId]  = useState<string | null>(null)
  const [headerValues, setHeaderValues] = useState<Record<string, string>>({})
  const [contingencyPct, setContingencyPct] = useState(0)
  const [depositPct,  setDepositPct]  = useState<number | null>(null)
  const [terms,       setTerms]       = useState('')
  const [paymentDays, setPaymentDays] = useState<number | null>(null)
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
  // "Process order": the purchase orders for the bought-in lines (piece 9).
  const [processBusy, setProcessBusy] = useState(false)
  const [confirmUnlock, setConfirmUnlock] = useState(false)
  // A draft that was never sent can be deleted (after asking).
  /** Mark declined (nothing is ever deleted: the quote and its number stay on record). */
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [declining, setDeclining] = useState(false)
  const lockedRef = useRef(false)
  // The order's open invoice, if it has one ("Open invoice" instead of "Create invoice").
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null)
  // An existing quote shows "Loading…" until it has loaded, so nothing is typed into an empty form first.
  const [dataLoaded, setDataLoaded] = useState(!initialQuoteId)

  // ── The four steps (who · what · extras · check and send) ──
  const [step, setStep] = useState<1 | 2 | 3 | 4>(() => {
    const s = Number(searchParams.get('step'))
    return s >= 1 && s <= 4 ? (s as 1 | 2 | 3 | 4) : initialQuoteId ? 2 : 1
  })
  const stepRef = useRef(step)
  useEffect(() => { stepRef.current = step }, [step])
  const [docKind, setDocKind] = useState<'quote' | 'proforma'>('quote')
  const docKindRef = useRef<'quote' | 'proforma'>('quote')
  /** Email the pro forma invoice in the same PDF, after the quotation. */
  const [attachProforma, setAttachProforma] = useState(false)
  const attachProformaRef = useRef(false)
  const [browseSignal, setBrowseSignal] = useState(0)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactOpen, setContactOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null)
  const [importText, setImportText] = useState('')
  const [importNote, setImportNote] = useState<string | null>(null)
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
  const salesRepRef   = useRef<string | null>(null)
  const linesRef      = useRef<SimpleQuoteLine[]>([])
  const quoteNumberRef = useRef<string | null>(null)
  const clientSearchSeq = useRef(0)
  const vatOnRef      = useRef(true)
  const vatRateRef    = useRef(0.15)
  const companyVatRef = useRef<QuoteVatChoice>({ vatOn: true, vatRate: 0.15 })
  const templateIdRef = useRef<string | null>(null)
  const headerValuesRef = useRef<Record<string, string>>({})
  const contingencyRef = useRef(0)
  const depositPctRef = useRef<number | null>(null)
  const termsRef      = useRef('')
  const paymentDaysRef = useRef<number | null>(null)

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
  // Template refs are set by their updaters (below), like the line refs.
  const template = templates.find(t => t.id === templateId) ?? null

  // ── Resolve auth on mount ──────────────────────────────────────────────────
  useEffect(() => {
    resolveCurrentMember(supabase).then(async m => {
      if (!m) return
      setCompanyId(m.companyId)
      setEmployeeId(m.employeeId)
      companyIdRef.current  = m.companyId
      employeeIdRef.current = m.employeeId
      void supabase.from('employees').select('name, surname').eq('id', m.employeeId).maybeSingle()
        .then(({ data }) => { const e = data as { name?: string; surname?: string } | null; if (e) setEmployeeName([e.name, e.surname].filter(Boolean).join(' ')) })
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

  // Sales reps for the "Sales rep" field (names only).
  useEffect(() => {
    if (!companyId) return
    let live = true
    void repOptions(createClient(), companyId).then(list => { if (live) setRepList(list) })
    return () => { live = false }
  }, [companyId])
  useEffect(() => { lockedRef.current = locked }, [locked])
  // The chosen customer's people: the main contact and any others saved under the customer.
  useEffect(() => {
    let live = true
    void (async () => {
      if (!companyId || !clientId) { if (live) setContacts([]); return }
      const [{ data: c }, { data: more }] = await Promise.all([
        supabase.from('clients').select('contact_person, email, phone, mobile').eq('id', clientId).eq('company_id', companyId).maybeSingle(),
        supabase.from('client_contacts').select('name, email, phone').eq('client_id', clientId).eq('company_id', companyId).order('sort_order').limit(50),
      ])
      if (!live) return
      const list: Contact[] = []
      const main = c as { contact_person?: string | null; email?: string | null; phone?: string | null; mobile?: string | null } | null
      if (main?.contact_person?.trim()) list.push({ name: main.contact_person.trim(), email: main.email ?? null, phone: main.mobile || main.phone || null, note: 'main contact' })
      for (const r of (more ?? []) as { name: string | null; email: string | null; phone: string | null }[]) {
        const nm = (r.name ?? '').trim() || (r.email ?? '').trim()
        if (nm && !list.some(x => x.name === nm && x.email === r.email)) list.push({ name: nm, email: r.email, phone: (r.phone ?? '').trim() || null, note: null })
      }
      setContacts(list)
    })()
    return () => { live = false }
  }, [companyId, clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Has commission been paid out on this quote? (Readable by HR and above; others are stopped by the database.)
  useEffect(() => {
    if (!companyId || !quoteId) return
    let live = true
    void supabase.from('commissions').select('employee_id, paid_amount').eq('quote_id', quoteId).eq('company_id', companyId).maybeSingle()
      .then(({ data }) => {
        if (!live) return
        const r = data as { employee_id: string; paid_amount: number | string } | null
        setPaidRepId(r && Number(r.paid_amount) > 0 ? r.employee_id : null)
      })
    return () => { live = false }
  }, [companyId, quoteId, status]) // eslint-disable-line react-hooks/exhaustive-deps
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

  /** A new quotation takes its template's starting values (valid for, payment days, deposit, terms). */
  function applyTemplateDefaults(t: QuoteTemplate) {
    const d = t.defaults ?? { valid_days: 14, payment_terms_days: 30, deposit_pct: null, margin_pct: null }
    const vu = todayPlus(Number(d.valid_days) || 14)
    setValidUntil(vu); validUntilRef.current = vu
    const dep = t.features.includes('deposit') ? (d.deposit_pct ?? null) : null
    setDepositPct(dep); depositPctRef.current = dep
    const tm = t.terms ?? ''
    setTerms(tm); termsRef.current = tm
    const pd = d.payment_terms_days ?? null
    setPaymentDays(pd); paymentDaysRef.current = pd
  }

  async function loadData(cid: string) {
    const tpl = await loadTemplates(supabase, cid).catch(() => [] as QuoteTemplate[])
    setTemplates(tpl)
    if (!quoteIdRef.current) {
      const def = tpl.find(t => t.is_default) ?? tpl[0] ?? null
      if (def) {
        setTemplateId(def.id); templateIdRef.current = def.id
        applyTemplateDefaults(def)
      }
    }
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
        setAcceptedSig(q.accepted_by_name ? { name: String(q.accepted_by_name), at: (q.accepted_at as string | null) ?? null, signature: (q.accepted_signature as string | null) ?? null } : null)
        setAcceptedSig(q.accepted_by_name ? { name: String(q.accepted_by_name), at: (q.accepted_at as string | null) ?? null, signature: (q.accepted_signature as string | null) ?? null } : null)
        { const tt = (q.title as string) ?? ''; const clean = /^untitled quote$/i.test(tt.trim()) ? '' : tt; setTitle(clean); titleRef.current = clean }
        const cid2 = (q.client_id as string | null) ?? null
        setClientId(cid2);         clientIdRef.current = cid2
        const rep2 = (q.salesperson_id as string | null) ?? null
        setSalesRep(rep2);         salesRepRef.current = rep2
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
        const tid = (q.template_id as string | null) ?? null
        setTemplateId(tid);        templateIdRef.current = tid
        const hv = { ...((q.header_values as Record<string, string> | null) ?? {}) }
        const dp = hv.__deposit_pct != null && hv.__deposit_pct !== '' ? Number(hv.__deposit_pct) : null
        delete hv.__deposit_pct
        setHeaderValues(hv);       headerValuesRef.current = hv
        setDepositPct(dp);         depositPctRef.current = dp
        const cp = Number(q.contingency_percent ?? 0) || 0
        setContingencyPct(cp);     contingencyRef.current = cp
        const tc = (q.terms_and_conditions as string | null) ?? ''
        setTerms(tc);              termsRef.current = tc
        const pdays = q.payment_terms_days == null ? null : Number(q.payment_terms_days)
        setPaymentDays(pdays);     paymentDaysRef.current = pdays
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
          section:           (row.section_heading as string | null) ?? null,
          extra:             Object.fromEntries(Object.entries((row.extra as Record<string, unknown> | null) ?? {}).filter(([k]) => k !== 'kind').map(([k, v]) => [k, String(v ?? '')])),
          option_of:         (row.option_of as string | null) ?? null,
          recurring:         (row.recurring_period as RecurringPeriod | null) ?? null,
          is_contingency:    ((row.extra as Record<string, unknown> | null) ?? {}).kind === 'contingency',
        }))
        // total is after the line's discount.
        for (const m of mapped) {
          m.total = templateIdRef.current
            ? engineLineTotal({ qty: m.qty, unitPrice: m.unit_price, discountPct: m.discount_pct })
            : lineTotal({ type: m.item_type, qty: m.qty, unitPrice: m.unit_price, discountPct: m.discount_pct })
        }
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
      // Options for the client are shown but never counted (piece 7).
      const counted = ls.filter(l => !l.option_of)
      const lineSubtotal = counted.reduce((s, l) => s + l.total, 0)
      // What the work costs the business (office only): kept on the quote so profit can be tracked.
      const costTotal = Math.round(counted.reduce((s, l) => s + l.qty * (Number(l.unit_cost) || 0), 0) * 100) / 100
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
        salesperson_id: salesRepRef.current,
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
      payload.header_values = { ...headerValuesRef.current, ...(depositPctRef.current != null ? { __deposit_pct: String(depositPctRef.current) } : {}) }
      if (templateIdRef.current || quoteIdRef.current) {
        const dp = depositPctRef.current
        payload.template_id = templateIdRef.current
        payload.contingency_percent = contingencyRef.current || 0
        if (templateIdRef.current) {
          payload.terms_and_conditions = termsRef.current.trim() || null
          payload.deposit_required = dp ? Math.round(lineTotal * dp) / 100 : 0
          if (paymentDaysRef.current != null) payload.payment_terms_days = paymentDaysRef.current
        }
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
        router.replace(`/dashboard/money/quotes/${savedId}?step=${stepRef.current}`)
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
            is_optional:       !!l.option_of,
            is_excluded:       !!l.option_of,
            section_heading:   l.section?.trim() || null,
            extra:             { ...(l.extra ?? {}), ...(l.is_contingency ? { kind: 'contingency' } : {}) },
            option_of:         l.option_of ?? null,
            recurring_period:  l.recurring ?? null,
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
      // The rep was changed after commission was paid out: put the paid rep back and say why.
      const msg = String((err as { message?: string } | null)?.message ?? '')
      if (msg.includes('COMMISSION_REP_LOCKED')) {
        setSalesRep(paidRepRef.current); salesRepRef.current = paidRepRef.current
        setRepNote(commissionError(msg))
      }
      setSaveState('error')
      return null
    }
  }

  /** The client said no: the quote stays on record, marked declined, with the reason if one was given. */
  async function handleMarkDeclined() {
    const cid = companyIdRef.current
    setDeclining(true)
    setActionError(null)
    const id = await doSave('declined')
    if (!id || !cid) { setDeclining(false); setActionError('Could not mark the quote as declined. Try again.'); return }
    const reason = declineReason.trim().slice(0, 500) || null
    if (reason) await supabase.from('commercial_quotes').update({ declined_reason: reason }).eq('id', id).eq('company_id', cid)
    setStatus('declined'); statusRef.current = 'declined'
    setDeclining(false)
    setConfirmDecline(false)
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
    const changed = id !== clientIdRef.current
    setClientId(id); clientIdRef.current = id
    setChosenClient(row ?? null)
    setClientSearch(name)
    // A newly picked customer fills in who it goes to, the address and VAT number (only empty ones; typed ones stay).
    if (row && changed) {
      const hv = { ...headerValuesRef.current }
      const fill = (k: string, v: string | null | undefined) => { if (v?.trim()) hv[k] = v.trim(); else delete hv[k] }
      fill(HV.contactName, row.contact_person)
      fill(HV.contactEmail, row.email)
      fill(HV.contactPhone, row.mobile || row.phone)
      fill('site_address', row.address || row.billing_address)
      fill(HV.clientVat, row.vat_number)
      setHeaderValues(hv); headerValuesRef.current = hv
    }
    scheduleAutoSave()
  }
  function pickContact(c: Contact) {
    const hv: Record<string, string> = { ...headerValuesRef.current, [HV.contactName]: c.name }
    if (c.email) hv[HV.contactEmail] = c.email; else delete hv[HV.contactEmail]
    if (c.phone) hv[HV.contactPhone] = c.phone; else delete hv[HV.contactPhone]
    setHeaderValues(hv); headerValuesRef.current = hv; setContactOpen(false); scheduleAutoSave()
  }
  async function updateSalesRep(v: string | null) {
    const prevRep = salesRepRef.current
    setSalesRep(v); salesRepRef.current = v; setRepNote(null)
    // An accepted quote is locked, so the rep is saved on its own (that's when commission is worked out).
    if (locked && quoteIdRef.current && companyIdRef.current) {
      const { error } = await createClient().from('commercial_quotes').update({ salesperson_id: v, updated_at: new Date().toISOString() })
        .eq('id', quoteIdRef.current).eq('company_id', companyIdRef.current)
      if (error && error.message.includes('COMMISSION_REP_LOCKED')) {
        setSalesRep(prevRep); salesRepRef.current = prevRep
        setRepNote(commissionError(error.message))
        return
      }
      setRepNote(error ? 'The sales rep could not be saved. Try again.' : 'Sales rep saved. Their commission is worked out now.')
      return
    }
    scheduleAutoSave()
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

  // ── Template quotations (piece 7) ─────────────────────────────────────────
  function updateHeader(key: string, v: string) {
    const next = { ...headerValuesRef.current, [key]: v }
    setHeaderValues(next); headerValuesRef.current = next; scheduleAutoSave()
  }
  function updateDepositPct(v: number | null) {
    setDepositPct(v); depositPctRef.current = v; scheduleAutoSave()
  }
  function updateTerms(v: string) {
    setTerms(v); termsRef.current = v; scheduleAutoSave()
  }
  /** Contingency is a normal line, kept in step with the counted lines. */
  function withContingencyLine(ls: SimpleQuoteLine[], pct: number): SimpleQuoteLine[] {
    const byKey = new Map(ls.map(l => [l.id ?? l.tempId, l]))
    const eng = withContingency(ls.map(l => ({ ...engineOf(l), line: l })), pct, (amount, label) => {
      const id = crypto.randomUUID()
      const line: SimpleQuoteLine = { ...blankLine(), id, tempId: id, description: label, unit: 'sum', unit_price: amount, total: amount, is_contingency: true }
      return { ...engineOf(line), line }
    })
    return eng.map(e => {
      const base = byKey.get(e.key) ?? e.line
      if (!e.isContingency) return base
      return { ...base, description: e.description, qty: 1, unit_price: e.unitPrice, total: e.unitPrice, discount_pct: null, is_contingency: true }
    })
  }
  function setTemplateLines(next: SimpleQuoteLine[]) {
    const withC = withContingencyLine(next, contingencyRef.current)
    setLines(withC); linesRef.current = withC; scheduleAutoSave()
  }
  function updateContingency(pct: number) {
    setContingencyPct(pct); contingencyRef.current = pct
    const withC = withContingencyLine(linesRef.current, pct)
    setLines(withC); linesRef.current = withC; scheduleAutoSave()
  }
  function chooseTemplate(id: string | null) {
    setTemplateId(id); templateIdRef.current = id
    const t = templates.find(x => x.id === id)
    // Starting values only fill a quotation that hasn't been sent; nothing already typed is lost.
    if (t && statusRef.current === 'draft') {
      if (depositPctRef.current == null && t.features.includes('deposit')) { setDepositPct(t.defaults?.deposit_pct ?? null); depositPctRef.current = t.defaults?.deposit_pct ?? null }
      if (!termsRef.current.trim() && t.terms) { setTerms(t.terms); termsRef.current = t.terms }
    }
    if (t && !t.features.includes('contingency') && contingencyRef.current) updateContingency(0)
    scheduleAutoSave()
  }

  function makeTemplateLine(pick: PickItem | null, qty: number): SimpleQuoteLine {
    const id = crypto.randomUUID()
    if (!pick) return { ...blankLine(), id, tempId: id, qty, total: 0 }
    const extra: Record<string, string> = {}
    if (pick.sku) extra.part_no = pick.sku
    if (pick.brand) extra.brand = pick.brand
    const q = pick.type === 'service' ? 1 : qty
    return {
      ...blankLine(), id, tempId: id, description: pick.name, qty: q, unit: pick.unit || 'each', unit_price: pick.price,
      total: Math.round(q * pick.price * 100) / 100, catalogue_item_id: pick.type === 'catalogue' ? pick.sourceId : null,
      item_type: pick.type, source_id: pick.sourceId, hint: pick.hint, unit_cost: pick.cost ?? null, extra,
    }
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
  /** Your products & stock are priced in your own currency: a quote in another currency gets them at its rate. */
  const quoteItems: PickItem[] = foreign && bookRate && bookRate > 0
    ? pickItems.map(i => ({ ...i, price: Math.round((i.price / bookRate) * 100) / 100, cost: i.cost ? Math.round((i.cost / bookRate) * 100) / 100 : i.cost }))
    : pickItems

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

  async function openSend() {
    const email = headerValuesRef.current[HV.contactEmail]?.trim() || ((chosenClient?.id === clientId ? chosenClient.email : clients.find(c => c.id === clientId)?.email) ?? '')
    setSendRcpt(emptyRecipients(email))
    setSendDraft(null)
    setActionError(null)
    // The preview reads the saved quote, so save the latest changes first (an accepted, locked quote has none).
    if (!(locked ? quoteIdRef.current : await doSave())) return
    setShowSendModal(true)
  }

  /** Send on WhatsApp (piece 8): the quotation is marked sent and WhatsApp opens with the private link ready. */
  async function handleSendWhatsApp() {
    // Opened straight away so the phone doesn't block it as a pop-up; filled in once the link is ready.
    const w = window.open('', '_blank')
    setSendBusy(true)
    setActionError(null)
    const id = await doSave(statusRef.current === 'draft' ? 'sent' : undefined)
    if (!id) { w?.close(); setSendBusy(false); setActionError('Save the quote first, then try again.'); return }
    const { data: token, error } = await supabase.rpc('document_link_for', { p_kind: 'quote', p_doc_id: id })
    setSendBusy(false)
    if (error || !token) {
      w?.close()
      setActionError(/NOT_ALLOWED/.test(error?.message ?? '') ? 'You don’t have permission to send quotations.' : error?.message ?? 'The link could not be made.')
      return
    }
    const client = chosenClient?.id === clientIdRef.current ? chosenClient : clients.find(c => c.id === clientIdRef.current)
    const first = (headerValuesRef.current[HV.contactName] || client?.contact_person || '').trim().split(/\s+/)[0]
    const t = template ? quoteTotals(linesRef.current.map(engineOf), { vatOn: vatOnRef.current, vatRate: vatRateRef.current, depositPct: template.features.includes('deposit') ? depositPctRef.current : null }) : null
    const text = [
      `Hi${first ? ` ${first}` : ''}, here is quotation ${quoteNumberRef.current ?? ''} from ${companyName}${t ? ` (${formatCurrency(t.total, quoteCurrency)})` : ''}.`,
      `You can see it, ${template?.features.includes('options') ? 'choose your options, ' : ''}accept it${t && t.deposit > 0 ? ' and pay the deposit' : ''} here:`,
      `${window.location.origin}/d/${token}`,
    ].join('\n')
    const url = whatsAppUrl(headerValuesRef.current[HV.contactPhone] || client?.mobile || client?.phone, text)
    if (w) w.location.href = url; else window.location.assign(url)
    setShowSendModal(false)
    setSentNote(`WhatsApp opened with the quotation link${client?.mobile || client?.phone ? ` for ${client?.name}` : ''}. Tap Send in WhatsApp.`)
  }

  // ── Mark as sent ───────────────────────────────────────────────────────────
  async function handleMarkAsSent() {
    await doSave('sent')
    setShowSendModal(false)
  }

  function buildPdfInput() {
    const tpl = templates.find(t => t.id === templateIdRef.current) ?? null
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
      kind: docKindRef.current,
      reference: headerValuesRef.current.client_order_no?.trim() || null,
      sales_rep: repList.find(r => r.id === salesRepRef.current)?.name ?? null,
      contact: { name: headerValuesRef.current[HV.contactName] ?? null, email: headerValuesRef.current[HV.contactEmail] ?? null, phone: headerValuesRef.current[HV.contactPhone] ?? null },
      client_address: headerValuesRef.current.site_address?.trim() || null,
      client_vat: headerValuesRef.current[HV.clientVat]?.trim() || null,
      delivery: headerValuesRef.current[HV.delivery]?.trim() || null,
      accepted: statusRef.current === 'accepted' ? acceptedSig : null,
      rate_note: (() => {
        const c = quoteCurrencyRef.current
        const r = Number(fxRate.replace(',', '.')) > 0 ? Number(fxRate.replace(',', '.')) : dailyRate
        return c && c !== homeCurrency && r && r > 0 ? `Amounts in ${c}; ${formatCurrency(r, homeCurrency)} per ${c} used.` : null
      })(),
      lines: (tpl ? orderedForDisplay(linesRef.current.map(l => ({ ...engineOf(l), section: tpl.features.includes('sections') ? l.section ?? null : null, line: l }))).flatMap(g => g.lines.map(e => e.line)) : linesRef.current).map(l => ({
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        unit_price: l.unit_price,
        total: l.total,
        discount_pct: Number(l.discount_pct) || 0,
        section: tpl?.features.includes('sections') ? l.section ?? null : null,
        extra: l.extra,
        is_option: !!l.option_of,
        recurring: l.recurring ?? null,
      })),
      ...(() => {
        const money = quoteMoney(
          linesRef.current.filter(l => !l.option_of).reduce((s, l) => s + l.total, 0),
          vatOnRef.current,
          vatRateRef.current,
        )
        const t = tpl ? quoteTotals(linesRef.current.map(engineOf), { vatOn: vatOnRef.current, vatRate: vatRateRef.current, depositPct: tpl.features.includes('deposit') ? depositPctRef.current : null }) : null
        return {
          subtotal: money.subtotal, vat: money.vat, total: money.total, vatRate: money.vatRate,
          ...(tpl && t ? {
            // The client never sees team-only columns (cost, margin).
            columns: tpl.columns.filter(c => c.visible && !c.team_only).map(c => ({ key: c.key, label: c.label })),
            header_fields: tpl.header_fields.filter(h => !OWN_HEADER.has(h)).map(h => ({ label: HEADER_LABEL[h] ?? h, value: headerValuesRef.current[h] ?? '' })),
            deposit: depositPctRef.current ? { pct: depositPctRef.current, amount: t.deposit } : null,
            recurring: (Object.entries(t.recurring) as [RecurringPeriod, number][]).map(([period, amount]) => ({ period, amount })),
            terms: termsRef.current.trim() || null,
          } : {}),
        }
      })(),
    }
  }

  function handleDownloadPdf() {
    const input = buildPdfInput()
    if (input.kind === 'proforma') {
      void import('@/lib/quote-pdf').then(({ buildQuotePdf, proformaNumber }) =>
        buildQuotePdf(input).save(`ProForma_${proformaNumber(input.quote_number).replace(/[^\w.-]+/g, '_')}.pdf`))
      return
    }
    downloadQuotePdf(input)
  }

  /** Prefer Resend Edge send when configured; otherwise mailto + PDF download. */
  async function handleSendWithMailto() {
    setSendBusy(true)
    setActionError(null)
    // An accepted quote (sending its pro forma) stays accepted and is not re-saved.
    const wasAccepted = statusRef.current === 'accepted'
    const qid = locked ? quoteIdRef.current : await doSave()
    if (!qid) {
      setSendBusy(false)
      return
    }
    const pdf = buildPdfInput()
    const to = sendRcpt.to.trim() || pdf.client_email || ''
    const resend = await sendQuoteEmailViaResend(supabase, {
      quoteId: qid,
      pdfBase64: quotePdfBase64(pdf, { withProforma: pdf.kind !== 'proforma' && attachProformaRef.current }),
      recipientEmail: to,
      cc: sendRcpt.cc,
      bodyText: draftEdits(sendDraft).body_text,
      filename: pdf.kind !== 'proforma' && attachProformaRef.current ? `Quote_and_ProForma_${(pdf.quote_number || 'draft').replace(/[^\w.-]+/g, '_')}.pdf` : pdf.kind === 'proforma' ? `ProForma_${(pdf.quote_number || 'draft').replace(/^QU/i, 'PF').replace(/[^\w.-]+/g, '_')}.pdf` : `Quote_${(pdf.quote_number || 'draft').replace(/[^\w.-]+/g, '_')}.pdf`,
      subject: draftEdits(sendDraft).subject ?? `Quote ${pdf.quote_number ?? ''} – ${pdf.title || 'Quotation'}`.trim(),
    })

    if (resend.ok) {
      if (!wasAccepted) {
        setStatus('sent')
        statusRef.current = 'sent'
      }
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
  const subtotal = lines.filter(l => !l.option_of).reduce((s, l) => s + l.total, 0)
  const tTotals = template ? quoteTotals(lines.map(engineOf), { vatOn, vatRate, depositPct: template.features.includes('deposit') ? depositPct : null }) : null
  const askSuppliers = !template || template.features.includes('ask_suppliers')
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

  // ── Import a list ──
  async function importFile(file: File) {
    setImportNote(null)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const table = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: true }) as unknown[][]
      const rows = rowsFromSheet(table, quoteItems)
      if (!rows.length) { setImportNote('No lines found in that file. The first row should name the columns, e.g. Item, Qty, Price.'); return }
      setImportRows(rows)
    } catch {
      setImportNote(/\.pdf$/i.test(file.name) ? 'Reading PDFs is coming soon. For now, use Excel or CSV, or paste the list.' : 'That file could not be read. Use an Excel (.xlsx) or CSV file.')
    }
  }
  function importPasted() {
    const rows = rowsFromText(importText, quoteItems)
    if (!rows.length) { setImportNote('Nothing to add. Put each item on its own line, e.g. “20 bags cement”.'); return }
    setImportNote(null); setImportRows(rows)
  }
  function addImported() {
    const rows = (importRows ?? []).filter(r => r.keep)
    const made = rows.map(r => {
      const l = makeTemplateLine(r.pick, r.qty)
      const price = r.price ?? r.pick?.price ?? 0
      const qty = r.pick?.type === 'service' ? 1 : r.qty
      return { ...l, description: r.description, qty, unit: r.unit || l.unit, unit_price: price, unit_cost: r.cost ?? l.unit_cost ?? null, total: Math.round(qty * price * 100) / 100 }
    })
    const at = linesRef.current.findIndex(x => x.is_contingency)
    const next = at < 0 ? [...linesRef.current, ...made] : [...linesRef.current.slice(0, at), ...made, ...linesRef.current.slice(at)]
    setTemplateLines(next)
    setImportRows(null); setImportText(''); setImportOpen(false)
    setImportNote(`${made.length} line${made.length === 1 ? '' : 's'} added. Check the prices.`)
  }

  const goStep = (n: 1 | 2 | 3 | 4) => { setStep(n); if (typeof window !== 'undefined') document.getElementById('quote-top')?.scrollIntoView({ block: 'start' }) }
  const contactName = headerValues[HV.contactName] ?? ''
  const shownTotal = template && tTotals ? tTotals.total : total
  const shownSubtotal = template && tTotals ? tTotals.subtotal : Math.round(subtotal * 100) / 100
  const shownVat = template && tTotals ? tTotals.vat : vat
  const STEPS: [1 | 2 | 3 | 4, string][] = [[1, 'Who it’s for'], [2, 'What you’re quoting'], [3, 'Extras'], [4, 'Check and send']]
  const label = 'flex flex-col gap-1.5'
  const labText = 'text-[12.5px] font-semibold text-text-primary h-[18px] whitespace-nowrap flex items-center justify-between gap-2'
  const field = 'h-11 w-full box-border rounded-[10px] border border-divider bg-surface-elevated px-3 text-[14px] font-medium text-text-primary focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15 disabled:opacity-60'
  const optionalTag = <span className="text-[11px] font-medium text-text-secondary bg-[#EEF1F6] px-[7px] rounded-full leading-[18px]">Optional</span>
  const groupHead = (title: string) => (
    <span className="text-[11.5px] font-bold tracking-[0.08em] uppercase text-[#2563EB] dark:text-[#7AA7FF]">{title}</span>
  )
  const otherHeaders = (template?.header_fields ?? []).filter(h => !OWN_HEADER.has(h))
  const showDeposit = !!template?.features.includes('deposit')
  const showContingency = !!template?.features.includes('contingency')
  const showProfit = !template || template.features.includes('cost_margin')
  // Profit only over lines that have a cost (a line without one would look like 100% profit).
  const counted = lines.filter(l => !l.option_of && !l.is_contingency)
  const costed = counted.filter(l => Number(l.unit_cost) > 0)
  const costedSell = costed.reduce((s, l) => s + l.total, 0)
  const costedCost = costed.reduce((s, l) => s + (Number(l.unit_cost) || 0) * l.qty, 0)
  const profitPct = costedSell > 0 ? ((costedSell - costedCost) / costedSell) * 100 : null
  const noCost = counted.length - costed.length

  const totalsPanel = (next: string | null, onNext: () => void) => (
    <aside className="flex-[1_1_240px] lg:max-w-[260px] w-full lg:w-auto bg-surface border border-divider rounded-[14px] p-3.5 flex flex-col gap-[9px] text-[13px] lg:sticky lg:top-4">
      <div className="flex justify-between"><span className="text-text-secondary">{vatOn ? 'Subtotal' : 'Subtotal'}</span><span>{formatCurrency(shownSubtotal, quoteCurrency)}</span></div>
      <div className="flex justify-between items-center">
        <label className="flex items-center gap-1.5 text-text-secondary"><input type="checkbox" checked={vatOn} disabled={locked} onChange={e => updateVatOn(e.target.checked)} className="w-4 h-4 accent-[#2563EB]" />VAT {vatPercentLabel(vatRate)}%</label>
        <span>{vatOn ? formatCurrency(shownVat, quoteCurrency) : 'No VAT'}</span>
      </div>
      <div className="h-px bg-divider" />
      <div className="flex justify-between items-baseline"><span className="font-semibold">Total</span><span className="text-[20px] font-bold">{formatCurrency(shownTotal, quoteCurrency)}</span></div>
      {foreign && bookRate && bookRate > 0 && <span className="text-[11.5px] text-text-secondary text-right -mt-1.5">= {formatCurrency(Math.round(shownTotal * bookRate * 100) / 100, homeCurrency)} in your books</span>}
      {showDeposit && tTotals && tTotals.deposit > 0 && (
        <div className="flex justify-between text-text-secondary"><span>Deposit {depositPct}%</span><span className="text-text-primary">{formatCurrency(tTotals.deposit, quoteCurrency)}</span></div>
      )}
      {template && tTotals && Object.entries(tTotals.recurring).map(([pr, amt]) => (
        <div key={pr} className="flex justify-between text-text-secondary"><span>Every {PERIOD_LABEL[pr as RecurringPeriod]}</span><span>{formatCurrency(amt as number, quoteCurrency)}</span></div>
      ))}
      {showProfit && profitPct != null && (
        <div className="rounded-lg px-[9px] py-[7px] text-[12px] bg-[#FFF6E0] text-[#7A4F00]">
          <div className="flex justify-between"><span>Profit (team only)</span><span className="font-semibold">{profitPct.toFixed(1)}%</span></div>
          {noCost > 0 && <div className="text-[11px] opacity-80">{noCost} line{noCost === 1 ? '' : 's'} without a cost not counted</div>}
        </div>
      )}
      {next && <button type="button" onClick={onNext} className="h-11 mt-1 rounded-[10px] bg-[#2563EB] text-white text-[13.5px] font-semibold hover:bg-[#1D4ED8]">{next}</button>}
      <button type="button" onClick={() => goStep((step - 1) as 1 | 2 | 3)} className="h-9 rounded-[10px] text-[#2563EB] text-[13px] font-medium">Back</button>
    </aside>
  )

  return (
    <div className="h-full overflow-y-auto bg-[#F5F7FB]">
      {/* ── Top bar: quote, status, template, saved ── */}
      <div id="quote-top" className="bg-surface border-b border-divider px-4 sm:px-7 py-3.5 flex items-center gap-3 sm:gap-4">
        <button type="button" aria-label="Back to quotes" onClick={() => router.push('/dashboard/money/quotes')}
          className="w-10 h-10 rounded-[10px] border border-divider text-text-primary flex items-center justify-center shrink-0 hover:bg-surface-elevated">
          <span className="material-icons !text-[20px]">chevron_left</span>
        </button>
        <div className="flex flex-col gap-0.5 flex-[1_1_0%] min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[20px] font-semibold text-text-primary">{quoteNumber ? `Quote ${quoteNumber}` : 'New quote'}</span>
            <span className={cn('text-[12px] font-semibold px-2.5 py-[3px] rounded-full capitalize',
              status === 'sent' ? 'bg-amber-50 text-amber-700' : status === 'accepted' ? 'bg-emerald-50 text-emerald-700' : status === 'declined' ? 'bg-red-50 text-red-600' : 'bg-[#EEF1F6] text-text-secondary')}>
              {status === 'draft' ? 'Draft' : status.replace('_', ' ')}
            </span>
            {templates.length > 0 && (
              <label className="flex items-center gap-2 text-[13px] text-text-secondary">Template
                <select value={templateId ?? ''} disabled={locked} onChange={e => chooseTemplate(e.target.value || null)} aria-label="Template"
                  className="h-8 rounded-lg border border-divider bg-surface px-2 text-[13px] font-medium text-text-primary max-w-[220px]">
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  <option value="">Classic (no template)</option>
                </select>
              </label>
            )}
          </div>
          <span className="text-[13px] text-text-secondary flex items-center gap-1.5">
            {saveState === 'saving' ? 'Saving…'
              : saveState === 'error' ? <button type="button" onClick={() => void doSave()} className="text-red-600 font-medium">Save failed. Tap to try again</button>
              : quoteId ? <>Saved{saveState === 'saved' ? ' just now' : ''} · saves by itself</> : 'Saves by itself once there’s a customer or a line'}
          </span>
        </div>
        {status === 'accepted' && (
          <button type="button" onClick={() => { setActionError(null); setShowWhatsNext(true) }}
            className="h-11 px-5 rounded-xl bg-[#2563EB] text-white text-[14px] font-semibold hover:bg-[#1D4ED8]">What&apos;s next?</button>
        )}
        {/* Once it has gone to the client: say what they decided, in plain sight (no hidden menu). */}
        {status === 'sent' && quoteId && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowAcceptModal(true)}
              className="h-10 px-3.5 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 text-[13.5px] font-semibold flex items-center gap-1.5 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300">
              <span className="material-icons !text-[18px]">task_alt</span>Accepted
            </button>
            <button type="button" onClick={() => { setDeclineReason(''); setConfirmDecline(true) }}
              className="h-10 px-3.5 rounded-xl border border-divider bg-surface text-text-primary text-[13.5px] font-semibold flex items-center gap-1.5 hover:bg-surface-elevated">
              <span className="material-icons !text-[18px] text-text-secondary">do_not_disturb_on</span>Declined
            </button>
          </div>
        )}
      </div>

      <div className={cn('max-w-[1320px] mx-auto px-4 sm:px-7 pt-5 pb-28 md:pb-12 flex flex-col gap-[18px]')}>

        {status === 'accepted' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0"><span className="material-icons text-[20px]">check</span></span>
              <div>
                <p className="text-[14.5px] font-semibold text-emerald-900">Quote accepted{clientName ? ` by ${clientName}` : ''}</p>
                <p className="text-[12.5px] text-emerald-800">It&apos;s now an order. See everything for it in one place: invoices, payments, purchasing and credit notes.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {outsourcedLines.some(l => l.supplierId) && quoteId && (
                <button type="button" disabled={actionBusy || processBusy}
                  onClick={async () => { setProcessBusy(true); setActionError(null); const r = await processOrder(createClient(), quoteId); setProcessBusy(false); if (!r.ok) { setActionError(r.message); return }; router.push(`/dashboard/money/orders/${quoteId}?tab=pos`) }}
                  className="h-11 px-5 rounded-xl bg-[#2563EB] text-white text-[14px] font-semibold flex items-center gap-2 hover:bg-[#1D4ED8] disabled:opacity-60">
                  <span className="material-icons text-[18px]">local_shipping</span>{processBusy ? 'Creating POs…' : 'Process order'}
                </button>
              )}
              <Link href={`/dashboard/money/orders/${quoteId}`} className="h-11 px-5 rounded-xl border border-emerald-300 bg-white text-emerald-800 text-[14px] font-semibold flex items-center gap-2 hover:bg-emerald-100">
                <span className="material-icons text-[18px]">assignment_turned_in</span>Open order
              </Link>
              <button type="button" disabled={actionBusy} onClick={() => void handleCreateInvoiceFromQuote()}
                className="h-11 px-5 rounded-xl bg-emerald-600 text-white text-[14px] font-semibold flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-60">
                <span className="material-icons text-[18px]">receipt_long</span>{actionBusy ? 'Opening…' : openInvoiceId ? 'Open invoice' : 'Create invoice'}
              </button>
            </div>
          </div>
        )}

        {status === 'accepted' && (locked ? (
          confirmUnlock ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
              <p className="text-[13px] font-semibold text-amber-900">Change an accepted quote?</p>
              <p className="text-[12.5px] text-amber-900">The client accepted this quote as it is. Changes are saved on the quote only: {openInvoiceId ? 'its invoice is not changed, so check the invoice too' : 'the invoice made from it later will use the changes'}, and the client isn&apos;t told.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmUnlock(false)} className="h-8 px-3 rounded-lg border border-amber-300 bg-white text-[12.5px] text-amber-900 font-medium">Keep it locked</button>
                <button type="button" onClick={() => { setUnlocked(true); setConfirmUnlock(false) }} className="h-8 px-3 rounded-lg bg-amber-600 text-white text-[12.5px] font-semibold">Make changes</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-divider bg-surface px-4 py-2">
              <p className="text-[12.5px] text-text-secondary flex items-center gap-1.5"><span className="material-icons !text-[15px] !leading-none">lock</span>Locked: this quote is an order now, so its lines, prices and client can&apos;t be changed by accident.</p>
              <button type="button" onClick={() => setConfirmUnlock(true)} className="h-7 px-3 rounded-lg border border-divider bg-surface text-[12px] font-medium text-text-primary hover:bg-surface-elevated">Make changes</button>
            </div>
          )
        ) : (
          <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-[12.5px] text-amber-900 flex items-center gap-1.5">
            <span className="material-icons !text-[15px] !leading-none">edit</span>You&apos;re changing an accepted quote. {openInvoiceId ? 'Its invoice is not changed: check it too.' : ''}
            <button type="button" onClick={() => setUnlocked(false)} className="ml-auto h-7 px-3 rounded-lg border border-amber-300 bg-white text-[12px] font-medium">Lock again</button>
          </p>
        ))}

        {sentNote && !actionError && (
          <p className="text-[12.5px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <span className="material-icons text-[15px]">mark_email_read</span><span className="flex-1">{sentNote}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setSentNote(null)} className="text-emerald-700 hover:text-emerald-900"><span className="material-icons text-[15px]">close</span></button>
          </p>
        )}
        {confirmDecline && (
          <div className="rounded-xl border border-divider bg-surface px-4 py-3 flex flex-col gap-2.5">
            <p className="text-[14px] font-semibold text-text-primary">Mark {quoteNumber ?? 'this quote'} as declined?</p>
            <p className="text-[12.5px] text-text-secondary">It stays in your quotes, with its number, marked Declined.</p>
            <input type="text" value={declineReason} maxLength={500} onChange={e => setDeclineReason(e.target.value)} placeholder="Why? (optional) e.g. went with another supplier"
              className="h-10 rounded-[10px] border border-divider bg-surface-elevated px-3 text-[13.5px] text-text-primary focus:outline-none focus:border-[#2563EB]" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDecline(false)} className="h-9 px-3.5 rounded-lg border border-divider bg-surface text-[13px] font-medium text-text-primary">Keep it open</button>
              <button type="button" disabled={declining} onClick={() => void handleMarkDeclined()} className="h-9 px-3.5 rounded-lg bg-slate-800 text-white text-[13px] font-semibold disabled:opacity-60 dark:bg-slate-200 dark:text-slate-900">{declining ? 'Saving…' : 'Mark declined'}</button>
            </div>
          </div>
        )}
        {actionError && !showWhatsNext && !showAcceptModal && (
          <p className="text-[12.5px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{actionError}</p>
        )}
        {quoteId && companyId && status !== 'draft' && (
          <QuoteClientActivity companyId={companyId} quoteId={quoteId} employeeId={employeeId} employeeName={employeeName}
            quoteNumber={quoteNumber} readOnly={false}
            clientPhone={headerValues[HV.contactPhone] || ((chosenClient?.id === clientId ? chosenClient : clients.find(c => c.id === clientId)) ?? null)?.mobile
              || ((chosenClient?.id === clientId ? chosenClient : clients.find(c => c.id === clientId)) ?? null)?.phone || null} />
        )}
        {quoteId && <DocumentChain current={{ kind: 'quote', id: quoteId }} companyId={companyId} />}

        {/* ── Steps: tap any to jump ── */}
        <nav aria-label="Quote steps" className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {STEPS.map(([n, lab]) => {
            const now = step === n, done = n < step
            return (
              <button key={n} type="button" aria-current={now ? 'step' : undefined} onClick={() => goStep(n)}
                className={cn('text-left rounded-xl px-3.5 py-2.5 min-h-[48px] flex items-center gap-2.5 border text-[14px] text-text-primary',
                  now ? 'border-[#2563EB] bg-[#EEF4FF] font-semibold' : 'border-divider bg-surface font-medium hover:bg-surface-elevated')}>
                <span className={cn('w-[26px] h-[26px] rounded-full text-[12px] font-bold flex items-center justify-center shrink-0',
                  now ? 'bg-[#2563EB] text-white' : done ? 'bg-[#15803D] text-white' : 'bg-[#EEF1F6] text-text-secondary')}>{done ? '✓' : n}</span>
                <span className="leading-tight">{lab}</span>
              </button>
            )
          })}
        </nav>

        <fieldset disabled={locked} className="min-w-0 m-0 p-0 border-0">

        {/* ── STEP 1 · Who it's for ── */}
        {step === 1 && (
          <section className="bg-surface border border-divider rounded-2xl p-5 sm:p-6 flex flex-col gap-[22px]">
            <h2 className="text-[20px] font-semibold text-text-primary">Who is this quote for?</h2>

            <div className="flex flex-col gap-3">
              {groupHead('Customer')}
              <div className="grid sm:grid-cols-3 gap-4 items-end">
                <div className="sm:col-span-2 relative">
                  <label className={label}>
                    <span className={labText}>Customer name</span>
                    <span className={cn('h-11 rounded-[10px] border bg-surface flex items-center gap-2.5 px-3', clientDropOpen ? 'border-[#2563EB] ring-2 ring-[#2563EB]/15' : 'border-divider')}>
                      <span className="material-icons !text-[18px] text-text-secondary">search</span>
                      <input type="text" placeholder="Search or type a customer name" value={clientSearch}
                        onChange={e => { setClientSearch(e.target.value); setClientDropOpen(true) }}
                        onFocus={() => setClientDropOpen(true)} onBlur={() => setTimeout(() => setClientDropOpen(false), 160)}
                        className="flex-1 min-w-0 bg-transparent outline-none text-[14px] font-medium text-text-primary" />
                      <span className="material-icons !text-[18px] text-text-secondary">expand_more</span>
                    </span>
                  </label>
                  {clientDropOpen && !addingClient && (
                    <div className="absolute left-0 top-full mt-1 z-40 w-full bg-surface border border-divider rounded-xl shadow-[0_14px_30px_rgba(15,23,42,0.16)] py-1 max-h-64 overflow-y-auto">
                      {clients.map(c => {
                        const detail = clientPickDetail(c)
                        return (
                          <button key={c.id} type="button" onMouseDown={() => { selectClient(c.id, c.name, c); setClientDropOpen(false) }}
                            className={cn('w-full text-left px-3 py-2 text-[13.5px] hover:bg-surface-elevated', c.id === clientId ? 'text-[#2563EB] font-medium' : 'text-text-primary')}>
                            <span className="block">{c.name}</span>{detail && <span className="block text-[12px] text-text-secondary">{detail}</span>}
                          </button>
                        )
                      })}
                      {clients.length === 0 && <p className="px-3 py-2 text-[12.5px] text-text-secondary">{clientListError ?? (clientSearch.trim() ? 'No customers found' : 'No customers yet')}</p>}
                      <div className="border-t border-divider mt-1 pt-1">
                        <button type="button" onMouseDown={() => { setNewClientName(clientSearch.trim()); setAddingClient(true); setClientDropOpen(false) }}
                          className="w-full text-left px-3 py-2 text-[13px] text-[#2563EB] font-medium hover:bg-surface-elevated">+ Add {clientSearch.trim() ? `“${clientSearch.trim()}”` : 'a new customer'}</button>
                      </div>
                    </div>
                  )}
                  {addingClient && (
                    <div className="mt-2 p-3 rounded-xl border border-divider bg-surface-elevated grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                      <input autoFocus type="text" placeholder="Customer name *" value={newClientName} onChange={e => setNewClientName(e.target.value)} onKeyDown={e => e.key === 'Enter' && void handleCreateClient()} className={field} />
                      <input type="email" placeholder="Email (optional)" value={newClientEmail} onChange={e => setNewClientEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && void handleCreateClient()} className={field} />
                      <span className="flex gap-2">
                        <button type="button" onClick={() => { setAddingClient(false); setNewClientName(''); setNewClientEmail('') }} className="h-11 px-3 rounded-[10px] border border-divider text-[13px] text-text-secondary bg-surface">Cancel</button>
                        <button type="button" onClick={() => void handleCreateClient()} disabled={!newClientName.trim() || creatingClient} className="h-11 px-4 rounded-[10px] bg-[#2563EB] text-white text-[13px] font-semibold disabled:opacity-50">{creatingClient ? 'Adding…' : 'Add customer'}</button>
                      </span>
                    </div>
                  )}
                </div>
                <label className={label}>
                  <span className={labText}>Valid until</span>
                  <input type="date" value={validUntil} onChange={e => updateValidUntil(e.target.value)} className={field} />
                </label>
              </div>
            </div>

            <div className="h-px bg-divider" />

            <div className="flex flex-col gap-3">
              {groupHead('Send to')}
              <div className="grid sm:grid-cols-3 gap-4 items-end">
                <div className="relative">
                  <label className={label}>
                    <span className={labText}>Contact person{contacts.length > 0 && <span className="font-medium text-[11px] whitespace-nowrap">{contacts.length} saved</span>}</span>
                    <span className="relative">
                      <input type="text" value={contactName} placeholder={clientId ? 'Pick or type a name' : 'Type a name'} autoComplete="off"
                        onChange={e => updateHeader(HV.contactName, e.target.value)} onFocus={() => setContactOpen(true)} onBlur={() => setTimeout(() => setContactOpen(false), 160)}
                        className={cn(field, contacts.length > 0 && 'pr-9')} />
                      {contacts.length > 0 && <span className="material-icons !text-[18px] text-text-secondary absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">expand_more</span>}
                    </span>
                  </label>
                  {contactOpen && contacts.length > 0 && (
                    <div role="listbox" aria-label="Contacts" className="absolute left-0 top-full mt-1 z-40 w-[min(320px,90vw)] bg-surface border border-divider rounded-xl shadow-[0_14px_30px_rgba(15,23,42,0.16)] overflow-hidden text-[13px]">
                      {contacts.map(c => (
                        <button key={`${c.name}-${c.email}`} type="button" role="option" aria-selected={c.name === contactName} onMouseDown={() => pickContact(c)}
                          className={cn('w-full text-left px-3 py-2.5 border-b border-divider hover:bg-surface-elevated', c.name === contactName && 'bg-[#EEF4FF]')}>
                          <b>{c.name}</b>{c.note && <span className="text-text-secondary"> · {c.note}</span>}
                          <span className="block text-[12px] text-text-secondary">{[c.email, c.phone].filter(Boolean).join(' · ') || 'No email or number saved'}</span>
                        </button>
                      ))}
                      <span className="block px-3 py-2.5 text-[#2563EB] font-medium">+ Someone else: just type their name</span>
                    </div>
                  )}
                </div>
                <label className={label}>
                  <span className={labText}>Email</span>
                  <input type="email" value={headerValues[HV.contactEmail] ?? ''} placeholder="name@company.co.za" onChange={e => updateHeader(HV.contactEmail, e.target.value)} className={field} />
                </label>
                <label className={label}>
                  <span className={labText}>Phone / WhatsApp</span>
                  <input type="tel" value={headerValues[HV.contactPhone] ?? ''} placeholder="082 000 0000" onChange={e => updateHeader(HV.contactPhone, e.target.value)} className={field} />
                </label>
              </div>
            </div>

            <div className="h-px bg-divider" />

            <div className="flex flex-col gap-3">
              {groupHead('Details')}
              <div className="grid sm:grid-cols-3 gap-4 items-end">
                <label className={cn(label, 'sm:col-span-2')}>
                  <span className={labText}>Address</span>
                  <input type="text" value={headerValues.site_address ?? ''} maxLength={200} placeholder="Street, suburb, city" onChange={e => updateHeader('site_address', e.target.value)} className={field} />
                </label>
                <label className={label}>
                  <span className={labText}>Customer VAT no.{optionalTag}</span>
                  <input type="text" value={headerValues[HV.clientVat] ?? ''} maxLength={30} placeholder="If they have one" onChange={e => updateHeader(HV.clientVat, e.target.value)} className={field} />
                </label>
                <label className={label}>
                  <span className={labText}>Client order no.{optionalTag}</span>
                  <input type="text" value={headerValues.client_order_no ?? ''} maxLength={60} placeholder="Their PO, if they gave one" onChange={e => updateHeader('client_order_no', e.target.value)} className={field} />
                </label>
                <div className={label}>
                  <label htmlFor="quote-sales-rep" className={labText}>Sales rep</label>
                  <span className="relative">
                    <select id="quote-sales-rep" value={salesRep ?? ''} onChange={e => void updateSalesRep(e.target.value || null)}
                      disabled={(!!paidRepId && paidRepId === salesRep) || (repList.length === 0 && !salesRep)}
                      aria-describedby={paidRepId && paidRepId === salesRep ? 'quote-sales-rep-paid' : undefined}
                      className={cn(field, 'appearance-none pr-9 cursor-pointer disabled:cursor-not-allowed')}>
                      <option value="">{repList.length ? 'No commission' : 'No sales reps set up'}</option>
                      {salesRep && !repList.some(r => r.id === salesRep) && <option value={salesRep}>Current rep (no longer a sales rep)</option>}
                      {repList.map(r => <option key={r.id} value={r.id}>{r.name ?? 'Staff member'}</option>)}
                    </select>
                    <span className="material-icons !text-[18px] text-text-secondary absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">expand_more</span>
                  </span>
                </div>
                <div className={label}>
                  <span className={labText}>Currency{foreign ? ' and rate' : ''}</span>
                  <span className="h-11 rounded-[10px] border border-divider bg-surface-elevated flex items-stretch">
                    <CurrencyPicker bare value={quoteCurrency} allowDefault={false} homeCurrency={homeCurrency} label="Currency" disabled={locked}
                      className={cn(foreign && 'border-r border-divider')}
                      onChange={c => { const nx = c ?? homeCurrency; setQuoteCurrency(nx); quoteCurrencyRef.current = nx; setCurrencyTouched(true); scheduleAutoSave() }} />
                    {foreign && (
                      <span className="flex-1 flex items-center gap-1 px-2.5 text-[14px] text-text-secondary min-w-0">
                        1 = <input inputMode="decimal" value={fxRate} aria-label="Exchange rate" placeholder={dailyRate ? dailyRate.toFixed(2) : 'today'}
                          onChange={e => { setFxRate(e.target.value); scheduleAutoSave() }} className="flex-1 min-w-0 bg-transparent outline-none font-medium text-text-primary" />
                        <span className="text-[12px]">{homeCurrency}</span>
                      </span>
                    )}
                  </span>
                </div>
                {otherHeaders.map(h => (
                  <label key={h} className={label}>
                    <span className={labText}>{HEADER_LABEL[h] ?? h}</span>
                    <input type={h === 'event_date' ? 'date' : 'text'} value={headerValues[h] ?? ''} maxLength={200} onChange={e => updateHeader(h, e.target.value)} className={field} />
                  </label>
                ))}
                <label className={cn(label, 'sm:col-span-2')}>
                  <span className={labText}>Quote title{optionalTag}</span>
                  <input type="text" value={title} maxLength={120} placeholder="e.g. Ceiling repairs, Harbour Rd" onChange={e => updateTitle(e.target.value)} className={field} />
                </label>
                <div className={label}>
                  <span className={labText}>Project or job{optionalTag}</span>
                  <button type="button" onClick={() => setLinkOpen(v => !v)} className={cn(field, 'text-left flex items-center justify-between font-normal')}>
                    <span className="truncate">{[linkedProject?.title, linkedJob?.title].filter(Boolean).join(' · ') || 'Not linked'}</span>
                    <span className="material-icons !text-[18px] text-text-secondary">{linkOpen ? 'expand_less' : 'expand_more'}</span>
                  </button>
                </div>
                {linkOpen && (
                  <div className="sm:col-span-3 grid sm:grid-cols-2 gap-4">
                    <label className={label}><span className={labText}>Project</span>
                      <select value={dealId ?? ''} onChange={e => updateDeal(e.target.value || null)} className={field}>
                        <option value="">None</option>{projects.map(p => <option key={p.id} value={p.id}>{p.label ? `${p.label} · ${p.title}` : p.title}</option>)}
                      </select>
                    </label>
                    <label className={label}><span className={labText}>Job{jobId && <Link href={`/dashboard/jobs/${jobId}`} className="text-[#2563EB] font-medium">Open job</Link>}</span>
                      <select value={jobId ?? ''} onChange={e => updateJob(e.target.value || null)} className={field}>
                        <option value="">None</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.label ? `${j.label} · ${j.title}` : j.title}</option>)}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            </div>
            {(paidRepId && paidRepId === salesRep && !repNote) ? <p id="quote-sales-rep-paid" className="md:pl-[244px] text-[12.5px] text-text-secondary">Commission has been paid out on this quote, so the rep can’t change.</p> : null}
            {repNote && <p className="md:pl-[244px] text-[12.5px] text-text-secondary" role="status">{repNote}</p>}
            <p className="md:pl-[244px] text-[12.5px] text-text-secondary leading-[1.5]">
              {foreign ? 'The rate is today’s and you can change it. ' : 'Rand customers don’t see an exchange rate. '}If there’s no client order no., the quote uses {quoteNumber ?? 'its own number'} as the reference.
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={() => goStep(2)} className="h-12 px-7 rounded-xl bg-[#2563EB] text-white text-[14px] font-semibold hover:bg-[#1D4ED8]">Next: what you’re quoting</button>
            </div>
          </section>
        )}

        {/* ── STEPS 2 & 3 · wide content, slim totals ── */}
        {(step === 2 || step === 3) && (
          <div className="flex gap-4 flex-wrap items-start">
            <div className="flex-[999_1_600px] min-w-0 flex flex-col gap-3">
              {step === 2 && (
                <>
                  <div className="bg-surface border border-divider rounded-[14px] px-3.5 py-2.5 flex items-center gap-2.5 flex-wrap text-[13px] text-text-secondary">
                    <span>For <b className="text-text-primary font-semibold">{clientName || 'no customer yet'}</b>{foreign ? ` · ${quoteCurrency}${fxNum > 0 ? ` at ${formatCurrency(fxNum, homeCurrency)}` : ''}` : ''}</span>
                    <button type="button" onClick={() => goStep(1)} className="text-[#2563EB] font-medium">Edit</button>
                    {askSuppliers && (
                      <span role="tablist" aria-label="Quote sections" className="flex gap-1 ml-2">
                        {([['items', 'Items'], ['buyout', 'Buyout']] as const).map(([k, lab]) => (
                          <button key={k} type="button" role="tab" aria-selected={quoteView === k} onClick={() => (k === 'buyout' ? void openBuyout() : setQuoteView('items'))}
                            className={cn('h-8 px-3 rounded-lg text-[13px] font-semibold flex items-center gap-1.5', quoteView === k ? 'bg-[#EEF4FF] text-[#2563EB]' : 'text-text-secondary hover:text-text-primary')}>
                            {lab}{k === 'buyout' && sourcing.waiting > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10.5px]">{sourcing.waiting} waiting</span>}
                          </button>
                        ))}
                      </span>
                    )}
                    {!locked && quoteView === 'items' && (
                      <span className="ml-auto flex gap-2">
                        <span className="qtip-wrap relative inline-flex">
                          <button type="button" aria-describedby="import-tip" onClick={() => { setImportOpen(o => !o); setImportNote(null) }}
                            className="h-[34px] px-3 rounded-lg border border-divider bg-surface text-text-primary text-[13px] font-medium flex items-center gap-1.5 hover:bg-surface-elevated">
                            <span className="material-icons !text-[16px]">download</span>Import a list
                          </button>
                          <span id="import-tip" role="tooltip" className="qtip absolute top-11 right-[-8px] w-[290px] bg-[#0F172A] text-[#F8FAFC] rounded-xl px-3.5 py-3 text-[12.5px] leading-[1.5] shadow-[0_14px_30px_rgba(15,23,42,0.28)] z-30 text-left">
                            <span className="absolute -top-1.5 right-[52px] w-3 h-3 bg-[#0F172A] rotate-45" />
                            <span className="block font-semibold text-[13px] mb-1">Got a list from the client?</span>
                            Drop an Excel or CSV file, or paste a list or WhatsApp message like “20 bags cement, 5 × 6 m IBR sheets”. We match it to your catalogue and you check every line before it’s added. (PDFs are coming soon.)
                          </span>
                        </span>
                        <button type="button" onClick={() => setBrowseSignal(n => n + 1)}
                          className="h-[34px] px-3 rounded-lg border border-divider bg-surface text-text-primary text-[13px] font-medium hover:bg-surface-elevated">Browse catalogue</button>
                      </span>
                    )}
                  </div>

                  {importOpen && !importRows && (
                    <div className="bg-surface border border-divider rounded-[14px] p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-3"><span className="text-[15px] font-semibold">Import a list</span>
                        <button type="button" onClick={() => setImportOpen(false)} aria-label="Close" className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-elevated"><span className="material-icons !text-[18px]">close</span></button></div>
                      <div className="grid md:grid-cols-2 gap-3">
                        <label className="rounded-xl border-2 border-dashed border-divider hover:border-[#2563EB] px-4 py-6 text-center cursor-pointer flex flex-col items-center gap-1.5"
                          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void importFile(f) }}>
                          <span className="material-icons text-[#2563EB]">upload_file</span>
                          <span className="text-[14px] font-medium">Drop an Excel or CSV file here</span>
                          <span className="text-[12px] text-text-secondary">or click to choose one · columns like Item, Qty, Price</span>
                          <input type="file" accept=".xlsx,.xls,.csv,text/csv" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = '' }} />
                        </label>
                        <div className="flex flex-col gap-2">
                          <textarea rows={4} value={importText} onChange={e => setImportText(e.target.value)} placeholder={'Paste a list or WhatsApp message, e.g.\n20 bags cement\n5 x 6m IBR sheets'}
                            className="w-full rounded-xl border border-divider bg-surface-elevated px-3 py-2 text-[13.5px] resize-y focus:outline-none focus:border-[#2563EB]" />
                          <button type="button" disabled={!importText.trim()} onClick={importPasted} className="self-end h-9 px-4 rounded-lg bg-[#2563EB] text-white text-[13px] font-semibold disabled:opacity-50">Read the list</button>
                        </div>
                      </div>
                      {importNote && <p className="text-[12.5px] text-amber-800">{importNote}</p>}
                    </div>
                  )}
                  {importRows && (
                    <div className="bg-surface border border-divider rounded-[14px] overflow-hidden">
                      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-divider">
                        <span className="text-[15px] font-semibold">Check the {importRows.length} line{importRows.length === 1 ? '' : 's'} before adding</span>
                        <span className="flex gap-2">
                          <button type="button" onClick={() => setImportRows(null)} className="h-9 px-3 rounded-lg border border-divider text-[13px]">Back</button>
                          <button type="button" onClick={addImported} disabled={!importRows.some(r => r.keep)} className="h-9 px-4 rounded-lg bg-[#2563EB] text-white text-[13px] font-semibold disabled:opacity-50">Add {importRows.filter(r => r.keep).length} lines</button>
                        </span>
                      </div>
                      <ul className="divide-y divide-divider max-h-[360px] overflow-y-auto text-[13px]">
                        {importRows.map((r, i) => (
                          <li key={i} className="px-4 py-2 flex items-center gap-3">
                            <input type="checkbox" checked={r.keep} aria-label={`Add ${r.description}`} onChange={e => setImportRows(rows => rows!.map((x, j) => j === i ? { ...x, keep: e.target.checked } : x))} className="w-4 h-4 accent-[#2563EB]" />
                            <span className="w-14 text-right">{r.qty}</span>
                            <span className="flex-1 min-w-0 truncate">{r.description}</span>
                            <span className={cn('text-[11.5px] px-2 py-0.5 rounded-full', r.pick ? 'bg-emerald-50 text-emerald-700' : 'bg-[#EEF1F6] text-text-secondary')}>{r.pick ? 'From your catalogue' : 'Your own line'}</span>
                            <span className="w-24 text-right">{r.price != null || r.pick ? formatCurrency(r.price ?? r.pick!.price, quoteCurrency) : 'No price'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!importOpen && importNote && <p className="text-[12.5px] text-emerald-800 px-1">{importNote}</p>}

                  {quoteView === 'buyout' && companyId ? (
                    <BuyoutPanel companyId={companyId} buyout={buyout} lines={outsourcedLines} currency={quoteCurrency} readOnly={locked}
                      ensure={ensureQuoteBuyout} reload={reloadBuyout} onChoose={chooseForLine}
                      keep={keepMode} onKeep={rememberKeep} defaultMargin={defaultMargin} onDefaultMargin={rememberMargin} />
                  ) : template ? (
                    <TemplateLines template={template} lines={lines} items={quoteItems} itemsLoading={pickLoading && pickItems.length === 0} currency={quoteCurrency}
                      readOnly={locked} onChange={next => setTemplateLines(next as SimpleQuoteLine[])} makeLine={makeTemplateLine}
                      lineExtra={askSuppliers ? (l => (l.option_of || l.is_contingency ? null : lineExtra({ key: l.tempId, description: l.description } as EditorLine))) : undefined}
                      contingencyPct={contingencyPct} onContingency={updateContingency} hideContingency browseSignal={browseSignal} />
                  ) : (
                    // Classic (no template): the same slim table as every template; how a line is supplied sits in its ⋯.
                    <TemplateLines template={CLASSIC_TEMPLATE} lines={lines} items={quoteItems} itemsLoading={pickLoading && pickItems.length === 0} currency={quoteCurrency}
                      readOnly={locked} onChange={next => setTemplateLines(next as SimpleQuoteLine[])} makeLine={makeTemplateLine}
                      lineExtra={l => (l.option_of || l.is_contingency ? null : lineExtra({ key: l.tempId, description: l.description } as EditorLine))}
                      contingencyPct={0} onContingency={() => {}} hideContingency browseSignal={browseSignal} />
                  )}

                  {quoteView === 'items' && sourcing.count > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[12.5px] text-text-primary"><b>Sourcing</b> <span className="text-text-secondary">· {sourcing.count} outsourced {sourcing.count === 1 ? 'item' : 'items'} · {sourcing.chosen} with a cost price{sourcing.waiting ? ` · ${sourcing.waiting} waiting for replies` : ''}</span></p>
                      <button type="button" onClick={() => void openBuyout()} className="h-9 px-4 rounded-lg bg-[#2563EB] text-white text-[13px] font-semibold">Buyout</button>
                    </div>
                  )}
                </>
              )}

              {step === 3 && (
                <section className="bg-surface border border-divider rounded-[14px] p-5 sm:p-[22px] flex flex-col gap-[18px]">
                  <h2 className="text-[20px] font-semibold text-text-primary">Extras <span className="text-[14px] font-normal text-text-secondary">(all optional)</span></h2>
                  {(showDeposit || showContingency) && (
                    <div className="grid sm:grid-cols-2 gap-3.5">
                      {showDeposit && (
                        <label className={label}><span className={labText}>Deposit %</span>
                          <input type="number" inputMode="numeric" min={0} max={100} value={depositPct ?? ''} placeholder="0"
                            onChange={e => updateDepositPct(e.target.value === '' ? null : Math.min(100, Math.max(0, Number(e.target.value) || 0)))} className={field} />
                        </label>
                      )}
                      {showContingency && (
                        <label className={label}><span className={labText}>Contingency %</span>
                          <input type="number" inputMode="decimal" min={0} max={100} value={contingencyPct || ''} placeholder="0"
                            onChange={e => updateContingency(Math.min(100, Math.max(0, Number(e.target.value.replace(',', '.')) || 0)))} className={field} />
                        </label>
                      )}
                    </div>
                  )}
                  <label className={label}><span className={labText}>Delivery instructions</span>
                    <textarea rows={2} maxLength={600} value={headerValues[HV.delivery] ?? ''} onChange={e => updateHeader(HV.delivery, e.target.value)}
                      placeholder="e.g. Deliver to the back gate. Site open 07:00–16:00. Call on arrival."
                      className="rounded-[10px] border border-divider bg-surface-elevated px-3 py-2.5 text-[14px] resize-y focus:outline-none focus:border-[#2563EB]" />
                  </label>
                  <label className={label}><span className={labText}>Note to the client</span>
                    <textarea rows={2} value={notes} onChange={e => updateNotes(e.target.value)} placeholder="e.g. Thank you for the opportunity. We can start on 5 January."
                      className="rounded-[10px] border border-divider bg-surface-elevated px-3 py-2.5 text-[14px] resize-y focus:outline-none focus:border-[#2563EB]" />
                  </label>
                  {template && (
                    <label className={label}><span className={labText}>Terms</span>
                      <textarea rows={3} maxLength={4000} value={terms} onChange={e => updateTerms(e.target.value)} placeholder="Deposit, cancellation, warranty…"
                        className="rounded-[10px] border border-divider bg-surface-elevated px-3 py-2.5 text-[14px] resize-y focus:outline-none focus:border-[#2563EB]" />
                    </label>
                  )}
                </section>
              )}
            </div>
            {totalsPanel(step === 2 ? 'Next: extras' : 'Next: check and send', () => goStep((step + 1) as 3 | 4))}
          </div>
        )}
        </fieldset>

        {/* ── STEP 4 · the real document left, send options right ── */}
        {step === 4 && (
          <div className="flex gap-5 flex-wrap items-start">
            <div className="flex-[999_1_560px] min-w-0 bg-[#E6EAF1] rounded-2xl px-3 sm:px-6 pt-[18px] pb-7 flex flex-col gap-4 items-center">
              <div role="tablist" aria-label="Which document" className="flex gap-1 p-1 rounded-xl bg-surface border border-divider">
                {([['quote', 'Quotation'], ['proforma', 'Pro forma invoice']] as const).map(([k, lab]) => (
                  <button key={k} type="button" role="tab" aria-selected={docKind === k} onClick={() => { setDocKind(k); docKindRef.current = k }}
                    className={cn('h-[38px] px-[18px] rounded-[9px] text-[13.5px] font-semibold', docKind === k ? 'bg-[#2563EB] text-white' : 'text-text-primary hover:bg-surface-elevated')}>{lab}</button>
                ))}
              </div>
              <QuoteDocumentPreview input={buildPdfInput()} />
            </div>
            <aside className="flex-[1_1_260px] lg:max-w-[300px] w-full bg-surface border border-divider rounded-2xl p-[18px] flex flex-col gap-3 lg:sticky lg:top-4">
              <span className="text-[16px] font-semibold">Looks right? Send it.</span>
              <span className="text-[12.5px] text-text-secondary -mt-1.5">Sending the {docKind === 'quote' ? (attachProforma ? 'quotation and pro forma invoice' : 'quotation') : 'pro forma invoice'}{contactName ? ` to ${contactName}` : clientName ? ` to ${clientName}` : ''}</span>
              {status !== 'accepted' && status !== 'declined' || docKind === 'proforma' ? (
                <>
                  {docKind === 'quote' && (
                    <label className="flex items-start gap-2.5 text-[13px] text-text-primary cursor-pointer">
                      <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[#2563EB]" checked={attachProforma}
                        onChange={e => { setAttachProforma(e.target.checked); attachProformaRef.current = e.target.checked }} />
                      <span>Add the pro forma invoice to the email<span className="block text-[12px] text-text-secondary">One PDF: the quotation, then the pro forma with your banking details.</span></span>
                    </label>
                  )}
                  <button type="button" disabled={saveState === 'saving'} onClick={() => void openSend()} className="h-12 rounded-xl bg-[#2563EB] text-white text-[14.5px] font-semibold hover:bg-[#1D4ED8] disabled:opacity-50">Send by email</button>
                  {docKind === 'quote' && <button type="button" disabled={sendBusy} onClick={() => void handleSendWhatsApp()} className="h-12 rounded-xl border border-divider bg-surface text-text-primary text-[14.5px] font-medium hover:bg-surface-elevated disabled:opacity-50">Send on WhatsApp</button>}
                </>
              ) : null}
              <button type="button" onClick={handleDownloadPdf} className="h-12 rounded-xl border border-divider bg-surface text-text-primary text-[14.5px] font-medium hover:bg-surface-elevated">Download PDF</button>
              <div className="h-px bg-divider my-0.5" />
              <button type="button" onClick={() => goStep(3)} className="h-10 rounded-xl text-[#2563EB] text-[14px] font-medium">Back to extras</button>
              {status === 'draft' && quoteId && <span className="text-[12px] text-text-secondary">Client said yes on the phone? <button type="button" onClick={() => setShowAcceptModal(true)} className="text-[#2563EB] font-medium hover:underline">Mark it accepted</button></span>}
            </aside>
          </div>
        )}
      </div>

      {/* ── Phone: total and the next step always in reach ── */}
      <div className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-divider bg-surface/95 backdrop-blur px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-text-secondary leading-tight">Total{showDeposit && tTotals && tTotals.deposit > 0 ? ` · deposit ${formatCurrency(tTotals.deposit, quoteCurrency)}` : ''}</p>
          <p className="text-[19px] font-bold text-text-primary leading-tight">{formatCurrency(shownTotal, quoteCurrency)}</p>
        </div>
        {step < 4 ? (
          <button type="button" onClick={() => goStep((step + 1) as 2 | 3 | 4)} className="h-12 px-5 rounded-xl bg-[#2563EB] text-white text-[15px] font-semibold">Next</button>
        ) : status !== 'accepted' && status !== 'declined' ? (
          <button type="button" disabled={saveState === 'saving'} onClick={() => void openSend()} className="h-12 px-6 rounded-xl bg-[#2563EB] text-white text-[15px] font-semibold disabled:opacity-50">Send quote</button>
        ) : null}
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
            <div className="flex flex-col gap-2 mb-4">
                <button
                type="button"
                disabled={sendBusy}
                onClick={() => void handleSendWhatsApp()}
                className="h-11 px-4 rounded-lg bg-[#25D366] text-white text-left text-[14px] font-semibold hover:opacity-95 transition-opacity flex items-center gap-2 disabled:opacity-50"
              >
                <span className="material-icons text-[18px]">chat</span>
                Send on WhatsApp & mark sent
              </button>
              <p className="text-[12px] text-text-secondary text-center">or send by email</p>
            </div>
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

// ── Importing a list (Excel, CSV or pasted text) ─────────────────────────────

type ImportRow = { description: string; qty: number; unit: string | null; price: number | null; cost: number | null; pick: PickItem | null; keep: boolean }

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const x = Number(String(v).replace(/[^\d,.-]/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, ''))
  return Number.isFinite(x) ? x : null
}

/** Finds the item in your products & stock: same part number, then same name, then a name that contains it. */
export function matchPick(items: PickItem[], text: string): PickItem | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  return items.find(i => (i.sku ?? '').toLowerCase() === t)
    ?? items.find(i => i.name.toLowerCase() === t)
    ?? items.find(i => t.length >= 4 && (i.name.toLowerCase().includes(t) || t.includes(i.name.toLowerCase())))
    ?? null
}

/** Rows from a sheet: the header row tells which column is what (item/description, qty, unit, price/rate, cost). */
export function rowsFromSheet(table: unknown[][], items: PickItem[]): ImportRow[] {
  const isHead = (r: unknown[]) => r.some(c => /desc|item|product|name|qty|quantity|price|rate/i.test(String(c ?? '')))
  const hi = table.findIndex(isHead)
  const head = hi >= 0 ? table[hi].map(c => String(c ?? '').toLowerCase()) : []
  const col = (re: RegExp) => head.findIndex(h => re.test(h))
  const cDesc = hi >= 0 ? Math.max(0, col(/desc|item|product|name|service/)) : 0
  const cQty = hi >= 0 ? col(/qty|quantity|units?$|^no\.?$|count/) : 1
  const cUnit = hi >= 0 ? col(/^unit$|uom|measure/) : -1
  const cPrice = hi >= 0 ? col(/price|rate|selling|amount each|unit cost price/) : 2
  const cCost = hi >= 0 ? col(/^cost|cost price|buy/) : -1
  const out: ImportRow[] = []
  for (const r of table.slice(hi + 1)) {
    const d = String(r[cDesc] ?? '').trim()
    if (!d) continue
    const pick = matchPick(items, d)
    out.push({ description: pick?.name ?? d, qty: num(r[cQty]) ?? 1, unit: cUnit >= 0 ? String(r[cUnit] ?? '').trim() || null : null,
      price: cPrice >= 0 ? num(r[cPrice]) : null, cost: cCost >= 0 ? num(r[cCost]) : null, pick, keep: true })
  }
  return out
}

/** Rows from a pasted list or WhatsApp message: "20 bags cement", "5 x 6m IBR sheets", "Cement x 20". */
export function rowsFromText(text: string, items: PickItem[]): ImportRow[] {
  const out: ImportRow[] = []
  for (const raw of text.split(/\n|;|,(?!\d)/)) {
    const line = raw.replace(/^[\s•*\-–\d]+[.)]\s+/, '').trim()
    if (!line) continue
    let qty = 1, desc = line
    const m1 = line.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×|\*)?\s+(.+)$/i)
    const m2 = line.match(/^(.+?)\s*(?:x|×|\*)\s*(\d+(?:[.,]\d+)?)$/i)
    if (m1) { qty = Number(m1[1].replace(',', '.')); desc = m1[2] } else if (m2) { qty = Number(m2[2].replace(',', '.')); desc = m2[1] }
    desc = desc.trim()
    if (!desc) continue
    const pick = matchPick(items, desc)
    out.push({ description: pick?.name ?? desc, qty, unit: null, price: null, cost: null, pick, keep: true })
  }
  return out
}
