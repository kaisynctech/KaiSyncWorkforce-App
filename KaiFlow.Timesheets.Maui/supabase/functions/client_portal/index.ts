// Public client portal API (token in JSON body). No user JWT required.
// Uses service role to read job + updates + checklist and to insert complaints.

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = (await req.json()) as Record<string, unknown>;
    const token = (body?.token ?? "").toString().trim();
    const action = (body?.action ?? "bundle").toString().trim();

    if (!token) {
      return json({ error: "Missing token" }, 400);
    }

    const { data: tok, error: tokErr } = await admin
      .from("job_portal_tokens")
      .select("id, company_id, job_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (tokErr || !tok) {
      return json({ error: "Invalid or unknown portal link" }, 404);
    }

    const exp = tok.expires_at ? new Date(tok.expires_at as string) : null;
    if (exp && exp.getTime() < Date.now()) {
      return json({ error: "This portal link has expired" }, 410);
    }

    const companyId = Number(tok.company_id);
    const jobId = Number(tok.job_id);

    if (action === "complaint") {
      const subject = (body?.subject ?? "").toString().trim();
      const text = (body?.body ?? "").toString().trim();
      const email = (body?.email ?? "").toString().trim();
      if (!subject || !text) {
        return json({ error: "Subject and body are required" }, 400);
      }
      const { error: insErr } = await admin.from("job_client_complaints").insert({
        company_id: companyId,
        job_id: jobId,
        subject,
        body: text,
        client_email: email || null,
        status: "open",
      });
      if (insErr) {
        return json({ error: insErr.message }, 500);
      }
      return json({ ok: true });
    }

    if (action !== "bundle") {
      return json({ error: "Unknown action" }, 400);
    }

    const { data: job, error: jobErr } = await admin
      .from("jobs")
      .select(
        "id, title, description, status, client_id, scheduled_start, scheduled_end, opened_at, closed_at, priority",
      )
      .eq("company_id", companyId)
      .eq("id", jobId)
      .maybeSingle();

    if (jobErr || !job) {
      return json({ error: "Job not found" }, 404);
    }

    let clientName: string | null = null;
    if (job.client_id) {
      const { data: cl } = await admin
        .from("clients")
        .select("name")
        .eq("company_id", companyId)
        .eq("id", job.client_id)
        .maybeSingle();
      clientName = (cl?.name as string) ?? null;
    }

    const { data: updates } = await admin
      .from("job_client_updates")
      .select("id, body, source, created_at, visibility")
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .eq("visibility", "client")
      .order("created_at", { ascending: false })
      .limit(50);

    const { data: checklist } = await admin
      .from("job_checklist_items")
      .select(
        "id, kind, title, description, sort_order, completed_at, worker_comment",
      )
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    const { data: complaints } = await admin
      .from("job_client_complaints")
      .select("id, subject, status, created_at")
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: fb } = await admin
      .from("job_feedback")
      .select("rating_1_to_5, comments, submitted_at")
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .maybeSingle();

    return json({
      ok: true,
      job,
      client_name: clientName,
      updates: updates ?? [],
      checklist: checklist ?? [],
      complaints: complaints ?? [],
      feedback: fb ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
});
