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

function randomState() {
  return crypto.randomUUID().replaceAll("-", "");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Invalid session" }, 401);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const payload = await req.json() as {
      company_id: number | string;
      provider: "google_calendar" | "microsoft_calendar";
      redirect_to?: string;
    };
    const provider = payload?.provider;
    const companyId = Number(payload?.company_id);
    if (!provider || !companyId) return json({ error: "Missing provider/company_id" }, 400);

    const { data: hr } = await admin
      .from("hr_users")
      .select("company_id, auth_user_id, is_active")
      .eq("auth_user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!hr || Number(hr.company_id) !== companyId) {
      return json({ error: "Not authorized for company" }, 403);
    }

    const state = randomState();
    const callbackUrl = new URL(req.url);
    callbackUrl.pathname = "/calendar_oauth_callback";
    callbackUrl.search = "";

    await admin.from("integration_oauth_states").insert({
      company_id: companyId,
      hr_user_id: user.id,
      provider,
      state_token: state,
      redirect_to: payload?.redirect_to ?? null,
      expires_at: new Date(Date.now() + 1000 * 60 * 15).toISOString(),
    });

    let authUrl = "";
    if (provider === "google_calendar") {
      const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
      if (!clientId) return json({ error: "Google OAuth not configured" }, 500);
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.searchParams.set("client_id", clientId);
      u.searchParams.set("redirect_uri", callbackUrl.toString());
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", "openid email profile https://www.googleapis.com/auth/calendar");
      u.searchParams.set("access_type", "offline");
      u.searchParams.set("prompt", "consent");
      u.searchParams.set("state", state);
      authUrl = u.toString();
    } else {
      const clientId = Deno.env.get("MICROSOFT_OAUTH_CLIENT_ID");
      if (!clientId) return json({ error: "Microsoft OAuth not configured" }, 500);
      const u = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
      u.searchParams.set("client_id", clientId);
      u.searchParams.set("redirect_uri", callbackUrl.toString());
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", "openid profile email offline_access User.Read Calendars.ReadWrite");
      u.searchParams.set("state", state);
      authUrl = u.toString();
    }

    return json({ ok: true, auth_url: authUrl });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

