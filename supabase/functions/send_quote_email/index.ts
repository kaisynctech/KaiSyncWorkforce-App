// supabase/functions/send_quote_email/index.ts
//
// Sends a Money quote PDF to the client via Resend and logs commercial_quote_sends.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//      RESEND_API_KEY, NOTIFY_FROM_EMAIL (optional)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

type Body = {
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

    if (!resendKey) {
      return json({ error: "email_not_configured", message: "RESEND_API_KEY is not set on the project." }, 503);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Invalid session" }, 401);

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

    const body = (await req.json().catch(() => ({}))) as Body;
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

    const textBody = [
      "Hello,",
      "",
      `Please find attached our quotation${quote.quote_number ? ` (${quote.quote_number})` : ""}.`,
      "",
      "Kind regards,",
      "KaiSync",
    ].join("\n");

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject,
        text: textBody,
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
