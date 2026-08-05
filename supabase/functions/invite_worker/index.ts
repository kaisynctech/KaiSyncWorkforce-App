// supabase/functions/invite_worker/index.ts
//
// Invites a worker (employee or contractor) to KaiFlow.
//
// Called after an employee row exists. Verifies the caller may send invites:
// active HR for the company, or a contractor lead for a contractor that includes
// the target worker. Uses service_role for Auth mail APIs.
//
// Required env vars (set automatically by Supabase): SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

interface InvitePayload {
  email: string;
  company_id: number | string;
  name?: string;
  company_name?: string;
  company_code?: string;
  employee_code?: string;
  flow?: string;
  redirect_to?: string;
}

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
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Caller-bound client for identity verification.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth
      .getUser();
    if (userError || !user) return json({ error: "Invalid session" }, 401);

    // Service-role client for admin work + RLS bypass (no persisted session).
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    // Anon-key client (no user JWT) for magic-link / OTP email delivery.
    // signInWithOtp on the service-role client often does not trigger the same
    // outbound mail path as a normal client; contractors frequently already
    // have an auth account, so this path must reliably send email.
    const mailer = createClient(supabaseUrl, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const payload = (await req.json()) as InvitePayload;
    const email = (payload?.email ?? "").trim().toLowerCase();
    const companyId = Number(payload?.company_id);
    const flow = (payload?.flow ?? "unknown").trim() || "unknown";
    if (!email || !companyId) {
      return json({ error: "Missing email or company_id" }, 400);
    }

    // Verify caller: active HR for this company OR contractor lead managing the
    // target worker (same contractor membership). Does not change HR sign-in.
    const { data: authz, error: authzErr } = await admin.rpc(
      "invite_worker_actor_authorized",
      {
        p_company_id: companyId,
        p_actor_auth_uid: user.id,
        p_target_email: email,
      },
    );
    if (authzErr) {
      return json({ error: authzErr.message }, 500);
    }
    const authorized = authz === true || authz === "t" || authz === "true";
    if (!authorized) {
      return json({ error: "Not authorized to send this invite" }, 403);
    }

    // The employee row must already exist (HR created it, then we invite).
    const { data: emp, error: empLookupErr } = await admin
      .from("employees")
      .select("id, email, company_id")
      .eq("company_id", companyId)
      .eq("email", email)
      .maybeSingle();
    if (empLookupErr) {
      return json({ error: empLookupErr.message }, 500);
    }
    if (!emp) {
      return json({
        error:
          "No matching employee row for this email in your company. Save the worker first, then resend the invite.",
      }, 404);
    }

    const writeAudit = async ({
      status,
      mode,
      errorText,
    }: {
      status: "sent" | "failed";
      mode: string;
      errorText?: string;
    }) => {
      try {
        await admin.from("invite_delivery_audit").insert({
          company_id: companyId,
          actor_auth_user_id: user.id,
          target_employee_id: Number(emp.id),
          email,
          flow,
          mode,
          status,
          error_text: errorText ?? null,
          metadata: {
            redirect_to: payload?.redirect_to ?? null,
            employee_code: payload?.employee_code ?? null,
          },
        });
      } catch (auditErr) {
        console.error("invite_worker: invite_delivery_audit insert failed", auditErr);
        // Never block invite delivery if audit insert fails.
      }
    };

    const inviteOptions: Record<string, unknown> = {
      data: {
        invited_company_id: companyId,
        invited_company_name: payload?.company_name ?? "",
        invited_company_code: payload?.company_code ?? "",
        invited_name: payload?.name ?? "",
        invited_employee_code: payload?.employee_code ?? "",
      },
    };
    if (payload?.redirect_to) inviteOptions.redirectTo = payload.redirect_to;

    let mode = "invite";
    const inviteRes = await admin.auth.admin.inviteUserByEmail(
      email,
      inviteOptions,
    );
    if (inviteRes.error) {
      const msg = inviteRes.error.message?.toLowerCase() ?? "";
      const userExists = msg.includes("already") ||
        msg.includes("registered") ||
        msg.includes("exist") ||
        msg.includes("duplicate");
      if (!userExists) {
        await writeAudit({
          status: "failed",
          mode: "invite",
          errorText: inviteRes.error.message,
        });
        return json({ error: inviteRes.error.message }, 500);
      }
      // Existing auth user: inviteUserByEmail does not send mail. generateLink()
      // only builds a URL — it does NOT email it. Use OTP/magic-link email instead.
      mode = "sign_in_otp";
      const otpRes = await mailer.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: payload?.redirect_to,
          data: inviteOptions.data as Record<string, unknown>,
        },
      });
      if (otpRes.error) {
        await writeAudit({
          status: "failed",
          mode: "sign_in_otp",
          errorText: otpRes.error.message,
        });
        return json({ error: otpRes.error.message }, 500);
      }
    }

    // Mark the employee row as invited.
    const { error: flagErr } = await admin
      .from("employees")
      .update({
        invited_at: new Date().toISOString(),
        invite_status: "sent",
      })
      .eq("id", emp.id);
    if (flagErr) {
      console.error("invite_worker: employee invite flags update failed", flagErr);
    }

    await writeAudit({
      status: "sent",
      mode,
    });

    return json({ ok: true, email, mode });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
