// supabase/functions/payfast_checkout/index.ts
//
// Starts a trip to PayFast's secure page for KaiSync's own subscription billing:
//   purpose 'add_card'  — save a card (PayFast tokenization) so KaiSync can charge it each month;
//   purpose 'pay_bill'  — pay one open KaiSync bill now ("Pay now"; card, EFT etc. on PayFast).
// The caller must be the company's owner, HR or an admin (checked by billing_overview as the caller).
// Returns the PayFast address and the signed form fields; the browser posts them to PayFast.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, PAYFAST_* (see _shared/payfast.ts)
// Body { company_id, purpose, bill_id?, origin } → { url, fields }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { checkoutSignature, payfastConfig } from "../_shared/payfast.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PRODUCTION = ["https://www.kaisyncworkforce.com", "https://kaisyncworkforce.com", "https://kaisyncwebsite.vercel.app"];
const NOTIFY_URL = "https://vcivtjwreybaxgtdhtou.supabase.co/functions/v1/payfast_itn";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

/** Only our own sites may be the return address after PayFast. */
function allowedOrigin(raw: unknown): string | null {
  let u: URL;
  try { u = new URL(String(raw ?? "")); } catch { return null; }
  if (PRODUCTION.includes(u.origin)) return u.origin;
  if (u.protocol === "https:" && /^kaisyncwebsite-[a-z0-9-]+-kaisynctechs-projects\.vercel\.app$/.test(u.hostname)) return u.origin;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.origin;
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const cfg = payfastConfig();
    if (!cfg) return json({ error: "not_configured", message: "Online payments are not set up yet." }, 503);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Invalid session" }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = String(body.company_id ?? "");
    const purpose = body.purpose === "pay_bill" ? "pay_bill" : body.purpose === "add_card" ? "add_card" : null;
    const origin = allowedOrigin(body.origin);
    if (!companyId || !purpose) return json({ error: "bad_request", message: "Missing details." }, 400);
    if (!origin) return json({ error: "bad_origin", message: "This web address cannot start a payment." }, 400);

    // The database decides who may manage billing (owner, HR, admins).
    const { error: accessErr } = await userClient.rpc("billing_overview", { p_company_id: companyId });
    if (accessErr) return json({ error: "not_allowed", message: "Only the owner, HR or an admin can manage billing." }, 403);

    const { data: company } = await admin.from("companies").select("name").eq("id", companyId).maybeSingle();
    const { data: me } = await admin.from("employees").select("name, surname, email")
      .eq("company_id", companyId).eq("user_id", user.id).maybeSingle();

    let amount = 0;
    let billId: string | null = null;
    let itemName = "KaiSync Workforce — save card for monthly billing";
    if (purpose === "pay_bill") {
      billId = String(body.bill_id ?? "");
      const { data: bill } = await admin.from("billing_bills").select("id, bill_number, amount, status, period_start, period_end")
        .eq("id", billId).eq("company_id", companyId).maybeSingle();
      if (!bill || bill.status !== "open") return json({ error: "no_bill", message: "That bill is already paid or no longer open." }, 400);
      amount = Number(bill.amount);
      itemName = `KaiSync Workforce ${bill.bill_number} (${bill.period_start} to ${bill.period_end})`;
    }

    const { data: checkout, error: coErr } = await admin.from("billing_checkouts").insert({
      company_id: companyId, purpose, bill_id: billId, amount, mode: cfg.mode, created_by: user.id,
    }).select("id").single();
    if (coErr || !checkout) return json({ error: "checkout_failed", message: coErr?.message ?? "Could not start the payment." }, 500);

    const back = `${origin}/dashboard/settings?tab=billing`;
    const fields: Record<string, string> = {
      merchant_id: cfg.merchantId,
      merchant_key: cfg.merchantKey,
      return_url: `${back}&payfast=done&ref=${checkout.id}`,
      cancel_url: `${back}&payfast=cancelled&ref=${checkout.id}`,
      notify_url: NOTIFY_URL,
      name_first: String(me?.name ?? "").slice(0, 100),
      name_last: String(me?.surname ?? "").slice(0, 100),
      email_address: String(me?.email ?? user.email ?? "").slice(0, 100),
      m_payment_id: checkout.id,
      amount: amount.toFixed(2),
      item_name: itemName.slice(0, 100),
      item_description: String(company?.name ?? "").slice(0, 255),
      custom_str1: companyId,
      custom_str2: purpose,
    };
    if (purpose === "add_card") fields.subscription_type = "2"; // tokenization: card saved, charged later by KaiSync
    for (const k of Object.keys(fields)) if (!fields[k]) delete fields[k];
    fields.signature = await checkoutSignature(fields, cfg.passphrase);

    return json({ url: cfg.processUrl, fields, mode: cfg.mode, checkout_id: checkout.id });
  } catch (err) {
    return json({ error: "unexpected", message: err instanceof Error ? err.message : String(err) }, 500);
  }
});
