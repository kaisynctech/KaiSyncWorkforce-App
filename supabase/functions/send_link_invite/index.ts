// supabase/functions/send_link_invite/index.ts
//
// Linked companies: makes a one-use invite (through company_link_create_invite, which checks the
// signed-in person is the owner, HR or an admin of the company) and emails the link via Resend.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFY_FROM_EMAIL,
//      APP_ORIGINS (optional, comma-separated extra web addresses the invite link may point to).
// Body { company_id, my_role: 'provider'|'customer', record_id, recipient_email, origin, note? }
//   → { ok, token, expires_at, recipient_email }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAILY_LIMIT = 30;
const PRODUCTION = ["https://www.kaisyncworkforce.com", "https://kaisyncworkforce.com", "https://kaisyncwebsite.vercel.app"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

/** Only our own sites: production, this project's Vercel previews, local development, or APP_ORIGINS. */
function allowedOrigin(raw: unknown): string | null {
  let u: URL;
  try { u = new URL(String(raw ?? "")); } catch { return null; }
  const origin = u.origin;
  const extra = (Deno.env.get("APP_ORIGINS") ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  if (PRODUCTION.includes(origin) || extra.includes(origin)) return origin;
  if (u.protocol === "https:" && /^kaisyncwebsite-[a-z0-9-]+-kaisynctechs-projects\.vercel\.app$/.test(u.hostname)) return origin;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return origin;
  return null;
}

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
    const from = (Deno.env.get("NOTIFY_FROM_EMAIL") ?? "").trim() || "KaiSync <no-reply@kaisyncworkforce.com>";
    if (!resendKey) return json({ error: "email_not_configured", message: "Email is not set up yet." }, 503);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Invalid session" }, 401);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const companyId = String(body.company_id ?? "");
    const myRole = body.my_role === "customer" ? "customer" : body.my_role === "provider" ? "provider" : null;
    const recordId = String(body.record_id ?? "");
    const recipient = String(body.recipient_email ?? "").trim().toLowerCase();
    const note = String(body.note ?? "").trim().slice(0, 500);
    const origin = allowedOrigin(body.origin);
    if (!companyId || !myRole || !recordId) return json({ error: "bad_request", message: "Missing details." }, 400);
    if (!EMAIL_RE.test(recipient) || recipient.length > 254) return json({ error: "bad_email", message: "Type a valid email address." }, 400);
    if (!origin) return json({ error: "bad_origin", message: "This web address cannot send invites." }, 400);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // Limit how many invites one company can make in a day (also stops the email being used for spam).
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await admin.from("company_link_invites").select("id", { count: "exact", head: true })
      .eq("inviter_company_id", companyId).gte("created_at", since);
    if ((count ?? 0) >= DAILY_LIMIT) return json({ error: "too_many", message: "Too many invites today. Try again tomorrow." }, 429);

    // The database checks the person and the record, as the person themselves.
    const { data: inv, error: invErr } = await userClient.rpc("company_link_create_invite", {
      p_company_id: companyId, p_my_role: myRole, p_record_id: recordId,
    });
    if (invErr || !inv?.token) return json({ error: "invite_failed", message: invErr?.message ?? "Could not make the invite." }, 400);

    const { data: company } = await admin.from("companies").select("name, contact_email").eq("id", companyId).maybeSingle();
    const companyName = String(company?.name ?? "").trim() || "A KaiSync company";
    const replyTo = String(company?.contact_email ?? "").trim();
    const link = `${origin}/dashboard/linked-companies/invite/${encodeURIComponent(inv.token)}`;
    const expires = new Date(inv.expires_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
    const asWhat = myRole === "provider" ? "their client" : "their contractor";

    const subject = `${companyName} invites you to link on KaiSync`;
    const text = [
      "Hello,",
      "",
      `${companyName} would like to link with your company on KaiSync, as ${asWhat}.`,
      "Once linked, you work together inside KaiSync: jobs, quotes, invoices and messages are shared, with nothing copied.",
      ...(note ? ["", `Message from ${companyName}: ${note}`] : []),
      "",
      "Sign in to your company's KaiSync (owner, HR or admin), then open this link:",
      link,
      "",
      `The link works once, until ${expires}. If your company does not use KaiSync yet, reply to this email.`,
    ].join("\n");
    const html = `<!doctype html><html><body style="margin:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="padding:24px 28px;border-bottom:3px solid #1E3A5F;font-size:20px;font-weight:700;color:#0F172A">${esc(companyName)}</td></tr>
<tr><td style="padding:24px 28px;color:#0F172A;font-size:14px;line-height:1.6">
<p style="margin:0 0 12px">Hello,</p>
<p style="margin:0 0 12px"><strong>${esc(companyName)}</strong> would like to link with your company on KaiSync, as ${asWhat}.</p>
<p style="margin:0 0 12px">Once linked, you work together inside KaiSync: jobs, quotes, invoices and messages are shared, with nothing copied.</p>
${note ? `<p style="margin:0 0 12px;padding:10px 12px;background:#F8FAFC;border-left:3px solid #1E3A5F">${esc(note)}</p>` : ""}
<p style="margin:0 0 16px">Sign in to your company's KaiSync (owner, HR or admin), then open the invite:</p>
<p style="margin:0 0 16px"><a href="${esc(link)}" style="display:inline-block;background:#1E3A5F;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Open the invite</a></p>
<p style="margin:0;color:#64748B;font-size:12px">The link works once, until ${esc(expires)}. If your company does not use KaiSync yet, reply to this email.</p>
</td></tr></table>
<div style="color:#94A3B8;font-size:11px;margin-top:12px">Sent with KaiSync</div>
</td></tr></table></body></html>`;

    const fromAddress = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
    const safeName = companyName.replace(/["<>\r\n]/g, "").slice(0, 80);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `"${safeName} via KaiSync" <${fromAddress}>`,
        to: [recipient],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        text,
        html,
      }),
    });
    const out = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return json({ error: "send_failed", message: out.message ?? `Email error ${res.status}`, token: inv.token, expires_at: inv.expires_at }, 502);
    }

    await admin.from("audit_events").insert({
      company_id: companyId, actor_user_id: user.id, action: "company_link_invite_emailed",
      target_type: myRole === "provider" ? "client" : "contractor", target_id: recordId,
      meta: { recipient_email: recipient, provider_message_id: out.id ?? null, my_role: myRole },
    });

    return json({ ok: true, token: inv.token, expires_at: inv.expires_at, recipient_email: recipient });
  } catch (err) {
    return json({ error: "unexpected", message: err instanceof Error ? err.message : String(err) }, 500);
  }
});
