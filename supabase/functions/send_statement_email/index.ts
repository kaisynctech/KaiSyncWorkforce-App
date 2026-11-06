// supabase/functions/send_statement_email/index.ts
//
// Emails a client their statement of account (PDF attached) as a friendly payment reminder. It comes from
// the person who sends it, with replies going to them (see _shared/sender.ts); optional CC (up to 10). Owner, HR and admins only (checked with client_statement).
// Body { preview: true } returns the email without sending; an edited { subject, body_text } replaces the
// standard wording (see _shared/compose.ts). Logged in statement_reminders.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFY_FROM_EMAIL (optional)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { cleanCc, senderFor, signOffHtml, signOffText, validEmail } from "../_shared/sender.ts";
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
// The client's own currency: rand prints as "R", others as their code ("USD 1 250,00").
const rand = (n: number, cur = "ZAR") => `${cur === "ZAR" ? "R" : cur} ` + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Body = {
  client_id?: string; recipient_email?: string; cc?: unknown; pdf_base64?: string; filename?: string;
  balance?: number; overdue?: number; message?: string;
  preview?: boolean; subject?: string; body_text?: string;
};

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

    const body = (await req.json().catch(() => ({}))) as Body;
    const clientId = String(body.client_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "client_id required" }, 400);
    const preview = body.preview === true;
    if (!body.pdf_base64?.trim() && !preview) return json({ error: "pdf_base64 required" }, 400);

    // Permission: the same check as the statement itself (owner, HR, admins of this client's company).
    const { error: permErr } = await userClient.rpc("client_statement", { p_client_id: clientId });
    if (permErr) return json({ error: "not_allowed", message: "Only the owner, HR and admins can send statements." }, 403);

    const resendKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
    if (!resendKey) return json({ error: "email_not_configured", message: "Email sending is not set up." }, 503);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const { data: client } = await admin.from("clients").select("id, company_id, name, email, contact_person, currency").eq("id", clientId).maybeSingle();
    const cur = String((client as { currency?: string | null } | null)?.currency || "ZAR").toUpperCase();
    if (!client) return json({ error: "Client not found" }, 404);
    const recipient = (body.recipient_email ?? client.email ?? "").trim();
    if (!validEmail(recipient) && !preview) return json({ error: "recipient_email required", message: "Enter the client's email address." }, 400);
    const cc = cleanCc(body.cc, recipient);

    const { data: co } = await admin.from("companies")
      .select("name, legal_name, contact_phone, contact_email, website, brand_logo_path, document_footer")
      .eq("id", client.company_id).maybeSingle();
    const { data: me } = await admin.from("employees").select("id, name, surname").eq("user_id", user.id).eq("company_id", client.company_id).maybeSingle();
    const companyName = String(co?.name ?? "").trim() || "Our company";
    const sender = await senderFor(admin, { companyId: client.company_id, companyName, companyEmail: co?.contact_email ?? null, user,
      // The previous app (no cc field) keeps the company sender until the new release is live.
      mode: Array.isArray(body.cc) ? "personal" : "company" });
    const logoUrl = co?.brand_logo_path ? admin.storage.from("company-branding").getPublicUrl(co.brand_logo_path).data.publicUrl : null;
    const balance = Number(body.balance ?? 0);
    const overdue = Number(body.overdue ?? 0);
    const greeting = client.contact_person ? `Hello ${client.contact_person},` : "Hello,";
    const note = (body.message ?? "").trim().slice(0, 1500);
    const standard = [
      `Please find attached your statement of account with ${esc(companyName)}.`,
      balance > 0
        ? `The balance on your account is <strong>${esc(rand(balance, cur))}</strong>${overdue > 0 ? `, of which <strong>${esc(rand(overdue, cur))}</strong> is overdue` : ""}. We would appreciate payment at your earliest convenience.`
        : "Your account is up to date. Thank you!",
      ...(note ? [esc(note).replace(/\n/g, "<br>")] : []),
      "If you have already paid, or something doesn’t look right, simply reply to this email.",
    ];
    const edited = editedText(body.body_text);
    const paras = [esc(greeting), ...(edited ? textToParas(edited, esc) : standard)];
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
    const text = paras.map(htmlToText).join("\n\n") + `\n\n${signOffText(sender, companyName)}`;
    const defaultSubject = balance > 0 ? `Statement of account — ${rand(balance, cur)} outstanding` : "Statement of account";
    const subject = editedSubject(body.subject) ?? defaultSubject;
    if (preview) {
      return json({
        ok: true, preview: true, from: sender.from, reply_to: sender.replyTo, to: recipient, cc,
        subject, default_subject: defaultSubject, body_text: standard.map(htmlToText).join("\n\n"), html,
      });
    }
    const filename = (body.filename ?? "Statement.pdf").replace(/[^\w.\-]+/g, "_");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender.from,
        to: [recipient], ...(cc.length ? { cc } : {}), ...(sender.replyTo ? { reply_to: sender.replyTo } : {}), subject, html, text,
        attachments: [{ filename, content: (body.pdf_base64 ?? "").replace(/^data:application\/pdf;base64,/, "") }],
      }),
    });
    const out = await res.json().catch(() => ({})) as { id?: string; message?: string };
    await admin.from("statement_reminders").insert({
      company_id: client.company_id, client_id: client.id, sent_by: me?.id ?? null, recipient_email: recipient, cc,
      balance, overdue, status: res.ok ? "sent" : "failed", error_message: res.ok ? null : (out.message ?? `Resend ${res.status}`),
      provider_message_id: out.id ?? null,
    });
    if (!res.ok) return json({ error: "send_failed", message: out.message ?? "The email could not be sent." }, 502);
    return json({ ok: true, recipient_email: recipient, cc, from: sender.from });
  } catch (e) {
    return json({ error: "unexpected", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
