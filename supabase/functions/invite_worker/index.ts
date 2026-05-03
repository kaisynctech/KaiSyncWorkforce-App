// supabase/functions/invite_worker/index.ts
//
// Invites a worker (employee or contractor) to KaiFlow.
//
// Called by HR after creating an employee row. Verifies the caller is an
// active HR user for the target company, then uses the service_role key to
// send a Supabase Auth invitation email. If the user already exists in
// auth.users, falls back to a magic-link email so they can still log in.
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

    // Service-role client for admin work + RLS bypass.
    const admin = createClient(supabaseUrl, serviceKey);

    // Verify caller is an active HR user.
    const { data: hr } = await admin
      .from("hr_users")
      .select("auth_user_id, company_id, role, is_active")
      .eq("auth_user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!hr) return json({ error: "Not an active HR user" }, 403);

    const payload = (await req.json()) as InvitePayload;
    const email = (payload?.email ?? "").trim().toLowerCase();
    const companyId = Number(payload?.company_id);
    if (!email || !companyId) {
      return json({ error: "Missing email or company_id" }, 400);
    }

    // Tenant check: HR must belong to the company they're inviting into.
    if (Number(hr.company_id) !== companyId) {
      return json({ error: "HR not authorized for this company" }, 403);
    }

    // The employee row must already exist (HR created it, then we invite).
    const { data: emp } = await admin
      .from("employees")
      .select("id, email, company_id")
      .eq("company_id", companyId)
      .eq("email", email)
      .maybeSingle();
    if (!emp) return json({ error: "No matching employee row" }, 404);

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

    let mode: "invite" | "magiclink" = "invite";
    const inviteRes = await admin.auth.admin.inviteUserByEmail(
      email,
      inviteOptions,
    );
    if (inviteRes.error) {
      const msg = inviteRes.error.message?.toLowerCase() ?? "";
      const userExists = msg.includes("already") ||
        msg.includes("registered") ||
        msg.includes("exist");
      if (!userExists) {
        return json({ error: inviteRes.error.message }, 500);
      }
      // Fall back to magic link for existing accounts.
      mode = "magiclink";
      const linkRes = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      if (linkRes.error) return json({ error: linkRes.error.message }, 500);
    }

    // Mark the employee row as invited.
    await admin
      .from("employees")
      .update({
        invited_at: new Date().toISOString(),
        invite_status: "sent",
      })
      .eq("id", emp.id);

    return json({ ok: true, email, mode });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});
