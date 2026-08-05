import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type EmployeeDeliveryRow = {
  id: number;
  notification_id: number;
  channel: "email" | "push";
  recipient_email: string | null;
  recipient_employee_id: number | null;
  attempts: number;
};

type ClientDeliveryRow = {
  id: string;
  channel: "email" | "sms";
  recipient: string;
  subject: string | null;
  body: string;
  attempts: number;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sendEmail(resendApiKey: string, to: string, subject: string, text: string) {
  const from = Deno.env.get("NOTIFY_FROM_EMAIL") ?? "KaiFlow <no-reply@kaiflow.app>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend error ${response.status}: ${body}`);
  }
}

async function sendSms(twilioSid: string, twilioToken: string, from: string, to: string, body: string) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const auth = btoa(`${twilioSid}:${twilioToken}`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Twilio error ${response.status}: ${errBody}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER") ?? "";
  const admin = createClient(supabaseUrl, serviceRole);

  try {
    const body = await req.json().catch(() => ({}));
    const companyId = Number(body?.company_id ?? 0);
    const limit = Math.max(1, Math.min(100, Number(body?.limit ?? 40)));
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return new Response(JSON.stringify({ error: "company_id required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const { data } = await admin
      .from("app_notification_deliveries")
      .select("id, notification_id, channel, recipient_email, recipient_employee_id, attempts")
      .eq("company_id", companyId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    const deliveries = (data ?? []) as EmployeeDeliveryRow[];
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const d of deliveries) {
      try {
        const { data: notif } = await admin
          .from("app_notifications")
          .select("title, body")
          .eq("id", d.notification_id)
          .maybeSingle();
        if (!notif) {
          await admin.from("app_notification_deliveries").update({
            status: "skipped",
            error_message: "notification not found",
            last_attempt_at: new Date().toISOString(),
          }).eq("id", d.id);
          skipped++;
          continue;
        }

        if (d.channel === "email") {
          if (!d.recipient_email) {
            await admin.from("app_notification_deliveries").update({
              status: "skipped",
              error_message: "missing recipient_email",
              last_attempt_at: new Date().toISOString(),
            }).eq("id", d.id);
            skipped++;
            continue;
          }
          if (!resendKey) {
            await admin.from("app_notification_deliveries").update({
              status: "skipped",
              error_message: "RESEND_API_KEY not configured",
              last_attempt_at: new Date().toISOString(),
            }).eq("id", d.id);
            skipped++;
            continue;
          }
          await sendEmail(resendKey, d.recipient_email, notif.title, notif.body);
          await admin.from("app_notification_deliveries").update({
            status: "sent",
            delivered_at: new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
            attempts: d.attempts + 1,
          }).eq("id", d.id);
          sent++;
          continue;
        }

        await admin.from("app_notification_deliveries").update({
          status: "skipped",
          error_message: "push provider not configured",
          last_attempt_at: new Date().toISOString(),
          attempts: d.attempts + 1,
        }).eq("id", d.id);
        skipped++;
      } catch (e) {
        failed++;
        await admin.from("app_notification_deliveries").update({
          status: d.attempts >= 2 ? "failed" : "pending",
          attempts: d.attempts + 1,
          last_attempt_at: new Date().toISOString(),
          error_message: e instanceof Error ? e.message : String(e),
        }).eq("id", d.id);
      }
    }

    let clientSent = 0;
    let clientFailed = 0;
    let clientSkipped = 0;

    const { data: clientRows } = await admin
      .from("client_notification_deliveries")
      .select("id, channel, recipient, subject, body, attempts")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);

    for (const d of (clientRows ?? []) as ClientDeliveryRow[]) {
      try {
        if (d.channel === "email") {
          if (!resendKey) {
            await admin.from("client_notification_deliveries").update({
              status: "skipped",
              error_message: "RESEND_API_KEY not configured",
              last_attempt_at: new Date().toISOString(),
            }).eq("id", d.id);
            clientSkipped++;
            continue;
          }
          await sendEmail(resendKey, d.recipient, d.subject ?? "KaiFlow project update", d.body);
          await admin.from("client_notification_deliveries").update({
            status: "sent",
            sent_at: new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
            attempts: d.attempts + 1,
          }).eq("id", d.id);
          clientSent++;
          continue;
        }

        if (!twilioSid || !twilioToken || !twilioFrom) {
          await admin.from("client_notification_deliveries").update({
            status: "skipped",
            error_message: "Twilio not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)",
            last_attempt_at: new Date().toISOString(),
          }).eq("id", d.id);
          clientSkipped++;
          continue;
        }

        await sendSms(twilioSid, twilioToken, twilioFrom, d.recipient, d.body);
        await admin.from("client_notification_deliveries").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          last_attempt_at: new Date().toISOString(),
          attempts: d.attempts + 1,
        }).eq("id", d.id);
        clientSent++;
      } catch (e) {
        clientFailed++;
        await admin.from("client_notification_deliveries").update({
          status: d.attempts >= 2 ? "failed" : "pending",
          attempts: d.attempts + 1,
          last_attempt_at: new Date().toISOString(),
          error_message: e instanceof Error ? e.message : String(e),
        }).eq("id", d.id);
      }
    }

    return new Response(JSON.stringify({
      processed: deliveries.length,
      sent,
      failed,
      skipped,
      client_processed: (clientRows ?? []).length,
      client_sent: clientSent,
      client_failed: clientFailed,
      client_skipped: clientSkipped,
    }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
