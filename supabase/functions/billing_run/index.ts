// supabase/functions/billing_run/index.ts
//
// KaiSync's daily billing run. Called once a day by the database (billing_run_kick, pg_cron) with the
// private key from Vault in the x-billing-secret header.
//   1. Trial reminders: 7 days and 1 day before a trial ends, if no card is saved.
//   2. Make this month's bill for every company whose trial has ended (billing_create_due_bills).
//   3. Charge saved cards for open bills (up to 3 tries, 2 days apart).
//   4. Email a "Pay now" link when there is no card or the card failed (day 0, 3 and 6).
//   5. Lock companies more than 7 days late (read-only) and tell them; paying unlocks at once.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFY_FROM_EMAIL, PAYFAST_*

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { chargeSavedCard, payfastConfig } from "../_shared/payfast.ts";

const APP = "https://www.kaisyncworkforce.com";
const BILLING_URL = `${APP}/dashboard/settings?tab=billing`;
const DAY = 24 * 3600 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
const rand = (n: number) => "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todaySA = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
const longDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

type Ctx = { admin: SupabaseClient; resendKey: string; from: string; sent: number; log: string[] };

/** Send one billing email to the company's owners, once per (kind, ref). */
async function notify(ctx: Ctx, companyId: string, kind: string, ref: string, subject: string, paragraphs: string[], button?: { label: string; url: string }) {
  const { error: dupe } = await ctx.admin.from("billing_events").insert({ company_id: companyId, kind, ref, detail: { subject } });
  if (dupe) return; // already sent
  const { data: to } = await ctx.admin.rpc("billing_recipients", { p_company_id: companyId });
  const list = ((to ?? []) as { email: string }[]).map((r) => r.email).filter(Boolean);
  if (!list.length || !ctx.resendKey) { ctx.log.push(`${kind}:${companyId}: no recipient or email not set up`); return; }
  const html = `<!doctype html><html><body style="margin:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="padding:22px 28px;border-bottom:3px solid #1E3A5F;font-size:20px;font-weight:700;color:#0F172A">KaiSync Workforce</td></tr>
<tr><td style="padding:24px 28px;color:#0F172A;font-size:14px;line-height:1.6">
${paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join("")}
${button ? `<p style="margin:16px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#1E3A5F;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${esc(button.label)}</a></p>` : ""}
<p style="margin:16px 0 0;color:#64748B;font-size:12px">Questions about your bill? Reply to this email.</p>
</td></tr></table></td></tr></table></body></html>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: ctx.from, to: list, subject, html, text: paragraphs.map((p) => p.replace(/<[^>]+>/g, "")).join("\n\n") + (button ? `\n\n${button.label}: ${button.url}` : "") }),
  });
  if (res.ok) ctx.sent++; else ctx.log.push(`${kind}:${companyId}: email failed ${res.status}`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: okKey } = await admin.rpc("billing_run_secret_ok", { p_secret: req.headers.get("x-billing-secret") ?? "" });
  if (okKey !== true) return json({ error: "Not allowed" }, 401);
  const cfg = payfastConfig();
  if (!cfg) return json({ error: "PayFast is not set up" }, 503);

  const ctx: Ctx = {
    admin, sent: 0, log: [],
    resendKey: (Deno.env.get("RESEND_API_KEY") ?? "").trim(),
    from: (Deno.env.get("NOTIFY_FROM_EMAIL") ?? "").trim() || "KaiSync <no-reply@kaisyncworkforce.com>",
  };
  const today = todaySA();
  const out = { trial_reminders: 0, bills_made: 0, charged: 0, charge_failed: 0, pay_now_emails: 0, locked: 0 };

  // 1. Trial reminders.
  const { data: trials } = await admin.from("saas_company_subscriptions").select("company_id, trial_ends_at, companies!inner(name, billing_enabled)")
    .eq("subscription_status", "trialing").not("trial_ends_at", "is", null);
  for (const t of (trials ?? []) as { company_id: string; trial_ends_at: string; companies: { name: string; billing_enabled: boolean } }[]) {
    if (!t.companies?.billing_enabled) continue;
    const daysLeft = Math.ceil((new Date(t.trial_ends_at).getTime() - Date.now()) / DAY);
    if (daysLeft !== 7 && daysLeft !== 1) continue;
    const { data: card } = await admin.from("billing_payment_methods").select("id").eq("company_id", t.company_id).eq("status", "active").maybeSingle();
    if (card) continue;
    await notify(ctx, t.company_id, `trial_${daysLeft}d`, t.trial_ends_at.slice(0, 10),
      daysLeft === 1 ? "Your KaiSync free trial ends tomorrow" : "Your KaiSync free trial ends in 7 days",
      [`Hello,`, `The free trial for <strong>${esc(t.companies.name)}</strong> ends on ${longDate(t.trial_ends_at.slice(0, 10))}.`,
       `To keep using KaiSync without interruption, add a card for the monthly subscription. Your card is kept by PayFast, not by KaiSync.`],
      { label: "Add a card", url: BILLING_URL });
    out.trial_reminders++;
  }

  // 2. This month's bills.
  const { data: made } = await admin.rpc("billing_create_due_bills", { p_mode: cfg.mode });
  out.bills_made = Number(made ?? 0);

  // 3 + 4. Charge saved cards; otherwise send "Pay now".
  const { data: open } = await admin.from("billing_bills").select("id, company_id, bill_number, amount, period_start, period_end, due_date, charge_attempts, last_attempt_at, mode, companies!inner(name)")
    .eq("status", "open").lte("due_date", today);
  for (const b of (open ?? []) as Record<string, any>[]) {
    const { data: card } = await admin.from("billing_payment_methods").select("token, mode").eq("company_id", b.company_id).eq("status", "active").maybeSingle();
    const canTry = card && card.mode === cfg.mode && b.charge_attempts < 3 &&
      (!b.last_attempt_at || Date.now() - new Date(b.last_attempt_at).getTime() > 2 * DAY - 3600 * 1000);
    if (canTry) {
      const r = await chargeSavedCard(cfg, card!.token, Number(b.amount), `KaiSync Workforce ${b.bill_number}`, `${b.period_start} to ${b.period_end}`);
      if (r.ok) {
        const now = new Date().toISOString();
        await admin.from("billing_bills").update({ status: "paid", paid_at: now, paid_via: "saved_card", pf_payment_id: r.pfPaymentId,
          charge_attempts: b.charge_attempts + 1, last_attempt_at: now, last_error: null }).eq("id", b.id).eq("status", "open");
        await admin.from("saas_billing_transactions").insert({ company_id: b.company_id, amount: b.amount, currency: "ZAR",
          billing_period_start: b.period_start, billing_period_end: b.period_end, payment_status: "paid",
          payment_provider: `payfast_${cfg.mode}`, provider_reference: r.pfPaymentId });
        await admin.rpc("billing_after_payment", { p_company_id: b.company_id });
        await notify(ctx, b.company_id, "receipt", b.id, `Payment received — KaiSync ${b.bill_number}`,
          [`Hello,`, `Thank you. We charged ${rand(Number(b.amount))} to the card on file for <strong>${esc(b.companies.name)}</strong> (${b.bill_number}, ${longDate(b.period_start)} to ${longDate(b.period_end)}).`],
          { label: "View your bills", url: BILLING_URL });
        out.charged++;
        continue;
      }
      await admin.from("billing_bills").update({ charge_attempts: b.charge_attempts + 1, last_attempt_at: new Date().toISOString(),
        last_error: r.message.slice(0, 300) }).eq("id", b.id);
      out.charge_failed++;
      ctx.log.push(`charge ${b.bill_number}: ${r.status} ${r.message}`);
    }
    // No card, or the card did not go through: "Pay now" on the day it is due, then day 3 and day 6.
    const daysLate = Math.floor((new Date(today).getTime() - new Date(b.due_date).getTime()) / DAY);
    const step = daysLate >= 6 ? 6 : daysLate >= 3 ? 3 : 0;
    const lockOn = new Date(new Date(b.due_date).getTime() + 7 * DAY).toISOString().slice(0, 10);
    await notify(ctx, b.company_id, `pay_now_d${step}`, b.id,
      step === 0 ? `Your KaiSync bill ${b.bill_number} is due` : `Reminder: KaiSync bill ${b.bill_number} is unpaid`,
      [`Hello,`, `The KaiSync subscription for <strong>${esc(b.companies.name)}</strong> is ${rand(Number(b.amount))} for ${longDate(b.period_start)} to ${longDate(b.period_end)}.`,
       card ? `We could not charge the card on file. Please pay now, or add another card.` : `There is no card on file, so please pay now. You can also save a card so this happens automatically.`,
       `If it is still unpaid on ${longDate(lockOn)}, the account becomes read-only until it is paid. Nothing is ever deleted.`],
      { label: "Pay now", url: BILLING_URL });
    out.pay_now_emails++;
  }

  // 5. Lock companies more than 7 days late.
  const { data: locked } = await admin.rpc("billing_lock_overdue");
  for (const companyId of ((locked ?? []) as string[])) {
    await notify(ctx, companyId, "locked", today, "Your KaiSync account is now read-only",
      [`Hello,`, `Your KaiSync subscription is more than 7 days overdue, so the account is now read-only: everyone can still see everything, but nothing new can be added or changed.`,
       `As soon as the bill is paid, the account opens again automatically. Nothing has been deleted.`],
      { label: "Pay now", url: BILLING_URL });
    out.locked++;
  }

  return json({ ok: true, mode: cfg.mode, ...out, emails_sent: ctx.sent, notes: ctx.log });
});
