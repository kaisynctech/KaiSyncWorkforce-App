// supabase/functions/send_quote_email/index.ts
//
// Sends a Money quote PDF to the client via Resend and logs commercial_quote_sends.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//      RESEND_API_KEY, NOTIFY_FROM_EMAIL (optional)
// Body { check: true } → { configured, from } without sending.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

type Company = {
  name: string | null;
  legal_name: string | null;
  registration_number: string | null;
  is_vat_registered: boolean | null;
  vat_number: string | null;
  address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
  brand_logo_path: string | null;
  document_footer: string | null;
};

/** Branded quote email: company logo and name on top, contact details and footer note below. */
function quoteEmailHtml(c: Company, logoUrl: string | null, quoteNumber: string | null, title: string | null): string {
  const name = esc(c.name || "Our company");
  const ids = [
    c.registration_number ? `Reg. no. ${esc(c.registration_number)}` : "",
    c.is_vat_registered && c.vat_number ? `VAT no. ${esc(c.vat_number)}` : "",
  ].filter(Boolean).join(" &middot; ");
  const contacts = [
    c.contact_phone ? esc(c.contact_phone) : "",
    c.contact_email ? `<a href="mailto:${esc(c.contact_email)}" style="color:#1E3A5F">${esc(c.contact_email)}</a>` : "",
    c.website ? esc(c.website) : "",
  ].filter(Boolean).join(" &middot; ");
  const head = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${name}" style="max-height:56px;max-width:220px;display:block">`
    : `<div style="font-size:20px;font-weight:700;color:#0F172A">${name}</div>`;
  return `<!doctype html><html><body style="margin:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="padding:24px 28px;border-bottom:3px solid #1E3A5F">${head}</td></tr>
<tr><td style="padding:24px 28px;color:#0F172A;font-size:14px;line-height:1.6">
<p style="margin:0 0 12px">Hello,</p>
<p style="margin:0 0 12px">Please find attached our quotation${quoteNumber ? ` <strong>${esc(quoteNumber)}</strong>` : ""}${title ? ` for <strong>${esc(title)}</strong>` : ""}.</p>
<p style="margin:0 0 12px">If you have any questions, simply reply to this email.</p>
<p style="margin:16px 0 0">Kind regards,<br><strong>${name}</strong></p>
</td></tr>
<tr><td style="padding:16px 28px;background:#F8FAFC;color:#64748B;font-size:12px;line-height:1.6">
${c.legal_name && c.legal_name !== c.name ? `<div>${esc(c.legal_name)}</div>` : ""}
${ids ? `<div>${ids}</div>` : ""}
${c.address ? `<div>${esc(c.address).replace(/\n/g, ", ")}</div>` : ""}
${contacts ? `<div>${contacts}</div>` : ""}
${c.document_footer ? `<div style="margin-top:8px">${esc(c.document_footer)}</div>` : ""}
</td></tr>
</table>
<div style="color:#94A3B8;font-size:11px;margin-top:12px">Sent with KaiSync</div>
</td></tr></table></body></html>`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

type Body = {
  check?: boolean;
  quote_id?: string;
  recipient_email?: string;
  subject?: string;
  pdf_base64?: string;
  filename?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const from = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "KaiFlow <no-reply@kaiflow.app>";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Invalid session" }, 401);

    const body = (await req.json().catch(() => ({}))) as Body;

    if (body.check === true) {
      return json({
        configured: Boolean(resendKey),
        from: resendKey ? from : null,
      });
    }

    if (!resendKey) {
      return json({ error: "email_not_configured", message: "RESEND_API_KEY is not set on the project." }, 503);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: emp } = await admin
      .from("employees")
      .select("id, company_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!emp?.company_id) return json({ error: "No company linked" }, 403);

    const quoteId = body.quote_id;
    if (!quoteId) return json({ error: "quote_id required" }, 400);
    if (!body.pdf_base64?.trim()) return json({ error: "pdf_base64 required" }, 400);

    const { data: quote } = await admin
      .from("commercial_quotes")
      .select("id, company_id, title, quote_number, status, client_id")
      .eq("id", quoteId)
      .eq("company_id", emp.company_id)
      .maybeSingle();

    if (!quote) return json({ error: "Quote not found" }, 404);

    let recipient = (body.recipient_email ?? "").trim();
    if (!recipient && quote.client_id) {
      const { data: client } = await admin
        .from("clients")
        .select("email")
        .eq("id", quote.client_id)
        .maybeSingle();
      recipient = (client?.email ?? "").trim();
    }
    if (!recipient) return json({ error: "recipient_email required" }, 400);

    const subject = (body.subject ?? "").trim()
      || `Quote ${quote.quote_number ?? ""} – ${quote.title || "Quotation"}`.trim();
    const filename = (body.filename ?? `Quote_${quote.quote_number ?? "draft"}.pdf`)
      .replace(/[^\w.\-]+/g, "_");

    const pdfBase64 = body.pdf_base64.replace(/^data:application\/pdf;base64,/, "");

    const { data: company } = await admin
      .from("companies")
      .select("name, legal_name, registration_number, is_vat_registered, vat_number, address, contact_phone, contact_email, website, brand_logo_path, document_footer")
      .eq("id", emp.company_id)
      .maybeSingle();
    const co = (company ?? { name: null }) as Company;
    const logoUrl = co.brand_logo_path
      ? admin.storage.from("company-branding").getPublicUrl(co.brand_logo_path).data.publicUrl
      : null;
    const companyName = (co.name ?? "").trim() || "KaiSync";

    const textBody = [
      "Hello,",
      "",
      `Please find attached our quotation${quote.quote_number ? ` (${quote.quote_number})` : ""}.`,
      "",
      "Kind regards,",
      companyName,
      [co.contact_phone, co.contact_email, co.website].filter(Boolean).join(" · "),
    ].filter((l, i, a) => l !== "" || i < a.length - 1).join("\n");
    const htmlBody = quoteEmailHtml(co, logoUrl, quote.quote_number ?? null, quote.title ?? null);

    // Sender shows the company's name; replies go to the company's contact email.
    const fromAddress = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
    const safeName = companyName.replace(/["<>\r\n]/g, "").slice(0, 80);
    const fromBranded = `"${safeName}" <${fromAddress}>`;
    const replyTo = (co.contact_email ?? "").trim();

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromBranded,
        to: [recipient],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        text: textBody,
        html: htmlBody,
        attachments: [{ filename, content: pdfBase64 }],
      }),
    });

    const resendJson = await resendRes.json().catch(() => ({})) as { id?: string; message?: string };
    if (!resendRes.ok) {
      const errMsg = resendJson.message ?? `Resend error ${resendRes.status}`;
      await admin.from("commercial_quote_sends").insert({
        company_id: emp.company_id,
        quote_id: quoteId,
        sent_by: emp.id,
        recipient_email: recipient,
        subject,
        status: "failed",
        error_message: errMsg,
      });
      return json({ error: "send_failed", message: errMsg }, 502);
    }

    await admin.from("commercial_quote_sends").insert({
      company_id: emp.company_id,
      quote_id: quoteId,
      sent_by: emp.id,
      recipient_email: recipient,
      subject,
      status: "sent",
      provider_message_id: resendJson.id ?? null,
    });

    const now = new Date().toISOString();
    await admin
      .from("commercial_quotes")
      .update({ status: "sent", sent_at: now, updated_at: now })
      .eq("id", quoteId)
      .eq("company_id", emp.company_id);

    return json({
      ok: true,
      provider_message_id: resendJson.id ?? null,
      recipient_email: recipient,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: "unexpected", message }, 500);
  }
});
