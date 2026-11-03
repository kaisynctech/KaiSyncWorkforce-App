// supabase/functions/payfast_itn/index.ts
//
// Receives PayFast's payment notices (ITN) for KaiSync's own subscription billing. Public (PayFast has
// no login), so nothing is believed until all of these pass:
//   1. the signature matches (made with our passphrase, which only PayFast and we know);
//   2. the merchant is us;
//   3. PayFast's own server confirms it sent this exact notice ("VALID");
//   4. it matches a payment we started (m_payment_id) and the amount is what we asked for.
// Then: a saved card is stored (tokenization), or a bill is marked paid and any read-only lock lifted.
// Always answers 200 once handled, so PayFast stops retrying; failures are recorded on the checkout.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { noticeConfirmedByPayFast, noticeSignatureOk, payfastConfig } from "../_shared/payfast.ts";

const ok = (msg = "OK") => new Response(msg, { status: 200 });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const cfg = payfastConfig();
  if (!cfg) return new Response("Not configured", { status: 503 });

  const raw = await req.text();
  const pairs = [...new URLSearchParams(raw).entries()] as [string, string][];
  const f = Object.fromEntries(pairs);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const checkoutId = String(f.m_payment_id ?? "");
  const record = async (status: string | null, note: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(checkoutId)) return;
    const notice = { ...f, signature: undefined, token: f.token ? "(saved)" : undefined, note, at: new Date().toISOString() };
    const patch: Record<string, unknown> = { last_notice: notice };
    if (status) patch.status = status;
    await admin.from("billing_checkouts").update(patch).eq("id", checkoutId);
  };

  // 1–3: is this really PayFast?
  if (!(await noticeSignatureOk(pairs, cfg.passphrase))) { await record(null, "rejected: signature"); return new Response("Bad signature", { status: 400 }); }
  if (String(f.merchant_id ?? "") !== cfg.merchantId) { await record(null, "rejected: merchant"); return new Response("Wrong merchant", { status: 400 }); }
  let confirmed = false;
  try { confirmed = await noticeConfirmedByPayFast(cfg, pairs); } catch { confirmed = false; }
  if (!confirmed) { await record(null, "rejected: PayFast did not confirm"); return new Response("Not confirmed", { status: 400 }); }

  // 4: one of ours, for the right amount?
  const { data: co } = await admin.from("billing_checkouts").select("*").eq("id", checkoutId).maybeSingle();
  if (!co) return ok("Unknown payment (ignored)");
  if (co.status === "complete") return ok("Already handled");
  const gross = Number(f.amount_gross ?? NaN);
  if (!Number.isFinite(gross) || Math.abs(gross - Number(co.amount)) > 0.01) {
    await record("failed", `rejected: amount ${f.amount_gross} expected ${co.amount}`);
    return ok();
  }

  const status = String(f.payment_status ?? "").toUpperCase();
  if (status !== "COMPLETE") {
    await record(status === "CANCELLED" ? "cancelled" : "failed", `payment ${status || "unknown"}`);
    return ok();
  }

  const now = new Date().toISOString();
  if (co.purpose === "add_card") {
    const token = String(f.token ?? "").trim();
    if (!token) { await record("failed", "no card token returned"); return ok(); }
    const { data: who } = await admin.from("employees").select("name, surname")
      .eq("company_id", co.company_id).eq("user_id", co.created_by).maybeSingle();
    await admin.from("billing_payment_methods").update({ status: "replaced", ended_at: now })
      .eq("company_id", co.company_id).eq("status", "active");
    const { error } = await admin.from("billing_payment_methods").insert({
      company_id: co.company_id, provider: "payfast", mode: co.mode, token, status: "active",
      added_by: co.created_by, added_by_name: [who?.name, who?.surname].filter(Boolean).join(" ") || null,
      checkout_id: co.id,
    });
    if (error) { await record("failed", `could not save card: ${error.message}`); return ok(); }
  }

  if (co.purpose === "pay_bill" && co.bill_id) {
    const { data: bill } = await admin.from("billing_bills").update({
      status: "paid", paid_at: now, paid_via: "pay_now", pf_payment_id: f.pf_payment_id ?? null, last_error: null,
    }).eq("id", co.bill_id).eq("status", "open").select("id, company_id, amount, period_start, period_end").maybeSingle();
    if (bill) {
      await admin.from("saas_billing_transactions").insert({
        company_id: bill.company_id, amount: bill.amount, currency: "ZAR", billing_period_start: bill.period_start,
        billing_period_end: bill.period_end, payment_status: "paid", payment_provider: `payfast_${co.mode}`,
        provider_reference: f.pf_payment_id ?? null,
      });
      await admin.rpc("billing_after_payment", { p_company_id: bill.company_id });
    }
  }

  await admin.from("billing_checkouts").update({
    status: "complete", completed_at: now, pf_payment_id: f.pf_payment_id ?? null,
    last_notice: { ...f, signature: undefined, token: f.token ? "(saved)" : undefined, note: "accepted", at: now },
  }).eq("id", co.id);
  return ok();
});
