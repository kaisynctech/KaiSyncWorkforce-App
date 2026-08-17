'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import SimpleQuoteLineRow from './SimpleQuoteLineRow'
import RateCardPicker, { type RateCardSelection } from './RateCardPicker'

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
}

type ClientRow = { id: string; name: string; email?: string | null }
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayPlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function fmtR(n: number): string {
  return 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function blankLine(): SimpleQuoteLine {
  return {
    id:                null,
    tempId:            crypto.randomUUID(),
    description:       '',
    qty:               1,
    unit:              'each',
    unit_price:        0,
    total:             0,
    catalogue_item_id: null,
    sort_order:        0,
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

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [companyId,  setCompanyId]  = useState<string | null>(null)
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

  // ── Lines ─────────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<SimpleQuoteLine[]>([blankLine()])

  // ── Clients list ──────────────────────────────────────────────────────────
  const [clients,        setClients]        = useState<ClientRow[]>([])
  const [clientSearch,   setClientSearch]   = useState('')
  const [clientDropOpen, setClientDropOpen] = useState(false)
  const [addingClient,   setAddingClient]   = useState(false)
  const [newClientName,  setNewClientName]  = useState('')
  const [newClientEmail, setNewClientEmail] = useState('')
  const [creatingClient, setCreatingClient] = useState(false)

  // ── UI ────────────────────────────────────────────────────────────────────
  const [showRatePicker, setShowRatePicker] = useState(false)
  const [saveState,      setSaveState]      = useState<SaveState>('idle')
  const [showSendModal,  setShowSendModal]  = useState(false)

  // ── Mutable refs (for use inside async callbacks without stale closures) ──
  const isLoaded       = useRef(false)
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
  const linesRef      = useRef<SimpleQuoteLine[]>([blankLine()])
  const quoteNumberRef = useRef<string | null>(null)

  // Keep refs in sync with state on every render
  quoteIdRef.current     = quoteId
  companyIdRef.current   = companyId
  employeeIdRef.current  = employeeId
  titleRef.current       = title
  clientIdRef.current    = clientId
  validUntilRef.current  = validUntil
  notesRef.current       = notes
  statusRef.current      = status
  linesRef.current       = lines
  quoteNumberRef.current = quoteNumber

  // ── Resolve auth on mount ──────────────────────────────────────────────────
  useEffect(() => {
    resolveCurrentMember(supabase).then(m => {
      if (!m) return
      setCompanyId(m.companyId)
      setEmployeeId(m.employeeId)
      companyIdRef.current  = m.companyId
      employeeIdRef.current = m.employeeId
      setAuthReady(true)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load data after auth resolves ──────────────────────────────────────────
  useEffect(() => {
    if (!authReady || !companyId) return
    void loadData(companyId)
  }, [authReady, companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData(cid: string) {
    // Load clients list
    const { data: cData } = await supabase
      .from('clients')
      .select('id, name, email')
      .eq('company_id', cid)
      .eq('is_active', true)
      .order('name')
      .limit(200)
    setClients((cData ?? []) as ClientRow[])

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
        const vu = (q.valid_until as string | null) ?? todayPlus(14)
        setValidUntil(vu);         validUntilRef.current = vu
        const n = (q.scope_notes as string | null) ?? ''
        setNotes(n);               notesRef.current = n

        // Pre-fill client search input from loaded clients
        const match = (cData ?? []).find((c: ClientRow) => c.id === cid2)
        if (match) setClientSearch((match as ClientRow).name)
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
        }))
        setLines(mapped)
        linesRef.current = mapped
      }
    }

    isLoaded.current = true
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function doSave(overrideStatus?: string) {
    const cid = companyIdRef.current
    const eid = employeeIdRef.current
    if (!cid || !eid) return

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

      // Upsert quote header
      const payload: Record<string, unknown> = {
        company_id:   cid,
        quote_number: qNum,
        client_id:    clientIdRef.current,
        title:        titleRef.current.trim() || 'Untitled Quote',
        status:       newStatus,
        valid_until:  validUntilRef.current,
        scope_notes:  notesRef.current.trim() || null,
        updated_at:   new Date().toISOString(),
      }
      if (!qid) payload.created_by = eid
      if (qid)  payload.id = qid

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

      // Save lines: delete all + re-insert
      const ls = linesRef.current
      await supabase.from('commercial_quote_lines').delete().eq('quote_id', savedId)
      if (ls.length > 0) {
        await supabase.from('commercial_quote_lines').insert(
          ls.map((l, i) => ({
            company_id:        cid,
            quote_id:          savedId,
            sort_order:        i,
            description:       l.description,
            quantity:          l.qty,
            unit:              l.unit,
            unit_sell_price:   l.unit_price,
            catalogue_item_id: l.catalogue_item_id,
            cost_price:        0,
            markup_percent:    0,
            subtotal_cost:     0,
            subtotal_sell:     l.total,
            vat_rate:          0.15,
            vat_amount:        l.total * 0.15,
            line_total:        l.total * 1.15,
            is_optional:       false,
            is_excluded:       false,
            item_type:         'material',
          }))
        )
      }

      setSaveState('saved')
      if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current)
      savedFadeTimer.current = setTimeout(() => setSaveState('idle'), 2000)

    } catch (err) {
      console.error('Quote save failed', err)
      setSaveState('error')
    }
  }

  // ── Auto-save scheduler ────────────────────────────────────────────────────
  function scheduleAutoSave() {
    if (!isLoaded.current) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => void doSave(), 1500)
  }

  // ── Field updaters (each sets state + ref + schedules auto-save) ───────────
  function updateTitle(v: string) {
    setTitle(v); titleRef.current = v; scheduleAutoSave()
  }
  function selectClient(id: string | null, name: string) {
    setClientId(id); clientIdRef.current = id
    setClientSearch(name); scheduleAutoSave()
  }
  function updateValidUntil(v: string) {
    setValidUntil(v); validUntilRef.current = v; scheduleAutoSave()
  }
  function updateNotes(v: string) {
    setNotes(v); notesRef.current = v; scheduleAutoSave()
  }

  // ── Line operations ────────────────────────────────────────────────────────
  function updateLine(tempId: string, patch: Partial<SimpleQuoteLine>) {
    setLines(prev => {
      const next = prev.map(l => {
        if (l.tempId !== tempId) return l
        const merged = { ...l, ...patch }
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

  function addBlankLine() {
    setLines(prev => {
      const next = [...prev, blankLine()]
      linesRef.current = next
      return next
    })
    // No auto-save on blank add — let typing trigger it
  }

  function addFromRateCard(result: RateCardSelection) {
    const line: SimpleQuoteLine = {
      id:                null,
      tempId:            crypto.randomUUID(),
      description:       result.name,
      qty:               1,
      unit:              result.unit,
      unit_price:        result.unit_price,
      total:             result.unit_price,
      catalogue_item_id: result.catalogue_item_id,
      sort_order:        0,
    }
    setLines(prev => {
      const next = [...prev, line]
      linesRef.current = next
      return next
    })
    scheduleAutoSave()
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
        is_active:  true,
      })
      .select('id, name, email')
      .maybeSingle()
    if (data) {
      const c = data as ClientRow
      setClients(prev => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
      selectClient(c.id, c.name)
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

  // ── Computed totals ────────────────────────────────────────────────────────
  const subtotal = lines.reduce((s, l) => s + l.total, 0)
  const vat      = subtotal * 0.15
  const total    = subtotal + vat

  // ── Client dropdown ────────────────────────────────────────────────────────
  const filteredClients = clients
    .filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
    .slice(0, 8)

  const clientName = clients.find(c => c.id === clientId)?.name ?? ''

  // ── Render ────────────────────────────────────────────────────────────────

  if (!authReady) {
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

            <button
              type="button"
              onClick={() => void doSave()}
              disabled={saveState === 'saving'}
              className="h-9 px-4 rounded-lg border border-divider text-[13px] text-text-secondary font-medium hover:bg-surface-elevated transition-colors disabled:opacity-50"
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={() => setShowSendModal(true)}
              disabled={saveState === 'saving'}
              className="h-9 px-5 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              Mark as sent
              <span className="material-icons text-[15px]">send</span>
            </button>
          </div>
        </div>

        {/* ── Quote meta ── */}
        <div className="rounded-xl border border-divider bg-surface p-5 grid grid-cols-1 sm:grid-cols-4 gap-4">

          {/* Customer combobox */}
          <div className="sm:col-span-2 relative">
            <label className="block text-[11px] text-text-secondary uppercase tracking-wide mb-1.5">
              Customer
            </label>
            <input
              type="text"
              placeholder="Search or select client…"
              value={clientSearch}
              onChange={e => { setClientSearch(e.target.value); setClientDropOpen(true) }}
              onFocus={() => setClientDropOpen(true)}
              onBlur={() => setTimeout(() => setClientDropOpen(false), 160)}
              className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary transition-colors"
            />

            {/* Client dropdown */}
            {clientDropOpen && !addingClient && (
              <div className="absolute left-0 top-full mt-1 z-50 w-full bg-surface border border-divider rounded-xl shadow-xl py-1 max-h-48 overflow-y-auto">
                {filteredClients.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={() => { selectClient(c.id, c.name); setClientDropOpen(false) }}
                    className={cn(
                      'w-full text-left px-3 py-2 text-[13px] hover:bg-surface-elevated transition-colors',
                      c.id === clientId ? 'text-primary font-medium' : 'text-text-primary',
                    )}
                  >
                    {c.name}
                  </button>
                ))}
                {filteredClients.length === 0 && clientSearch.trim() && (
                  <p className="px-3 py-2 text-[12px] text-text-secondary">No clients found</p>
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
          <div>
            <label className="block text-[11px] text-text-secondary uppercase tracking-wide mb-1.5">
              Quote #
            </label>
            <div className="h-9 flex items-center text-[13px] text-text-secondary px-3 rounded-lg border border-divider bg-surface-elevated">
              {quoteNumber ?? '— (auto)'}
            </div>
          </div>

          {/* Valid until */}
          <div>
            <label className="block text-[11px] text-text-secondary uppercase tracking-wide mb-1.5">
              Valid until
            </label>
            <input
              type="date"
              value={validUntil}
              onChange={e => updateValidUntil(e.target.value)}
              className="w-full h-9 rounded-lg border border-divider bg-surface px-3 text-[13px] text-text-primary focus:outline-none focus:border-primary transition-colors"
            />
          </div>
        </div>

        {/* ── Lines ── */}
        <div className="rounded-xl border border-divider overflow-hidden">

          {/* Column headers */}
          <div
            className="grid gap-2 px-4 py-2.5 bg-surface-elevated border-b border-divider text-[11px] text-text-secondary uppercase tracking-wide"
            style={{ gridTemplateColumns: '1.5rem 1fr 5rem 6rem 7.5rem 5.5rem 1.5rem' }}
          >
            <span />
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span>Unit</span>
            <span className="text-right">Unit price</span>
            <span className="text-right">Total</span>
            <span />
          </div>

          {/* Line rows */}
          <div className="divide-y divide-divider">
            {lines.map(line => (
              <SimpleQuoteLineRow
                key={line.tempId}
                line={line}
                isOnly={lines.length === 1}
                onUpdate={patch => updateLine(line.tempId, patch)}
                onRemove={() => removeLine(line.tempId)}
              />
            ))}
          </div>

          {/* Add line / From rate card */}
          <div className="flex gap-2 px-4 py-3 border-t border-divider">
            <button
              type="button"
              onClick={addBlankLine}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-divider text-[12px] text-text-secondary hover:bg-surface-elevated hover:border-primary/30 hover:text-primary transition-colors"
            >
              <span className="material-icons text-[15px]">add</span>
              Add line
            </button>
            <button
              type="button"
              onClick={() => setShowRatePicker(true)}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-divider text-[12px] text-text-secondary hover:bg-surface-elevated hover:border-primary/30 hover:text-primary transition-colors"
            >
              <span className="material-icons text-[15px]">grid_view</span>
              From rate card
            </button>
          </div>
        </div>

        {/* ── Totals ── */}
        <div className="flex justify-end">
          <div className="w-72 rounded-xl border border-divider overflow-hidden">
            <div className="flex justify-between items-center px-5 py-3 border-b border-divider">
              <span className="text-[13px] text-text-secondary">Subtotal (excl. VAT)</span>
              <span className="text-[13px] text-text-primary font-medium tabular-nums">{fmtR(subtotal)}</span>
            </div>
            <div className="flex justify-between items-center px-5 py-3 border-b border-divider">
              <span className="text-[13px] text-text-secondary">VAT (15%)</span>
              <span className="text-[13px] text-text-primary tabular-nums">{fmtR(vat)}</span>
            </div>
            <div className="flex justify-between items-center px-5 py-4 bg-surface-elevated">
              <span className="text-[14px] text-text-primary font-semibold">Total (incl. VAT)</span>
              <span className="text-[15px] text-text-primary font-bold tabular-nums">{fmtR(total)}</span>
            </div>
          </div>
        </div>

        {/* ── Notes ── */}
        <div className="rounded-xl border border-divider overflow-hidden">
          <div className="px-4 py-2.5 border-b border-divider bg-surface-elevated">
            <span className="text-[11px] text-text-secondary uppercase tracking-wide">
              Notes
            </span>
          </div>
          <textarea
            rows={4}
            value={notes}
            onChange={e => updateNotes(e.target.value)}
            placeholder="Payment terms, warranty, scope exclusions…"
            className="w-full px-4 py-3 text-[13px] text-text-primary bg-surface resize-none focus:outline-none placeholder-text-secondary/40"
          />
        </div>

        {/* ── Upload — Phase 2 ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => alert('Document upload coming in Phase 2.')}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-divider text-[12px] text-text-secondary hover:bg-surface-elevated transition-colors"
          >
            <span className="material-icons text-[15px]">upload_file</span>
            Upload PO / PDF
          </button>
          <button
            type="button"
            onClick={() => alert('Image upload coming in Phase 2.')}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-divider text-[12px] text-text-secondary hover:bg-surface-elevated transition-colors"
          >
            <span className="material-icons text-[15px]">image</span>
            Upload image
          </button>
          <span className="text-[11px] text-text-secondary italic px-1.5 py-0.5 rounded-full bg-surface-elevated">
            AI extraction — Phase 2
          </span>
        </div>

      </div>

      {/* ── Rate card picker ── */}
      {showRatePicker && companyId && (
        <RateCardPicker
          companyId={companyId}
          onSelect={addFromRateCard}
          onClose={() => setShowRatePicker(false)}
        />
      )}

      {/* ── Mark as sent confirmation ── */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="relative bg-surface rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-[15px] font-semibold text-text-primary mb-2">Mark as sent?</h3>
            <p className="text-[13px] text-text-secondary mb-6">
              This will set the quote status to{' '}
              <span className="font-medium text-text-primary">Sent</span>
              {clientName ? ` for ${clientName}` : ''}.
              {' '}Email delivery is coming in Phase 2.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowSendModal(false)}
                className="h-9 px-4 rounded-lg border border-divider text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleMarkAsSent()}
                className="h-9 px-5 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors"
              >
                Mark as sent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
