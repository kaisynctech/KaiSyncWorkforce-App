// supabase/functions/send_payslip_email/index.ts
//
// Emails an employee their released payslip (PDF attached). Sent in the company's name; replies go to the
// company's email, or to the person who sent it if the company has none. The address comes from the
// employee's profile, never from the browser. Owner, HR and admins only. Logged in the payslip's audit log.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFY_FROM_EMAIL (optional)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
const monthLabel = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" }) : "";

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

    const body = (await req.json().catch(() => ({}))) as { payment_id?: string; pdf_base64?: string; filename?: string };
    const paymentId = String(body.payment_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return json({ error: "payment_id required" }, 400);
    const pdf = String(body.pdf_base64 ?? "").replace(/^data:application\/pdf;base64,/, "").trim();
    if (!pdf) return json({ error: "pdf_base64 required" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: pay } = await admin.from("payment_approvals")
      .select("id, company_id, employee_id, period_start, period_end, status, shared_with_employee, audit_log")
      .eq("id", paymentId).maybeSingle();
    if (!pay) return json({ error: "not_found", message: "Payslip not found." }, 404);

    // Permission: owner, HR or admin of this payslip's company.
    const { data: role } = await userClient.rpc("get_my_role", { p_company_id: pay.company_id });
    const { data: hrOk } = await userClient.rpc("role_is_hr_or_above", { p_role: role });
    if (!hrOk) return json({ error: "not_allowed", message: "Only the owner, HR and admins can email payslips." }, 403);
    if (!pay.shared_with_employee || !["approved", "paid"].includes(String(pay.status))) {
      return json({ error: "not_released", message: "Release the payslip before emailing it." }, 409);
    }

    const resendKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
    if (!resendKey) return json({ error: "email_not_configured", message: "Email sending is not set up." }, 503);
    const from = (Deno.env.get("NOTIFY_FROM_EMAIL") ?? "").trim() || "no-reply@kaisyncworkforce.com";
    // The company's own address once its domain is verified (Settings → Email), otherwise ours.
    const { data: ownSender } = await admin.rpc("company_sender_address", { p_company_id: pay.company_id });
    const fromAddress = (typeof ownSender === "string" && ownSender) || (from.match(/<([^>]+)>/)?.[1] ?? from).trim();

    const [{ data: emp }, { data: co }] = await Promise.all([
      admin.from("employees").select("name, surname, email").eq("id", pay.employee_id).maybeSingle(),
      admin.from("companies").select("name, legal_name, contact_phone, contact_email, website, brand_logo_path").eq("id", pay.company_id).maybeSingle(),
    ]);
    const recipient = valid(emp?.email);
    if (!recipient) return json({ error: "no_email", message: "This employee has no email address." }, 400);

    const companyName = String(co?.name ?? "").trim() || "Your employer";
    const first = String(emp?.name ?? "").trim();
    const month = monthLabel(pay.period_start) || "this period";
    const logoUrl = co?.brand_logo_path ? admin.storage.from("company-branding").getPublicUrl(co.brand_logo_path).data.publicUrl : null;
    const paras = [
      first ? `Hello ${esc(first)},` : "Hello,",
      `Your payslip for <strong>${esc(month)}</strong> is attached.`,
      "Please keep it somewhere safe. If anything on it doesn’t look right, simply reply to this email.",
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
<p style="margin:16px 0 0">Kind regards,<br><strong>${esc(companyName)}</strong></p>
</td></tr>
<tr><td style="padding:16px 28px;background:#F8FAFC;color:#64748B;font-size:12px;line-height:1.6">
${co?.legal_name && co.legal_name !== companyName ? `<div>${esc(co.legal_name)}</div>` : ""}${contacts ? `<div>${contacts}</div>` : ""}
</td></tr></table>
</td></tr></table></body></html>`;
    const text = paras.map((p) => p.replace(/<[^>]+>/g, "")).join("\n\n") + `\n\nKind regards,\n${companyName}`;
    const replyTo = valid(co?.contact_email) || valid(user.email);
    const filename = String(body.filename ?? "Payslip.pdf").replace(/[^\w.\-]+/g, "_");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `"${companyName.replace(/["<>\r\n]/g, "").slice(0, 80)}" <${fromAddress}>`,
        to: [recipient], ...(replyTo ? { reply_to: replyTo } : {}),
        subject: `Your payslip — ${month}`, html, text,
        attachments: [{ filename, content: pdf }],
      }),
    });
    const out = await res.json().catch(() => ({})) as { id?: string; message?: string };
    const audit = Array.isArray(pay.audit_log) ? [...pay.audit_log] : [];
    audit.push(res.ok
      ? { action: "emailed", detail: `Emailed to ${recipient}`, at: new Date().toISOString(), by: user.id }
      : { action: "email_failed", detail: `Email to ${recipient} failed: ${out.message ?? res.status}`, at: new Date().toISOString(), by: user.id });
    await admin.from("payment_approvals").update({ audit_log: audit }).eq("id", pay.id);
    if (!res.ok) return json({ error: "send_failed", message: out.message ?? "The email could not be sent." }, 502);
    return json({ ok: true, recipient_email: recipient });
  } catch (e) {
    return json({ error: "unexpected", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
