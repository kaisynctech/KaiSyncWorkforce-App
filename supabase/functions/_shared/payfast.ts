// supabase/functions/_shared/payfast.ts
//
// PayFast helpers shared by payfast_checkout, payfast_itn and billing_run. Follows PayFast's own SDK
// (github.com/Payfast/payfast-php-sdk): PHP-style urlencode, MD5 signatures, the server "validate"
// call for notices, and the v1 API for charging a saved card ("ad hoc" tokenization charge).
//
// Env (Supabase secrets — the owner enters the live values herself, never in chat or code):
//   PAYFAST_MODE         'sandbox' (default) or 'live'
//   PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, PAYFAST_PASSPHRASE

import { crypto } from "jsr:@std/crypto@1";
import { encodeHex } from "jsr:@std/encoding@1/hex";

export type PayFastConfig = {
  mode: "sandbox" | "live";
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  processUrl: string;
  validateUrl: string;
  apiBase: string;
};

export function payfastConfig(): PayFastConfig | null {
  const mode = (Deno.env.get("PAYFAST_MODE") ?? "sandbox").trim() === "live" ? "live" : "sandbox";
  let merchantId = (Deno.env.get("PAYFAST_MERCHANT_ID") ?? "").trim();
  let merchantKey = (Deno.env.get("PAYFAST_MERCHANT_KEY") ?? "").trim();
  let passphrase = (Deno.env.get("PAYFAST_PASSPHRASE") ?? "").trim();
  // Testing: PayFast's own published sandbox account (in their SDK readme), used until our own
  // details are entered. Test cards only; no real money can move through the sandbox.
  if (mode === "sandbox" && !merchantId) {
    merchantId = "10000100"; merchantKey = "46f0cd694581a"; passphrase = "jt7NOE43FZPn";
  }
  if (!merchantId || !merchantKey || !passphrase) return null;
  const host = mode === "live" ? "https://www.payfast.co.za" : "https://sandbox.payfast.co.za";
  return {
    mode, merchantId, merchantKey, passphrase,
    processUrl: `${host}/eng/process`,
    validateUrl: `${host}/eng/query/validate`,
    apiBase: "https://api.payfast.co.za",
  };
}

/** PHP urlencode(): spaces as '+', everything except letters, digits and -_. percent-encoded. */
export function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
}

export async function md5(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("MD5", new TextEncoder().encode(text));
  return encodeHex(new Uint8Array(digest));
}

/** Field order PayFast signs a checkout form in (fields not in the list are not signed). */
const CHECKOUT_ORDER = [
  "merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url", "notify_method",
  "name_first", "name_last", "email_address", "cell_number", "m_payment_id", "amount", "item_name",
  "item_description", "custom_int1", "custom_int2", "custom_int3", "custom_int4", "custom_int5",
  "custom_str1", "custom_str2", "custom_str3", "custom_str4", "custom_str5", "email_confirmation",
  "confirmation_address", "currency", "payment_method", "subscription_type", "passphrase", "billing_date",
  "recurring_amount", "frequency", "cycles", "subscription_notify_email", "subscription_notify_webhook",
  "subscription_notify_buyer",
] as const;

/** Signature for the checkout form: known fields in PayFast's order, empty ones left out, passphrase appended. */
export async function checkoutSignature(fields: Record<string, string>, passphrase: string): Promise<string> {
  const parts: string[] = [];
  for (const key of CHECKOUT_ORDER) {
    const v = key === "passphrase" ? passphrase : fields[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") parts.push(`${key}=${phpUrlEncode(String(v).trim())}`);
  }
  return md5(parts.join("&"));
}

/** The posted notice as PayFast signed it: fields in the order received, up to (not including) the signature. */
export function noticeParamString(pairs: [string, string][]): string {
  const out: string[] = [];
  for (const [k, v] of pairs) {
    if (k === "signature") break;
    out.push(`${k}=${phpUrlEncode(v)}`);
  }
  return out.join("&");
}

export async function noticeSignatureOk(pairs: [string, string][], passphrase: string): Promise<boolean> {
  const sent = pairs.find(([k]) => k === "signature")?.[1] ?? "";
  if (!sent) return false;
  const expected = await md5(`${noticeParamString(pairs)}&passphrase=${phpUrlEncode(passphrase)}`);
  return sent.toLowerCase() === expected;
}

/** Ask PayFast itself whether it really sent this notice. */
export async function noticeConfirmedByPayFast(cfg: PayFastConfig, pairs: [string, string][]): Promise<boolean> {
  const res = await fetch(cfg.validateUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: noticeParamString(pairs),
  });
  const text = (await res.text()).trim();
  return res.ok && text === "VALID";
}

/** "2026-11-04T10:15:00+02:00" in South African time (the API wants ISO-8601 with an offset). */
function saTimestamp(): string {
  const now = new Date(Date.now() + 2 * 3600 * 1000);
  return now.toISOString().slice(0, 19) + "+02:00";
}

/** Charge a saved card. Amount in rand; PayFast's API takes cents. */
export async function chargeSavedCard(
  cfg: PayFastConfig,
  token: string,
  amountRand: number,
  itemName: string,
  itemDescription?: string,
): Promise<{ ok: boolean; status: number; message: string; pfPaymentId: string | null; raw: unknown }> {
  const body: Record<string, string | number> = {
    amount: Math.round(amountRand * 100),
    item_name: itemName.slice(0, 100),
  };
  if (itemDescription) body.item_description = itemDescription.slice(0, 255);
  const headers: Record<string, string> = {
    "merchant-id": cfg.merchantId,
    version: "v1",
    timestamp: saTimestamp(),
  };
  // API signature: headers + body, sorted by name, passphrase included, PHP urlencode, MD5.
  const all: Record<string, string> = { ...headers, passphrase: cfg.passphrase };
  for (const [k, v] of Object.entries(body)) all[k] = String(v);
  const sig = await md5(Object.keys(all).sort().map((k) => `${k}=${phpUrlEncode(all[k])}`).join("&"));
  const url = `${cfg.apiBase}/subscriptions/${encodeURIComponent(token)}/adhoc${cfg.mode === "sandbox" ? "?testing=true" : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, signature: sig, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => null) as Record<string, unknown> | null;
  const data = (raw?.data ?? {}) as Record<string, unknown>;
  const ok = res.ok && (data.response === true || String(data.response).toLowerCase() === "true");
  return {
    ok,
    status: res.status,
    message: String(data.message ?? raw?.status ?? `PayFast answered ${res.status}`),
    pfPaymentId: data.pf_payment_id ? String(data.pf_payment_id) : null,
    raw,
  };
}
