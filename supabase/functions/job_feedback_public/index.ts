import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...cors },
  });
}

function esc(v: string) {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function page({
  title,
  message,
  token,
  submitted = false,
}: {
  title: string;
  message: string;
  token?: string;
  submitted?: boolean;
}) {
  const safeTitle = esc(title);
  const safeMessage = esc(message);
  const safeToken = esc(token ?? "");
  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f3f5fb; margin: 0; }
      .wrap { max-width: 560px; margin: 28px auto; padding: 0 12px; }
      .card { background: #fff; border-radius: 16px; padding: 18px; border: 1px solid #e5e7eb; }
      h1 { font-size: 20px; margin: 0 0 8px; }
      p { color: #4b5563; font-size: 14px; }
      label { display: block; margin-top: 12px; font-weight: 600; font-size: 13px; }
      textarea { width: 100%; min-height: 90px; border: 1px solid #d1d5db; border-radius: 10px; padding: 10px; font-size: 14px; }
      .stars { display: flex; gap: 8px; margin-top: 6px; }
      .stars label { margin-top: 0; font-weight: 500; }
      button { margin-top: 14px; background: #d4af37; color: #111827; border: none; border-radius: 10px; padding: 10px 14px; font-weight: 700; cursor: pointer; }
      .ok { color: #059669; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>${safeTitle}</h1>
        <p class="${submitted ? "ok" : ""}">${safeMessage}</p>
        ${
    submitted
      ? ""
      : `
        <form method="POST">
          <input type="hidden" name="token" value="${safeToken}" />
          <label>Rating</label>
          <div class="stars">
            <label><input type="radio" name="rating" value="1" required /> 1</label>
            <label><input type="radio" name="rating" value="2" /> 2</label>
            <label><input type="radio" name="rating" value="3" /> 3</label>
            <label><input type="radio" name="rating" value="4" /> 4</label>
            <label><input type="radio" name="rating" value="5" checked /> 5</label>
          </div>
          <label>Comments (optional)</label>
          <textarea name="comments" placeholder="How was the service?"></textarea>
          <button type="submit">Submit feedback</button>
        </form>
        `
  }
      </div>
    </div>
  </body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") {
    return html(page({
      title: "Method not allowed",
      message: "Use GET or POST for this endpoint.",
      submitted: true,
    }), 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    let token = "";
    let rating = 5;
    let comments = "";

    if (req.method === "GET") {
      const url = new URL(req.url);
      token = url.searchParams.get("token")?.trim() ?? "";
    } else {
      const contentType = req.headers.get("content-type") ?? "";
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const form = await req.formData();
        token = (form.get("token")?.toString() ?? "").trim();
        rating = Number(form.get("rating")?.toString() ?? "5");
        comments = (form.get("comments")?.toString() ?? "").trim();
      } else {
        const body = await req.json();
        token = (body?.token ?? "").toString().trim();
        rating = Number(body?.rating ?? 5);
        comments = (body?.comments ?? "").toString().trim();
      }
    }

    if (!token) {
      return html(page({
        title: "Feedback link invalid",
        message: "This feedback link is missing a token.",
        submitted: true,
      }), 400);
    }

    const { data: existing } = await admin
      .from("job_feedback")
      .select("id, company_id, job_id, rating_1_to_5, request_token_expires_at, request_token_used_at, request_open_count")
      .eq("request_token", token)
      .maybeSingle();

    if (!existing) {
      return html(page({
        title: "Feedback link expired",
        message: "This request link is not valid anymore. Please ask for a new one.",
        submitted: true,
      }), 404);
    }

    const nowIso = new Date().toISOString();
    const expiresAt = existing.request_token_expires_at
      ? new Date(existing.request_token_expires_at).toISOString()
      : null;
    const alreadyUsed = !!existing.request_token_used_at;
    const isExpired = expiresAt !== null && expiresAt < nowIso;

    if (alreadyUsed || isExpired) {
      await admin.from("job_feedback_events").insert({
        company_id: existing.company_id,
        job_feedback_id: existing.id,
        request_token: token,
        event_type: "rejected",
        metadata: { reason: alreadyUsed ? "used" : "expired" },
      });
      return html(page({
        title: "Feedback link expired",
        message: "This feedback link has expired or was already used. Please request a new one.",
        submitted: true,
      }), 410);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = req.headers.get("user-agent") ?? null;

    if (req.method === "GET") {
      await admin.from("job_feedback").update({
        request_opened_at: nowIso,
        request_open_count: (existing.request_open_count ?? 0) + 1,
      }).eq("id", existing.id);
      await admin.from("job_feedback_events").insert({
        company_id: existing.company_id,
        job_feedback_id: existing.id,
        request_token: token,
        event_type: "opened",
        ip_address: ip,
        user_agent: userAgent,
      });
      return html(page({
        title: "Job feedback",
        message: "Please rate the completed job.",
        token,
      }));
    }

    const rateWindowIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    let tooMany = false;
    if (ip) {
      const { data: rateRows } = await admin
        .from("job_feedback_events")
        .select("id")
        .eq("request_token", token)
        .eq("ip_address", ip)
        .gte("created_at", rateWindowIso)
        .limit(21);
      tooMany = (rateRows?.length ?? 0) >= 20;
    }
    if (tooMany) {
      await admin.from("job_feedback_events").insert({
        company_id: existing.company_id,
        job_feedback_id: existing.id,
        request_token: token,
        event_type: "rate_limited",
        ip_address: ip,
        user_agent: userAgent,
      });
      return html(page({
        title: "Too many attempts",
        message: "Please wait a few minutes and try again.",
        submitted: true,
      }), 429);
    }

    const safeRating = Number.isFinite(rating)
      ? Math.max(1, Math.min(5, Math.round(rating)))
      : 5;
    await admin
      .from("job_feedback")
      .update({
        rating_1_to_5: safeRating,
        comments: comments.length > 0 ? comments : null,
        channel: "public_link",
        submitted_at: new Date().toISOString(),
        request_token_used_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    await admin.from("job_feedback_events").insert({
      company_id: existing.company_id,
      job_feedback_id: existing.id,
      request_token: token,
      event_type: "submitted",
      ip_address: ip,
      user_agent: userAgent,
      metadata: { rating: safeRating },
    });

    return html(page({
      title: "Thank you",
      message: "Your feedback has been submitted successfully.",
      submitted: true,
    }));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return html(page({
      title: "Feedback failed",
      message,
      submitted: true,
    }), 500);
  }
});

