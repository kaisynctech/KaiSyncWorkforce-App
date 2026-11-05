// supabase/functions/money_daily/index.ts
//
// Once a day (pg_cron → money_daily_kick, key from Vault in x-money-secret):
//   1. Recurring invoices that are due: create this period's invoice; email it when the office chose
//      "send automatically" (with the client's private View & pay link).
//   2. Automatic reminders: for companies that switched them on, email each client with overdue invoices
//      (past due by the company's chosen days, not reminded within the chosen gap, client not opted out).
// Body (optional, for a test run): { company_id, site_url }.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFY_FROM_EMAIL, PUBLIC_SITE_URL (optional)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const valid = (e: unknown) => { const v = String(e ?? "").trim(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : ""; };
const rand = (n: unknown) => "R " + Number(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: unknown) => {
  const s = String(d ?? "").slice(0, 10);
  return s ? new Date(`${s}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
};
const b = (s: string) => `<strong>${esc(s)}</strong>`;
const SITE_OK = /^https:\/\/((www\.)?kaisyncworkforce\.com|kaisyncwebsite-[a-z0-9-]+-kaisynctechs-projects\.vercel\.app)$/;
const newToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const todaySA = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);

type Company = { id: string; name: string | null; legal_name: string | null; contact_phone: string | null; contact_email: string | null;
  website: string | null; brand_logo_path: string | null; document_footer: string | null;
  auto_reminder_after_days?: number; auto_reminder_every_days?: number };

async function link(admin: SupabaseClient, companyId: string, invoiceId: string, site: string): Promise<string> {
  const { data: existing } = await admin.from("document_links").select("token")
    .eq("doc_id", invoiceId).eq("kind", "invoice").gt("expires_at", new Date(Date.now() + 30 * 86400000).toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  let token = existing?.token as string | undefined;
  if (!token) {
    token = newToken();
    await admin.from("document_links").insert({ token, company_id: companyId, kind: "invoice", doc_id: invoiceId });
  }
  return `${site}/d/${token}`;
}

function emailHtml(admin: SupabaseClient, co: Company, paras: string[]): string {
  const name = String(co.name ?? "").trim() || "Our company";
  const logoUrl = co.brand_logo_path ? admin.storage.from("company-branding").getPublicUrl(co.brand_logo_path).data.publicUrl : null;
  const head = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(name)}" style="max-height:56px;max-width:220px;display:block">`
    : `<div style="font-size:20px;font-weight:700;color:#0F172A">${esc(name)}</div>`;
  const contacts = [co.contact_phone, co.contact_email, co.website].filter(Boolean).map(esc).join(" &middot; ");
  return `<!doctype html><html><body style="margin:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="padding:24px 28px;border-bottom:3px solid #1E3A5F">${head}</td></tr>
<tr><td style="padding:24px 28px;color:#0F172A;font-size:14px;line-height:1.6">
${paras.map((p) => p.startsWith("<table") ? p : `<p style="margin:0 0 12px">${p}</p>`).join("")}
<p style="margin:16px 0 0">Kind regards,<br><strong>${esc(name)}</strong></p>
</td></tr>
<tr><td style="padding:16px 28px;background:#F8FAFC;color:#64748B;font-size:12px;line-height:1.6">
${co.legal_name && co.legal_name !== name ? `<div>${esc(co.legal_name)}</div>` : ""}${contacts ? `<div>${contacts}</div>` : ""}
${co.document_footer ? `<div style="margin-top:8px">${esc(co.document_footer)}</div>` : ""}
</td></tr></table>
</td></tr></table></body></html>`;
}
const toText = (paras: string[], name: string) =>
  paras.map((p) => p.replace(/<\/tr>/g, "\n").replace(/<br>/g, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim())
    .join("\n\n") + `\n\nKind regards,\n${name}`;
const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#1E3A5F;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">${esc(label)}</a>`;

async function send(resendKey: string, fromAddress: string, co: Company, to: string, subject: string, html: string, text: string) {
  const name = String(co.name ?? "").trim() || "Our company";
  const replyTo = valid(co.contact_email);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `"${name.replace(/["<>\r\n]/g, "").slice(0, 80)}" <${fromAddress}>`,
      to: [to], ...(replyTo ? { reply_to: replyTo } : {}), subject, html, text,
    }),
  });
  const out = await res.json().catch(() => ({})) as { id?: string; message?: string };
  return { ok: res.ok, id: out.id ?? null, error: res.ok ? null : (out.message ?? `Resend ${res.status}`) };
}

const CO_COLS = "id, name, legal_name, contact_phone, contact_email, website, brand_logo_path, document_footer, auto_reminder_after_days, auto_reminder_every_days";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: ok } = await admin.rpc("money_daily_secret_ok", { p_secret: req.headers.get("x-money-secret") ?? "" });
  if (ok !== true) return json({ error: "Not allowed" }, 401);

  const opts = (await req.json().catch(() => ({}))) as { company_id?: string; site_url?: string };
  const onlyCompany = /^[0-9a-f-]{36}$/i.test(String(opts.company_id ?? "")) ? String(opts.company_id) : null;
  const siteRaw = String(opts.site_url ?? Deno.env.get("PUBLIC_SITE_URL") ?? "").trim().replace(/\/+$/, "");
  const site = SITE_OK.test(siteRaw) ? siteRaw : "https://www.kaisyncworkforce.com";
  const resendKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  const fromEnv = (Deno.env.get("NOTIFY_FROM_EMAIL") ?? "").trim() || "no-reply@kaisyncworkforce.com";
  const fromAddress = (fromEnv.match(/<([^>]+)>/)?.[1] ?? fromEnv).trim();
  const today = todaySA();
  const out = { recurring_created: 0, recurring_emailed: 0, recurring_failed: 0, reminders_sent: 0, reminders_failed: 0, reminders_skipped: 0, errors: [] as string[] };
  const companies = new Map<string, Company>();
  const companyRow = async (id: string) => {
    if (!companies.has(id)) {
      const { data } = await admin.from("companies").select(CO_COLS).eq("id", id).maybeSingle();
      if (data) companies.set(id, data as Company);
    }
    return companies.get(id) ?? null;
  };

  // ── 1. Recurring invoices ──────────────────────────────────────────────────
  let rq = admin.from("recurring_invoices").select("id, company_id, client_id, title, auto_send").eq("active", true).lte("next_run", today);
  if (onlyCompany) rq = rq.eq("company_id", onlyCompany);
  const { data: due } = await rq.limit(500);
  for (const r of due ?? []) {
    const { data: writable } = await admin.rpc("company_writable", { p_company_id: r.company_id });
    if (writable === false) continue; // read-only company: nothing new is created
    const { data: invId, error } = await admin.rpc("_recurring_generate", { p_id: r.id });
    if (error || !invId) {
      out.recurring_failed++;
      await admin.from("recurring_invoices").update({ last_error: error?.message ?? "Could not create the invoice." }).eq("id", r.id);
      continue;
    }
    out.recurring_created++;
    if (!r.auto_send || !resendKey) continue;
    const { data: inv } = await admin.from("finance_invoices")
      .select("id, company_id, invoice_number, total_amount, due_date, client:clients(name, contact_person, email)").eq("id", invId).maybeSingle();
    const client = (inv?.client ?? {}) as { name?: string; contact_person?: string; email?: string };
    const to = valid(client.email);
    const co = await companyRow(r.company_id);
    if (!inv || !co || !to) continue;
    const url = await link(admin, r.company_id, inv.id, site);
    const num = String(inv.invoice_number ?? "");
    const paras = [
      client.contact_person ? `Hello ${esc(client.contact_person)},` : "Hello,",
      `Here is your invoice ${b(num)} for ${b(rand(inv.total_amount))}${r.title ? ` (${esc(r.title)})` : ""}.`,
      `It is payable by ${b(day(inv.due_date))}. Please use ${b(num)} as your payment reference.`,
      `${button(url, "View & pay online")}<br><span style="font-size:12px;color:#64748B">See the invoice, download the PDF, our banking details, and send us your proof of payment.</span>`,
      "If you have any questions, simply reply to this email.",
    ];
    const subject = `Invoice ${num} from ${String(co.name ?? "").trim() || "us"}`;
    const sent = await send(resendKey, fromAddress, co, to, subject, emailHtml(admin, co, paras), toText(paras, String(co.name ?? "")) + `\n\nView and pay online: ${url}`);
    await admin.from("document_emails").insert({
      company_id: r.company_id, kind: "invoice", doc_id: inv.id, recipient_email: to, subject,
      status: sent.ok ? "sent" : "failed", error_message: sent.error, provider_message_id: sent.id, sent_by: null,
    });
    if (sent.ok) out.recurring_emailed++; else out.errors.push(`recurring ${r.id}: ${sent.error}`);
  }

  // ── 2. Automatic reminders ─────────────────────────────────────────────────
  if (resendKey) {
    let cq = admin.from("companies").select(CO_COLS).eq("auto_reminders_enabled", true);
    if (onlyCompany) cq = cq.eq("id", onlyCompany);
    const { data: cos } = await cq;
    for (const co of (cos ?? []) as Company[]) {
      const after = Math.max(0, Number(co.auto_reminder_after_days ?? 3));
      const every = Math.max(3, Number(co.auto_reminder_every_days ?? 7));
      const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - after * 86400000).toISOString().slice(0, 10);
      const { data: overdue } = await admin.from("finance_invoices")
        .select("id, client_id, invoice_number, due_date, balance_due")
        .eq("company_id", co.id).in("status", ["sent", "partially_paid", "overdue"]).gt("balance_due", 0.004)
        .lte("due_date", cutoff).order("due_date");
      const byClient = new Map<string, typeof overdue>();
      for (const i of overdue ?? []) {
        if (!i.client_id) continue;
        byClient.set(i.client_id, [...(byClient.get(i.client_id) ?? []), i]);
      }
      for (const [clientId, invs] of byClient) {
        const { data: client } = await admin.from("clients").select("id, name, contact_person, email, auto_reminders_off").eq("id", clientId).maybeSingle();
        const to = valid(client?.email);
        if (!client || client.auto_reminders_off || !to) { out.reminders_skipped++; continue; }
        const since = new Date(Date.now() - every * 86400000).toISOString();
        const { count } = await admin.from("statement_reminders").select("id", { count: "exact", head: true })
          .eq("client_id", clientId).eq("status", "sent").gte("created_at", since);
        if ((count ?? 0) > 0) { out.reminders_skipped++; continue; }
        const total = (invs ?? []).reduce((s, i) => s + Number(i.balance_due ?? 0), 0);
        const rows: string[] = [];
        for (const i of invs ?? []) {
          const url = await link(admin, co.id, i.id, site);
          rows.push(`<tr><td style="padding:8px 6px;border-bottom:1px solid #E2E8F0">${esc(i.invoice_number ?? "")}</td>
<td style="padding:8px 6px;border-bottom:1px solid #E2E8F0">${esc(day(i.due_date))}</td>
<td style="padding:8px 6px;border-bottom:1px solid #E2E8F0;text-align:right">${esc(rand(i.balance_due))}</td>
<td style="padding:8px 6px;border-bottom:1px solid #E2E8F0;text-align:right"><a href="${esc(url)}" style="color:#1E3A5F;font-weight:bold">View &amp; pay</a></td></tr>`);
        }
        const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin:4px 0 16px;border-collapse:collapse">
<tr style="color:#64748B;font-size:12px"><td style="padding:6px">Invoice</td><td style="padding:6px">Was due</td><td style="padding:6px;text-align:right">Owing</td><td></td></tr>
${rows.join("")}
<tr><td colspan="2" style="padding:8px 6px;font-weight:bold">Total overdue</td><td style="padding:8px 6px;text-align:right;font-weight:bold">${esc(rand(total))}</td><td></td></tr></table>`;
        const paras = [
          client.contact_person ? `Hello ${esc(client.contact_person)},` : "Hello,",
          `A friendly reminder that ${invs!.length === 1 ? "this invoice is" : "these invoices are"} now overdue:`,
          table,
          "We would appreciate payment at your earliest convenience. If you have already paid, please ignore this note or reply with your proof of payment.",
        ];
        const subject = `Payment reminder — ${rand(total)} overdue`;
        const sent = await send(resendKey, fromAddress, co, to, subject, emailHtml(admin, co, paras), toText(paras, String(co.name ?? "")));
        await admin.from("statement_reminders").insert({
          company_id: co.id, client_id: clientId, sent_by: null, recipient_email: to, balance: total, overdue: total,
          status: sent.ok ? "sent" : "failed", error_message: sent.error, provider_message_id: sent.id, automatic: true,
        });
        if (sent.ok) out.reminders_sent++; else { out.reminders_failed++; out.errors.push(`reminder ${clientId}: ${sent.error}`); }
      }
    }
  }
  return json(out);
});
