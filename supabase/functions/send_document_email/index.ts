// supabase/functions/send_document_email/index.ts
//
// Emails a document: invoice, credit note, payment receipt, purchase order, RFQ (one supplier per email),
// or remittance advice (supplier bill / contractor payout paid). Invoices, credit notes, purchase orders and
// RFQs come from the person who sends them (replies go to them); receipts and remittance advice come from
// the company (replies go to the company email) — see _shared/sender.ts. Optional CC (up to 10).
// Body { preview: true } returns the email (subject, editable message text, HTML) without sending; an edited
// { subject, body_text } replaces the standard wording (see _shared/compose.ts).
// The PDF (when there is one) is built in the browser and attached. Amounts in the email are read from the database, never trusted
// from the browser. Office staff only (any active role except employee). Logged in document_emails.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFY_FROM_EMAIL (optional)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { cleanCc, senderFor, signOffHtml, signOffText, type SendMode } from "../_shared/sender.ts";
import { editedSubject, editedText, htmlToText, textToParas } from "../_shared/compose.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const valid = (e: unknown) => { const v = String(e ?? "").trim(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : ""; };
// Rand prints as "R"; other currencies as their code ("USD 1 250,00").
const rand = (n: unknown, cur?: string | null) => `${!cur || cur.toUpperCase() === "ZAR" ? "R" : cur.toUpperCase()} ` + Number(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: unknown) => {
  const s = String(d ?? "").slice(0, 10);
  return s ? new Date(`${s}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
};
const b = (s: string) => `<strong>${esc(s)}</strong>`;

// Links in emails point at the site the office used (test site or live), never anywhere else.
const SITE_OK = /^https:\/\/((www\.)?kaisyncworkforce\.com|kaisyncwebsite-[a-z0-9-]+-kaisynctechs-projects\.vercel\.app)$/;
// No site given (an older app) → no link, so nobody gets a link to a page that isn't there yet.
const siteUrl = (v: unknown): string | null => { const u = String(v ?? "").trim().replace(/\/+$/, ""); return SITE_OK.test(u) ? u : null; };
const newToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The client's private online link for this document (reused while it has more than 30 days left). */
async function documentLink(admin: SupabaseClient, companyId: string, kind: "invoice" | "quote", docId: string, site: string): Promise<string> {
  const { data: existing } = await admin.from("document_links").select("token")
    .eq("doc_id", docId).eq("kind", kind).gt("expires_at", new Date(Date.now() + 30 * 86400000).toISOString())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  let token = existing?.token as string | undefined;
  if (!token) {
    token = newToken();
    await admin.from("document_links").insert({ token, company_id: companyId, kind, doc_id: docId });
  }
  return `${site}/d/${token}`;
}
const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#1E3A5F;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">${esc(label)}</a>`;

type Kind = "invoice" | "credit_note" | "receipt" | "purchase_order" | "rfq" | "remittance_supplier" | "remittance_contractor";
const KINDS: Kind[] = ["invoice", "credit_note", "receipt", "purchase_order", "rfq", "remittance_supplier", "remittance_contractor"];
const MODE: Record<Kind, SendMode> = {
  invoice: "personal", credit_note: "personal", purchase_order: "personal", rfq: "personal",
  receipt: "company", remittance_supplier: "company", remittance_contractor: "company",
};
const NEEDS_PDF: Kind[] = ["invoice", "credit_note", "purchase_order"];

type Built = {
  companyId: string; to: string; greetName: string | null; subject: (company: string) => string;
  paras: string[]; // already HTML-escaped
  afterSent?: () => Promise<void>;
  fixedAfter?: string[]; // HTML shown after the message and never edited (e.g. the RFQ items table)
} | { error: string; status: number };

async function build(admin: SupabaseClient, kind: Kind, id: string, preview = false): Promise<Built> {
  if (kind === "invoice" || kind === "receipt") {
    const { data: inv } = await admin.from("finance_invoices")
      .select("id, company_id, invoice_number, status, currency, total_amount, amount_paid, balance_due, due_date, client:clients(name, contact_person, email)")
      .eq("id", id).maybeSingle();
    if (!inv) return { error: "Invoice not found.", status: 404 };
    const c = (inv.client ?? {}) as { name?: string; contact_person?: string; email?: string };
    const num = String(inv.invoice_number ?? "") || (preview ? "(number given when sent)" : "");
    if (kind === "invoice") {
      // A draft can be previewed (the office opens the email first); it is marked sent and numbered just before sending.
      if (["voided", "cancelled"].includes(String(inv.status)) || (inv.status === "draft" && !preview)) return { error: "Only sent invoices can be emailed.", status: 409 };
      const bal = Number(inv.balance_due ?? 0);
      return {
        companyId: inv.company_id, to: valid(c.email), greetName: c.contact_person || null,
        subject: (co) => `Invoice ${num} from ${co}`,
        paras: [
          `Please find attached invoice ${b(num)} for ${b(rand(inv.total_amount, inv.currency))}.`,
          bal > 0.004
            ? `The amount due is ${b(rand(bal, inv.currency))}${inv.due_date ? `, payable by ${b(day(inv.due_date))}` : ""}. Please use ${b(num)} as your payment reference.`
            : "This invoice has already been paid in full. Thank you!",
        ],
      };
    }
    const { data: tx } = await admin.from("finance_transactions")
      .select("amount, transaction_date, created_at, receipt_number")
      .eq("source_table", "finance_invoices").eq("source_id", id).eq("direction", "incoming")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!tx) return { error: "No payment has been recorded on this invoice yet.", status: 409 };
    const bal = Number(inv.balance_due ?? 0);
    return {
      companyId: inv.company_id, to: valid(c.email), greetName: c.contact_person || null,
      subject: (co) => `Receipt${tx.receipt_number ? ` ${tx.receipt_number}` : ""} — payment received, thank you (${num})`,
      paras: [
        `Thank you — we received your payment of ${b(rand(tx.amount, inv.currency))} on ${b(day(tx.transaction_date ?? tx.created_at))} for invoice ${b(num)}.`,
        ...(tx.receipt_number ? [`Your receipt number is ${b(String(tx.receipt_number))}.`] : []),
        bal > 0.004 ? `The balance still owing on this invoice is ${b(rand(bal, inv.currency))}.` : "This invoice is now paid in full.",
      ],
    };
  }
  if (kind === "credit_note") {
    const { data: cn } = await admin.from("credit_notes")
      .select("id, company_id, credit_note_number, status, currency, total_amount, invoice:finance_invoices(invoice_number), client:clients(name, contact_person, email)")
      .eq("id", id).maybeSingle();
    if (!cn) return { error: "Credit note not found.", status: 404 };
    if (String(cn.status) === "voided") return { error: "This credit note was voided.", status: 409 };
    const c = (cn.client ?? {}) as { contact_person?: string; email?: string };
    const invNum = (cn.invoice as { invoice_number?: string } | null)?.invoice_number;
    const num = String(cn.credit_note_number ?? "");
    return {
      companyId: cn.company_id, to: valid(c.email), greetName: c.contact_person || null,
      subject: (co) => `Credit note${num ? ` ${num}` : ""} from ${co}`,
      paras: [`Please find attached credit note${num ? ` ${b(num)}` : ""} for ${b(rand(cn.total_amount, cn.currency))}${invNum ? ` against invoice ${b(invNum)}` : ""}.`],
    };
  }
  if (kind === "purchase_order") {
    const { data: po } = await admin.from("purchase_orders")
      .select("id, company_id, po_number, status, currency, total_amount, required_delivery_date, delivery_address, supplier:contractors!purchase_orders_supplier_id_fkey(name, contact_person, email)")
      .eq("id", id).maybeSingle();
    if (!po) return { error: "Purchase order not found.", status: 404 };
    if (["draft", "cancelled", "rejected"].includes(String(po.status))) return { error: "Approve the purchase order before emailing it.", status: 409 };
    const s = (po.supplier ?? {}) as { contact_person?: string; email?: string };
    const num = String(po.po_number ?? "");
    const paras = [`Please find attached our purchase order ${b(num)} for ${b(rand(po.total_amount, po.currency))}.`];
    if (po.required_delivery_date) paras.push(`We need delivery by ${b(day(po.required_delivery_date))}.`);
    if (po.delivery_address) paras.push(`Deliver to: ${esc(po.delivery_address).replace(/\n/g, "<br>")}`);
    paras.push(`Please quote ${b(num)} on your invoice.`);
    return { companyId: po.company_id, to: valid(s.email), greetName: s.contact_person || null, subject: (co) => `Purchase order ${num} from ${co}`, paras };
  }
  if (kind === "rfq") {
    // doc_id is the rfq_recipients row: each supplier gets its own email, so they don't see each other.
    const { data: r } = await admin.from("rfq_recipients")
      .select("id, company_id, rfq_id, status, supplier:contractors(name, contact_person, email)")
      .eq("id", id).maybeSingle();
    if (!r) return { error: "Supplier not found on this RFQ.", status: 404 };
    const { data: rfq } = await admin.from("rfqs")
      .select("id, rfq_number, title, status, description, delivery_address, required_by_date, response_deadline")
      .eq("id", r.rfq_id).maybeSingle();
    if (!rfq) return { error: "RFQ not found.", status: 404 };
    if (["cancelled", "closed"].includes(String(rfq.status))) return { error: "This RFQ is closed.", status: 409 };
    const { data: lines } = await admin.from("rfq_lines").select("description, quantity, unit, specifications")
      .eq("rfq_id", rfq.id).order("sort_order");
    const items = (lines ?? []).filter((l) => String(l.description ?? "").trim());
    if (!items.length) return { error: "Add at least one item to the RFQ first.", status: 409 };
    const s = (r.supplier ?? {}) as { name?: string; contact_person?: string; email?: string };
    const num = String(rfq.rfq_number ?? "");
    const cell = "padding:6px 8px;border-bottom:1px solid #E2E8F0;vertical-align:top";
    const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px">
<tr style="background:#F1F5F9"><td style="${cell};font-weight:bold">Item</td><td style="${cell};font-weight:bold;text-align:right">Qty</td><td style="${cell};font-weight:bold">Unit</td></tr>
${items.map((l) => `<tr><td style="${cell}">${esc(l.description)}${l.specifications ? `<br><span style="color:#64748B;font-size:12px">${esc(l.specifications)}</span>` : ""}</td><td style="${cell};text-align:right">${esc(Number(l.quantity ?? 0).toLocaleString("en-ZA"))}</td><td style="${cell}">${esc(l.unit ?? "")}</td></tr>`).join("")}
</table>`;
    const paras = [`Please send us your best price for the items listed below${num ? `, quoting our reference ${b(num)}` : ""}.`];
    if (rfq.title) paras.push(`${b(String(rfq.title))}${rfq.description ? `<br>${esc(rfq.description).replace(/\n/g, "<br>")}` : ""}`);
    if (rfq.required_by_date) paras.push(`We need it by ${b(day(rfq.required_by_date))}.`);
    if (rfq.delivery_address) paras.push(`Delivery to: ${esc(rfq.delivery_address).replace(/\n/g, "<br>")}`);
    if (rfq.response_deadline) paras.push(`Please reply with your quote by ${b(day(rfq.response_deadline))}, including delivery time and how long your price is valid.`);
    else paras.push("Please include your delivery time and how long your price is valid.");
    return {
      companyId: r.company_id, to: valid(s.email), greetName: s.contact_person || s.name || null,
      subject: (co) => `Request for quotation${num ? ` ${num}` : ""}${rfq.title ? ` — ${String(rfq.title).slice(0, 80)}` : ""} (${co})`,
      paras,
      fixedAfter: [table],
      afterSent: async () => {
        const now = new Date().toISOString();
        await admin.from("rfq_recipients").update({ status: "sent", sent_at: now }).eq("id", r.id).eq("status", "pending");
        await admin.from("rfqs").update({ status: "sent", updated_at: now }).eq("id", rfq.id).eq("status", "draft");
      },
    };
  }
  if (kind === "remittance_supplier") {
    const { data: si } = await admin.from("supplier_invoices")
      .select("id, company_id, invoice_number, bill_number, remittance_number, status, currency, amount_paid, paid_at, supplier:contractors!supplier_invoices_supplier_id_fkey(name, contact_person, email)")
      .eq("id", id).maybeSingle();
    if (!si) return { error: "Bill not found.", status: 404 };
    if (!(Number(si.amount_paid ?? 0) > 0)) return { error: "Record the payment before sending remittance advice.", status: 409 };
    const s = (si.supplier ?? {}) as { contact_person?: string; email?: string };
    const num = si.invoice_number ? String(si.invoice_number) : "";
    return {
      companyId: si.company_id, to: valid(s.email), greetName: s.contact_person || null,
      subject: (co) => `Remittance advice${si.remittance_number ? ` ${si.remittance_number}` : ""} from ${co}${num ? ` — your invoice ${num}` : ""}`,
      paras: [
        `We've paid ${b(rand(si.amount_paid, si.currency))}${num ? ` for your invoice ${b(num)}` : ""}${si.paid_at ? ` on ${b(day(si.paid_at))}` : ""}.`,
        ...(si.remittance_number ? [`Payment reference: ${b(String(si.remittance_number))}${si.bill_number ? ` (our ref ${esc(si.bill_number)})` : ""}.`] : []),
        "Please allow a day or two for it to reflect in your account, depending on your bank.",
      ],
    };
  }
  // remittance_contractor
  const { data: p } = await admin.from("contractor_payouts")
    .select("id, company_id, payout_status, remittance_number, total_amount, retention_amount, paid_at, payout_date, job:jobs(job_code, title), contractor:contractors(name, contact_person, email)")
    .eq("id", id).maybeSingle();
  if (!p) return { error: "Payout not found.", status: 404 };
  if (p.payout_status !== "paid") return { error: "Mark the payout as paid before sending remittance advice.", status: 409 };
  const c = (p.contractor ?? {}) as { name?: string; contact_person?: string; email?: string };
  const job = (p.job ?? {}) as { job_code?: string; title?: string };
  const net = Number(p.total_amount ?? 0) - Number(p.retention_amount ?? 0);
  const jobText = [job.job_code, job.title].filter(Boolean).join(" — ");
  const paras = [`We've paid ${b(rand(net))}${jobText ? ` for ${b(jobText)}` : ""}${p.paid_at || p.payout_date ? ` on ${b(day(p.paid_at ?? p.payout_date))}` : ""}.`];
  if (p.remittance_number) paras.push(`Payment reference: ${b(String(p.remittance_number))}.`);
  if (Number(p.retention_amount ?? 0) > 0) paras.push(`${b(rand(p.retention_amount))} is held back as retention, as agreed.`);
  paras.push("Please allow a day or two for it to reflect in your account, depending on your bank.");
  return { companyId: p.company_id, to: valid(c.email), greetName: c.contact_person || c.name || null, subject: (co) => `Remittance advice${p.remittance_number ? ` ${p.remittance_number}` : ""} from ${co}`, paras };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing Authorization" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Invalid session" }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      kind?: string; doc_id?: string; recipient_email?: string; cc?: unknown; message?: string; pdf_base64?: string; filename?: string; site_url?: string;
      preview?: boolean; subject?: string; body_text?: string;
    };
    const preview = body.preview === true;
    const kind = String(body.kind ?? "") as Kind;
    if (!KINDS.includes(kind)) return json({ error: "kind required" }, 400);
    const docId = String(body.doc_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(docId)) return json({ error: "doc_id required" }, 400);
    const pdf = String(body.pdf_base64 ?? "").replace(/^data:application\/pdf;base64,/, "").trim();
    if (NEEDS_PDF.includes(kind) && !pdf && !preview) return json({ error: "pdf_base64 required" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const built = await build(admin, kind, docId, preview);
    if ("error" in built) return json({ error: "not_ready", message: built.error }, built.status);

    // Permission: office staff of this document's company.
    const { data: role } = await userClient.rpc("get_my_role", { p_company_id: built.companyId });
    if (!role || role === "employee") return json({ error: "not_allowed", message: "You don't have permission to email this." }, 403);

    const recipient = valid(body.recipient_email) || built.to;
    if (!recipient && !preview) return json({ error: "no_email", message: "Enter an email address to send it to." }, 400);

    const cc = cleanCc(body.cc, recipient);

    const resendKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
    if (!resendKey) return json({ error: "email_not_configured", message: "Email sending is not set up." }, 503);

    const { data: co } = await admin.from("companies")
      .select("name, legal_name, contact_phone, contact_email, website, brand_logo_path, document_footer")
      .eq("id", built.companyId).maybeSingle();
    const companyName = String(co?.name ?? "").trim() || "Our company";
    const sender = await senderFor(admin, { companyId: built.companyId, companyName, companyEmail: co?.contact_email ?? null, user,
      // The previous app (no cc field) keeps the company sender until the new release is live.
      mode: Array.isArray(body.cc) ? MODE[kind] : "company" });
    const logoUrl = co?.brand_logo_path ? admin.storage.from("company-branding").getPublicUrl(co.brand_logo_path).data.publicUrl : null;
    const note = String(body.message ?? "").trim().slice(0, 1500);
    // Invoices carry a private link: view online, download the PDF, see the banking details, send proof of payment.
    const site = siteUrl(body.site_url);
    // A preview shows where the button goes without creating the client's private link yet.
    const onlineUrl = kind === "invoice" && site
      ? (preview ? `${site}/d/preview` : await documentLink(admin, built.companyId, "invoice", docId, site))
      : null;
    const standard = [
      ...built.paras,
      ...(note ? [esc(note).replace(/\n/g, "<br>")] : []),
      "If you have any questions, simply reply to this email.",
    ];
    const edited = editedText(body.body_text);
    const paras = [
      built.greetName ? `Hello ${esc(built.greetName)},` : "Hello,",
      ...(edited ? textToParas(edited, esc) : standard),
      ...(built.fixedAfter ?? []),
      ...(onlineUrl ? [`${button(onlineUrl, "View & pay online")}<br><span style="font-size:12px;color:#64748B">See the invoice, our banking details, and send us your proof of payment.</span>`] : []),
    ];
    const head = logoUrl
      ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" style="max-height:56px;max-width:220px;display:block">`
      : `<div style="font-size:20px;font-weight:700;color:#0F172A">${esc(companyName)}</div>`;
    const contacts = [co?.contact_phone, co?.contact_email, co?.website].filter(Boolean).map(esc).join(" &middot; ");
    const html = `<!doctype html><html><body style="margin:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;overflow:hidden">
<tr><td style="padding:24px 28px;border-bottom:3px solid #1E3A5F">${head}</td></tr>
<tr><td style="padding:24px 28px;color:#0F172A;font-size:14px;line-height:1.6">
${paras.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join("")}
<p style="margin:16px 0 0">${signOffHtml(esc, sender, companyName)}</p>
</td></tr>
<tr><td style="padding:16px 28px;background:#F8FAFC;color:#64748B;font-size:12px;line-height:1.6">
${co?.legal_name && co.legal_name !== companyName ? `<div>${esc(co.legal_name)}</div>` : ""}${contacts ? `<div>${contacts}</div>` : ""}
${co?.document_footer ? `<div style="margin-top:8px">${esc(co.document_footer)}</div>` : ""}
</td></tr></table>
</td></tr></table></body></html>`;
    const text = paras.map(htmlToText).join("\n\n") + (onlineUrl ? `\n\nView and pay online: ${onlineUrl}` : "") + `\n\n${signOffText(sender, companyName)}`;
    const defaultSubject = built.subject(companyName);
    const subject = editedSubject(body.subject) ?? defaultSubject;
    if (preview) {
      return json({
        ok: true, preview: true, from: sender.from, reply_to: sender.replyTo, to: recipient, cc,
        subject, default_subject: defaultSubject, body_text: standard.map(htmlToText).join("\n\n"), html,
      });
    }
    const filename = String(body.filename ?? "Document.pdf").replace(/[^\w.\-]+/g, "_");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender.from,
        to: [recipient], ...(cc.length ? { cc } : {}), ...(sender.replyTo ? { reply_to: sender.replyTo } : {}), subject, html, text,
        ...(pdf ? { attachments: [{ filename, content: pdf }] } : {}),
      }),
    });
    const out = await res.json().catch(() => ({})) as { id?: string; message?: string };
    await admin.from("document_emails").insert({
      company_id: built.companyId, kind, doc_id: docId, recipient_email: recipient, cc, subject,
      status: res.ok ? "sent" : "failed", error_message: res.ok ? null : (out.message ?? `Resend ${res.status}`),
      provider_message_id: out.id ?? null, sent_by: user.id,
    });
    if (!res.ok) return json({ error: "send_failed", message: out.message ?? "The email could not be sent." }, 502);
    await built.afterSent?.();
    return json({ ok: true, recipient_email: recipient, cc, from: sender.from });
  } catch (e) {
    return json({ error: "unexpected", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
