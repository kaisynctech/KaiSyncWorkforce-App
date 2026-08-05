import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function exchangeGoogle(code: string, redirectUri: string) {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google OAuth not configured");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed (${tokenRes.status})`);
  const token = await tokenRes.json();
  const accessToken = token.access_token as string;
  const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = meRes.ok ? await meRes.json() : {};
  return {
    accountId: (me?.id ?? "").toString() || null,
    email: (me?.email ?? "").toString() || null,
  };
}

async function exchangeMicrosoft(code: string, redirectUri: string) {
  const clientId = Deno.env.get("MICROSOFT_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Microsoft OAuth not configured");
  const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access User.Read Calendars.ReadWrite",
    }),
  });
  if (!tokenRes.ok) throw new Error(`Microsoft token exchange failed (${tokenRes.status})`);
  const token = await tokenRes.json();
  const accessToken = token.access_token as string;
  const meRes = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = meRes.ok ? await meRes.json() : {};
  return {
    accountId: (me?.id ?? "").toString() || null,
    email: (me?.mail ?? me?.userPrincipalName ?? "").toString() || null,
  };
}

Deno.serve(async (req: Request) => {
  try {
    const u = new URL(req.url);
    const state = u.searchParams.get("state") ?? "";
    const code = u.searchParams.get("code") ?? "";
    if (!state || !code) return html("<h3>Missing OAuth state or code.</h3>", 400);

    const callbackUrl = new URL(req.url);
    callbackUrl.search = "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: stateRow } = await admin
      .from("integration_oauth_states")
      .select("*")
      .eq("state_token", state)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!stateRow) return html("<h3>OAuth session expired. Please try connect again.</h3>", 400);

    const provider = (stateRow.provider ?? "").toString();
    const companyId = Number(stateRow.company_id);
    if (!companyId) return html("<h3>Invalid company context.</h3>", 400);

    let accountId: string | null = null;
    let email: string | null = null;
    if (provider === "google_calendar") {
      const g = await exchangeGoogle(code, callbackUrl.toString());
      accountId = g.accountId;
      email = g.email;
    } else if (provider === "microsoft_calendar") {
      const m = await exchangeMicrosoft(code, callbackUrl.toString());
      accountId = m.accountId;
      email = m.email;
    } else {
      throw new Error("Unsupported provider");
    }

    await admin.from("company_integration_connections").upsert({
      company_id: companyId,
      provider,
      connection_status: "connected",
      external_account_id: accountId,
      external_account_email: email,
      last_sync_at: new Date().toISOString(),
      last_error: null,
      metadata: { setup_mode: "oauth_phase1", linked_at: new Date().toISOString() },
    }, { onConflict: "company_id,provider" });

    await admin.from("integration_oauth_states")
      .update({ used_at: new Date().toISOString() })
      .eq("id", stateRow.id);

    return html(
      `<html><body style="font-family:Arial;padding:24px;">
        <h2>Calendar connected successfully</h2>
        <p>You can close this window and return to KaiFlow.</p>
      </body></html>`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return html(`<h3>OAuth connect failed</h3><p>${msg}</p>`, 500);
  }
});

