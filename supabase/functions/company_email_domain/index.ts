// supabase/functions/company_email_domain/index.ts
//
// "Send from your own domain". Owner, HR and admins only.
// Body { company_id, action }:
//   status → the company's domain, its DNS records and whether it is verified
//   add    → { domain, local } register the domain with Resend; returns the DNS records to add
//   check  → ask Resend to check the DNS records now; returns the new status
//   remove → stop using the domain (emails go back to the KaiSync address)
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (needs domain access)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
const fail = (message: string, status = 400) => json({ ok: false, message }, status);

const BLOCKED = /(^|\.)(kaisyncworkforce\.com|kaisync\.co\.za|gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|live\.com|yahoo\.com|icloud\.com|resend\.dev)$/i;

type ResendDomain = { id: string; name: string; status: string; records?: { record: string; name: string; type: string; value: string; ttl?: string; status?: string; priority?: number }[] };

async function resend(path: string, method: string, key: string, body?: unknown) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, out };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Method not allowed", 405);
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return fail("Missing Authorization", 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return fail("Invalid session", 401);
    const body = (await req.json().catch(() => ({}))) as { company_id?: string; action?: string; domain?: string; local?: string };
    const companyId = String(body.company_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(companyId)) return fail("company_id required");
    const { data: role } = await userClient.rpc("get_my_role", { p_company_id: companyId });
    const { data: hr } = await userClient.rpc("role_is_hr_or_above", { p_role: role });
    if (!hr) return fail("Only the owner, HR and admins can change this.", 403);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const key = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
    if (!key) return fail("Email sending is not set up.", 503);
    const { data: co } = await admin.from("companies")
      .select("email_domain, email_domain_id, email_domain_status, email_domain_records, email_domain_checked_at, email_from_local")
      .eq("id", companyId).maybeSingle();
    if (!co) return fail("Company not found.", 404);
    const view = (c: typeof co) => ({
      ok: true, domain: c?.email_domain ?? null, status: c?.email_domain_status ?? null, records: c?.email_domain_records ?? [],
      local: c?.email_from_local ?? "accounts", checked_at: c?.email_domain_checked_at ?? null,
      sender: c?.email_domain && c?.email_domain_status === "verified" ? `${c.email_from_local}@${c.email_domain}` : null,
    });
    const save = async (patch: Record<string, unknown>) => {
      const { data, error } = await admin.from("companies").update(patch).eq("id", companyId)
        .select("email_domain, email_domain_id, email_domain_status, email_domain_records, email_domain_checked_at, email_from_local").single();
      if (error) throw new Error(error.message);
      return data;
    };
    const action = String(body.action ?? "status");

    if (action === "status") return json(view(co));

    if (action === "add") {
      const domain = String(body.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      const local = String(body.local ?? "accounts").trim().toLowerCase() || "accounts";
      if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) return fail("Enter a domain like yourcompany.co.za.");
      if (BLOCKED.test(domain)) return fail("Use your own company's domain (not Gmail, Outlook or KaiSync).");
      if (!/^[a-z0-9][a-z0-9._-]{0,40}$/.test(local)) return fail("The part before the @ can only use letters, numbers, dots and dashes.");
      const { data: taken } = await admin.from("companies").select("id").ilike("email_domain", domain).neq("id", companyId).limit(1);
      if (taken && taken.length) return fail("That domain is already used by another company on KaiSync.");
      if (co.email_domain_id && co.email_domain?.toLowerCase() === domain) {
        return json(view(await save({ email_from_local: local })));
      }
      if (co.email_domain_id) await resend(`/domains/${co.email_domain_id}`, "DELETE", key);
      // Send-only: we only send from this domain, never receive on it.
      const r = await resend("/domains", "POST", key, { name: domain, region: "eu-west-1" });
      if (!r.ok) {
        const msg = String(r.out.message ?? r.out.name ?? `Error ${r.status}`);
        if (r.status === 401 || /restricted|permission/i.test(msg)) return fail("Our email key can only send emails, not add domains. KaiSync needs a full-access email key first.", 503);
        if (/limit|plan/i.test(msg)) return fail("KaiSync has reached its email plan's limit on domains. Please contact KaiSync support.", 503);
        if (/already/i.test(msg)) return fail("That domain is already registered with the email provider. Please contact KaiSync support.", 409);
        return fail(`The domain could not be added: ${msg}`, 502);
      }
      const d = r.out as unknown as ResendDomain;
      return json(view(await save({
        email_domain: domain, email_domain_id: d.id, email_domain_status: d.status ?? "not_started",
        email_domain_records: d.records ?? [], email_domain_checked_at: new Date().toISOString(), email_from_local: local,
      })));
    }

    if (action === "check") {
      if (!co.email_domain_id) return fail("Add your domain first.");
      await resend(`/domains/${co.email_domain_id}/verify`, "POST", key);
      const g = await resend(`/domains/${co.email_domain_id}`, "GET", key);
      if (!g.ok) return fail("Could not check the domain right now. Please try again.", 502);
      const d = g.out as unknown as ResendDomain;
      return json(view(await save({
        email_domain_status: d.status, email_domain_records: d.records ?? co.email_domain_records, email_domain_checked_at: new Date().toISOString(),
      })));
    }

    if (action === "remove") {
      if (co.email_domain_id) await resend(`/domains/${co.email_domain_id}`, "DELETE", key);
      return json(view(await save({
        email_domain: null, email_domain_id: null, email_domain_status: null, email_domain_records: null, email_domain_checked_at: null,
      })));
    }
    return fail("Unknown action.");
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
});
