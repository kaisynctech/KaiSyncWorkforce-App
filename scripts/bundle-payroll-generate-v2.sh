#!/usr/bin/env bash
# Builds the single-file bundle deployed as the `payroll-generate-v2` Edge Function (W5).
# Source of truth stays supabase/functions/payroll-generate/index.ts + _shared/payroll/*.
# Run `node scripts/sync-payroll-shared.mjs` first, then deploy the output file as index.ts.
set -euo pipefail
cd "$(dirname "$0")/../supabase/functions"
deno bundle --platform deno --external 'jsr:*' -o ../../.payroll-generate-v2.bundle.js payroll-generate/index.ts
md5sum ../../.payroll-generate-v2.bundle.js
