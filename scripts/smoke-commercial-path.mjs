/**
 * Commercial path smoke checks (wiring + live DB objects).
 * Run from repo root: node scripts/smoke-commercial-path.mjs
 *
 * Manual UI checklist (10–15 min):
 * 1. Money Quotes → New quote → lines → Send (mailto) → Mark accepted → Create RFQ
 * 2. RFQ → add suppliers → Send to Suppliers (mailto) → Responses → Compare → Create PO
 * 3. PO → Approve → Mark sent → Receive goods
 * 4. GRN save → Create supplier invoice (lines copied) → confirm detail lines + linked PO
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const required = [
  'kaisync-web/src/components/quotes/SimpleQuoteBuilder.tsx',
  'kaisync-web/src/lib/supply-rfq.ts',
  'kaisync-web/src/lib/quote-pdf.ts',
  'kaisync-web/src/lib/rfq-mailto.ts',
  'kaisync-web/src/app/dashboard/supply/rfqs/_builder.tsx',
  'kaisync-web/src/app/dashboard/supply/rfqs/[id]/compare/page.tsx',
  'kaisync-web/src/app/dashboard/supply/purchase-orders/_po-builder.tsx',
  'kaisync-web/src/app/dashboard/supply/goods-received/_grn-form.tsx',
  'kaisync-web/src/app/dashboard/finance/supplier-invoices/page.tsx',
  'supabase/functions/send_quote_email/index.ts',
]

const checks = [
  ['Create RFQ from quote', 'kaisync-web/src/lib/supply-rfq.ts', 'createSupplyRfqFromQuote'],
  ['RFQ mailto send', 'kaisync-web/src/app/dashboard/supply/rfqs/_builder.tsx', 'openRfqMailto'],
  ['RFQ compare RPC', 'kaisync-web/src/app/dashboard/supply/rfqs/[id]/compare/page.tsx', 'get_supply_rfq_comparison'],
  ['PO receive goods', 'kaisync-web/src/app/dashboard/supply/purchase-orders/_po-builder.tsx', 'goods-received/new?po_id='],
  ['GRN → invoice', 'kaisync-web/src/app/dashboard/supply/goods-received/_grn-form.tsx', 'supplier-invoices'],
  ['Invoice lines from GRN', 'kaisync-web/src/app/dashboard/finance/supplier-invoices/page.tsx', 'goods_received_lines'],
  ['Invoice lines from PO', 'kaisync-web/src/app/dashboard/finance/supplier-invoices/page.tsx', 'purchase_order_lines'],
  ['Quote mailto primary', 'kaisync-web/src/components/quotes/SimpleQuoteBuilder.tsx', 'handleSendWithMailto'],
  ['Resend function ready', 'supabase/functions/send_quote_email/index.ts', 'RESEND_API_KEY'],
]

let failed = 0
for (const rel of required) {
  const ok = existsSync(join(root, rel))
  console.log(ok ? 'OK  file' : 'MISS', rel)
  if (!ok) failed++
}

for (const [label, rel, needle] of checks) {
  const text = readFileSync(join(root, rel), 'utf8')
  const ok = text.includes(needle)
  console.log(ok ? 'OK  wire' : 'MISS', label)
  if (!ok) failed++
}

// Live DB object checks (best-effort; skip if CLI unavailable)
const sql = `
SELECT
  to_regclass('public.commercial_quote_sends') IS NOT NULL AS has_quote_sends,
  to_regclass('public.quote_rfqs') IS NULL AS quote_rfqs_gone,
  to_regclass('public.supplier_invoice_lines') IS NOT NULL AS has_invoice_lines,
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_supply_rfq_comparison'
  ) AS has_supply_compare;
`
const db = spawnSync(
  'npx',
  ['supabase', 'db', 'query', '--linked', sql],
  { cwd: root, encoding: 'utf8', shell: true },
)
if (db.status === 0 && db.stdout.includes('has_quote_sends')) {
  const hasSends = db.stdout.includes('"has_quote_sends": true') || db.stdout.includes('"has_quote_sends":true')
  const rfqsGone = db.stdout.includes('"quote_rfqs_gone": true') || db.stdout.includes('"quote_rfqs_gone":true')
  const hasLines = db.stdout.includes('"has_invoice_lines": true') || db.stdout.includes('"has_invoice_lines":true')
  const hasCmp = db.stdout.includes('"has_supply_compare": true') || db.stdout.includes('"has_supply_compare":true')
  for (const [ok, label] of [
    [hasSends, 'DB commercial_quote_sends'],
    [rfqsGone, 'DB quote_rfqs dropped'],
    [hasLines, 'DB supplier_invoice_lines'],
    [hasCmp, 'DB get_supply_rfq_comparison'],
  ]) {
    console.log(ok ? 'OK  db  ' : 'MISS', label)
    if (!ok) failed++
  }
} else {
  console.log('SKIP db  (supabase db query unavailable)')
}

console.log('\nResend: RESEND_API_KEY not in project secrets — mailto remains primary for quotes/RFQs.')
console.log('When ready: set RESEND_API_KEY (+ NOTIFY_FROM_EMAIL) on Supabase, then re-enable Edge send in SimpleQuoteBuilder.')

console.log(failed === 0 ? '\nSmoke path wiring: PASS' : `\nSmoke path wiring: FAIL (${failed})`)
process.exit(failed === 0 ? 0 : 1)
