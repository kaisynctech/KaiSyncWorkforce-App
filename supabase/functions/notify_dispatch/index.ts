import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type DeliveryRow = {
  id: number;
  notification_id: number;
  channel: "email" | "push";
  recipient_email: string | null;
  recipient_employee_id: number | null;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
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

    const deliveries = (data ?? []) as DeliveryRow[];
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

        // Push dispatch requires provider-specific integration.
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

    return new Response(JSON.stringify({ processed: deliveries.length, sent, failed, skipped }), {
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
