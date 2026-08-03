/**
 * Local type shim so `payroll/*` has zero dependency on the Next.js `@/types/database`
 * path alias. This lets the identical files be copied verbatim into
 * `supabase/functions/_shared/payroll/` for the server-side (Deno) engine.
 * Shape must stay compatible with `PayrollLineItem` in `@/types/database`.
 */
export type PayrollLineItem = { label: string; amount: number }
