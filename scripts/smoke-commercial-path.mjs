/**
 * Static smoke checks for Money → RFQ → PO → GRN → supplier invoice wiring.
 * Run: node scripts/smoke-commercial-path.mjs
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const required = [
  'kaisync-web/src/components/quotes/SimpleQuoteBuilder.tsx',
  'kaisync-web/src/lib/supply-rfq.ts',
  'kaisync-web/src/lib/quote-pdf.ts',
  'kaisync-web/src/app/dashboard/supply/rfqs/_builder.tsx',
  'kaisync-web/src/app/dashboard/supply/rfqs/[id]/compare/page.tsx',
  'kaisync-web/src/app/dashboard/supply/purchase-orders/_po-builder.tsx',
  'kaisync-web/src/app/dashboard/supply/goods-received/_grn-form.tsx',
  'kaisync-web/src/app/dashboard/finance/supplier-invoices/page.tsx',
  'supabase/functions/send_quote_email/index.ts',
  'supabase/migrations/20260827170000_rename_supply_rfq_comparison.sql',
  'supabase/migrations/20260827180000_quote_sends_and_drop_quote_rfqs.sql',
]

const checks = [
  ['Create RFQ from quote', 'kaisync-web/src/lib/supply-rfq.ts', 'createSupplyRfqFromQuote'],
  ['RFQ compare RPC', 'kaisync-web/src/app/dashboard/supply/rfqs/[id]/compare/page.tsx', 'get_supply_rfq_comparison'],
  ['PO receive goods', 'kaisync-web/src/app/dashboard/supply/purchase-orders/_po-builder.tsx', 'goods-received/new?po_id='],
  ['GRN → invoice', 'kaisync-web/src/app/dashboard/supply/goods-received/_grn-form.tsx', 'supplier-invoices'],
  ['Invoice PO prefill', 'kaisync-web/src/app/dashboard/finance/supplier-invoices/page.tsx', 'po_id'],
  ['Quote email function', 'supabase/functions/send_quote_email/index.ts', 'RESEND_API_KEY'],
]

let failed = 0
for (const rel of required) {
  const ok = existsSync(join(root, rel))
  console.log(ok ? 'OK  file' : 'MISS', rel)
  if (!ok) failed++
}

const { readFileSync } = await import('node:fs')
for (const [label, rel, needle] of checks) {
  const text = readFileSync(join(root, rel), 'utf8')
  const ok = text.includes(needle)
  console.log(ok ? 'OK  wire' : 'MISS', label)
  if (!ok) failed++
}

console.log(failed === 0 ? '\nSmoke path wiring: PASS' : `\nSmoke path wiring: FAIL (${failed})`)
process.exit(failed === 0 ? 0 : 1)
