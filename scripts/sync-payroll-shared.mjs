#!/usr/bin/env node
/**
 * Sync payroll engine source-of-truth from kaisync-web → Deno Edge _shared.
 *
 * Source: kaisync-web/src/lib/payroll/*.ts (+ punch-session.ts, timezone.ts)
 * Target: supabase/functions/_shared/payroll/
 *
 * Does NOT overwrite Deno-only adapters: prefs.ts, adapter.ts
 * (those mirror payroll-settings.ts / payroll-engine.ts and stay hand-maintained).
 *
 * Usage: node scripts/sync-payroll-shared.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webPayroll = path.join(root, 'kaisync-web', 'src', 'lib', 'payroll')
const webLib = path.join(root, 'kaisync-web', 'src', 'lib')
const destDir = path.join(root, 'supabase', 'functions', '_shared', 'payroll')

const PAYROLL_FILES = [
  'types.ts',
  'period.ts',
  'leave-days.ts',
  'salary-resolver.ts',
  'sars-paye.ts',
  'irp5.ts',
  'calculator.ts',
  'sessions-from-punches.ts',
  'bank-export.ts',
]

const LIB_FILES = ['punch-session.ts', 'timezone.ts']

function transformForDeno(source, fileName) {
  let out = source

  // Path-alias → relative Deno imports inside _shared/payroll
  out = out.replaceAll("from '@/lib/timezone'", "from './timezone.ts'")
  out = out.replaceAll('from "@/lib/timezone"', 'from "./timezone.ts"')
  out = out.replaceAll("from '@/lib/punch-session'", "from './punch-session.ts'")
  out = out.replaceAll('from "@/lib/punch-session"', 'from "./punch-session.ts"')

  // Relative imports without extension → .ts (Deno)
  out = out.replace(
    /from\s+['"](\.\/[^'"]+?)['"]/g,
    (match, spec) => {
      if (spec.endsWith('.ts') || spec.endsWith('.js') || spec.endsWith('.json')) return match
      return match.replace(spec, `${spec}.ts`)
    }
  )

  const banner =
    `/**\n` +
    ` * AUTO-SYNCED from kaisync-web — do not edit by hand.\n` +
    ` * Source: ${fileName.startsWith('payroll/') ? 'kaisync-web/src/lib/' + fileName : 'kaisync-web/src/lib/' + fileName}\n` +
    ` * Regenerate: node scripts/sync-payroll-shared.mjs\n` +
    ` */\n\n`

  // Strip an existing AUTO-SYNCED banner if re-running
  out = out.replace(/^\/\*\*\n \* AUTO-SYNCED[\s\S]*?\*\/\n\n/, '')
  return banner + out
}

function copyOne(srcPath, destName, label) {
  if (!fs.existsSync(srcPath)) {
    console.error(`Missing source: ${srcPath}`)
    process.exit(1)
  }
  const raw = fs.readFileSync(srcPath, 'utf8')
  const transformed = transformForDeno(raw, label)
  const destPath = path.join(destDir, destName)
  fs.writeFileSync(destPath, transformed, 'utf8')
  console.log(`  ✓ ${destName}`)
}

fs.mkdirSync(destDir, { recursive: true })
console.log('Syncing payroll shared → supabase/functions/_shared/payroll')

for (const name of PAYROLL_FILES) {
  copyOne(path.join(webPayroll, name), name, `payroll/${name}`)
}
for (const name of LIB_FILES) {
  copyOne(path.join(webLib, name), name, name)
}

console.log('Done. Hand-maintained (not overwritten): prefs.ts, adapter.ts')
