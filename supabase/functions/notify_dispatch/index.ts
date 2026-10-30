// supabase/functions/notify_dispatch/index.ts
//
// Sends queued notifications. Called every 5 minutes by the database (public.notify_dispatch_kick,
// pg_cron) with the private key from Vault in the x-dispatch-secret header.
//  - client_notification_deliveries: emails to clients (branded with the company), SMS via Twilio.
//  - app_notification_deliveries: emails to staff.
// Rules: nothing older than 7 days is sent (marked expired); clients joined to their own KaiSync
// company through Linked companies get in-app alerts instead of these emails; when email or SMS is
// not set up, rows are left waiting (not thrown away).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, NOTIFY_FROM_EMAIL,
//      TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (optional)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const BATCH = 50;
const PORTAL_URL = "https://www.kaisyncworkforce.com/client-portal";

type ClientRow = {
  id: string;
  company_id: string | null;
  deal_id: string | null;
  channel: "email" | "sms";
  recipient: string;
  subject: string | null;
  body: string;
  attempts: number;
  created_at: string;
};
type StaffRow = {
  id: number | string;
  notification_id: number | string;
  channel: "email" | "push";
  recipient_email: string | null;
  attempts: number;
  created_at: string;
};
type Company = { name: string | null; contact_email: string | null; contact_phone: string | null; brand_logo_path: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function tooOld(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > MAX_AGE_MS;
}

function emailHtml(co: Company, logoUrl: string | null, subject: string, body: string): string {
  const name = esc(co.name || "Your contractor");
  const head = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${name}" style="max-height:56px;max-width:220px;display:block">`
    : `<div style="font-size:20px;font-weight:700;color:#0F172A">${name}</div>`;
  const contacts = [co.contact_phone ? esc(co.contact_phone) : "", co.contact_email ? esc(co.contact_email) : ""]
    .filter(Boolean).join(" &middot; ");
  return `<!doctype html><html><body style="margin:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="padding:24px 28px;border-bottom:3px solid #1E3A5F">${head}</td></tr>
<tr><td style="padding:24px 28px;color:#0F172A;font-size:14px;line-height:1.6">
<p style="margin:0 0 12px;font-weight:700">${esc(subject)}</p>
<p style="margin:0 0 16px;white-space:pre-line">${esc(body)}</p>
<p style="margin:0 0 16px"><a href="${PORTAL_URL}" style="display:inline-block;background:#1E3A5F;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">Open your client portal</a></p>
<p style="margin:0;color:#64748B;font-size:12px">You can reply to this email to reach ${name}.</p>
</td></tr>
${contacts ? `<tr><td style="padding:16px 28px;background:#F8FAFC;color:#64748B;font-size:12px">${contacts}</td></tr>` : ""}
</table>
<div style="color:#94A3B8;font-size:11px;margin-top:12px">Sent with KaiSync</div>
</td></tr></table></body></html>`;
}

async function sendEmail(key: string, msg: { from: string; to: string; replyTo?: string; subject: string; text: string; html?: string }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: msg.from, to: [msg.to], subject: msg.subject, text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function sendSms(sid: string, token: string, from: string, to: string, body: string) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  if (!res.ok) throw new Error(`Twilio error ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Take the row for this run; false if another run already took it. */
async function claim(admin: SupabaseClient, table: string, id: string | number, attempts: number): Promise<boolean> {
  const { data } = await admin.from(table)
    .update({ attempts: attempts + 1, last_attempt_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending").eq("attempts", attempts)
    .select("id");
  return (data ?? []).length === 1;
}

async function finish(admin: SupabaseClient, table: string, id: string | number, patch: Record<string, unknown>) {
  await admin.from(table).update({ ...patch, last_attempt_at: new Date().toISOString() }).eq("id", id);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Only the database scheduler (which holds the Vault key) may run this.
  const secret = req.headers.get("x-dispatch-secret") ?? "";
  const { data: ok } = await admin.rpc("notify_dispatch_secret_ok", { p_secret: secret });
  if (ok !== true) return json({ error: "Not allowed" }, 401);

  const resendKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  const fromEnv = (Deno.env.get("NOTIFY_FROM_EMAIL") ?? "").trim() || "KaiSync <no-reply@kaisyncworkforce.com>";
  const fromAddress = (fromEnv.match(/<([^>]+)>/)?.[1] ?? fromEnv).trim();
  const twSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const twToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const twFrom = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";
  const smsReady = Boolean(twSid && twToken && twFrom);

  const out = { email_configured: Boolean(resendKey), sms_configured: smsReady, sent: 0, failed: 0, expired: 0, linked: 0, waiting: 0 };

  try {
    // ── Client queue ──────────────────────────────────────────────────────────
    const { data: rows } = await admin.from("client_notification_deliveries")
      .select("id, company_id, deal_id, channel, recipient, subject, body, attempts, created_at")
      .eq("status", "pending").order("created_at", { ascending: true }).limit(BATCH);

    const companies = new Map<string, { co: Company; logo: string | null }>();
    const linkedDeals = new Map<string, boolean>();

    for (const d of (rows ?? []) as ClientRow[]) {
      if (tooOld(d.created_at)) {
        await finish(admin, "client_notification_deliveries", d.id, { status: "skipped", error_message: "expired: older than 7 days" });
        out.expired++;
        continue;
      }
      // Linked companies get in-app alerts in their own KaiSync instead.
      if (d.deal_id) {
        if (!linkedDeals.has(d.deal_id)) {
          const { data: deal } = await admin.from("client_deals").select("client_id").eq("id", d.deal_id).maybeSingle();
          let linked = false;
          if (deal?.client_id) {
            const { count } = await admin.from("company_links").select("id", { count: "exact", head: true })
              .eq("provider_client_id", deal.client_id).eq("status", "active");
            linked = (count ?? 0) > 0;
          }
          linkedDeals.set(d.deal_id, linked);
        }
        if (linkedDeals.get(d.deal_id)) {
          await finish(admin, "client_notification_deliveries", d.id, { status: "skipped", error_message: "linked company: in-app alert instead" });
          out.linked++;
          continue;
        }
      }
      if ((d.channel === "email" && !resendKey) || (d.channel === "sms" && !smsReady)) { out.waiting++; continue; }
      if (!(await claim(admin, "client_notification_deliveries", d.id, d.attempts))) continue;

      try {
        if (d.channel === "email") {
          let entry = d.company_id ? companies.get(d.company_id) : undefined;
          if (!entry && d.company_id) {
            const { data: c } = await admin.from("companies")
              .select("name, contact_email, contact_phone, brand_logo_path").eq("id", d.company_id).maybeSingle();
            const co = (c ?? { name: null, contact_email: null, contact_phone: null, brand_logo_path: null }) as Company;
            const logo = co.brand_logo_path ? admin.storage.from("company-branding").getPublicUrl(co.brand_logo_path).data.publicUrl : null;
            entry = { co, logo };
            companies.set(d.company_id, entry);
          }
          const co = entry?.co ?? { name: null, contact_email: null, contact_phone: null, brand_logo_path: null };
          const name = (co.name ?? "").trim() || "KaiSync";
          const subject = (d.subject ?? "").trim() || `Update from ${name}`;
          await sendEmail(resendKey, {
            from: `"${name.replace(/["<>\r\n]/g, "").slice(0, 80)}" <${fromAddress}>`,
            to: d.recipient,
            replyTo: (co.contact_email ?? "").trim() || undefined,
            subject,
            text: `${d.body}\n\nOpen your client portal: ${PORTAL_URL}\n\n${name}`,
            html: emailHtml(co, entry?.logo ?? null, subject, d.body),
          });
        } else {
          await sendSms(twSid, twToken, twFrom, d.recipient, d.body.slice(0, 600));
        }
        await finish(admin, "client_notification_deliveries", d.id, { status: "sent", sent_at: new Date().toISOString(), error_message: null });
        out.sent++;
      } catch (e) {
        out.failed++;
        await finish(admin, "client_notification_deliveries", d.id, {
          status: d.attempts + 1 >= 3 ? "failed" : "pending",
          error_message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ── Staff email queue ─────────────────────────────────────────────────────
    const { data: staff } = await admin.from("app_notification_deliveries")
      .select("id, notification_id, channel, recipient_email, attempts, created_at")
      .eq("status", "pending").order("created_at", { ascending: true }).limit(BATCH);

    for (const d of (staff ?? []) as StaffRow[]) {
      if (tooOld(d.created_at)) {
        await finish(admin, "app_notification_deliveries", d.id, { status: "skipped", error_message: "expired: older than 7 days" });
        out.expired++;
        continue;
      }
      if (d.channel !== "email") {
        await finish(admin, "app_notification_deliveries", d.id, { status: "skipped", error_message: "push provider not configured" });
        continue;
      }
      if (!d.recipient_email) {
        await finish(admin, "app_notification_deliveries", d.id, { status: "skipped", error_message: "missing recipient_email" });
        continue;
      }
      if (!resendKey) { out.waiting++; continue; }
      if (!(await claim(admin, "app_notification_deliveries", d.id, d.attempts))) continue;
      try {
        const { data: n } = await admin.from("app_notifications").select("title, body").eq("id", d.notification_id).maybeSingle();
        if (!n) {
          await finish(admin, "app_notification_deliveries", d.id, { status: "skipped", error_message: "notification not found" });
          continue;
        }
        await sendEmail(resendKey, { from: fromEnv, to: d.recipient_email, subject: n.title, text: n.body ?? "" });
        await finish(admin, "app_notification_deliveries", d.id, { status: "sent", delivered_at: new Date().toISOString(), error_message: null });
        out.sent++;
      } catch (e) {
        out.failed++;
        await finish(admin, "app_notification_deliveries", d.id, {
          status: d.attempts + 1 >= 3 ? "failed" : "pending",
          error_message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return json(out);
  } catch (e) {
    return json({ ...out, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
