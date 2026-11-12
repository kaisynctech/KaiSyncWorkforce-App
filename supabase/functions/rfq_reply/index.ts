// supabase/functions/rfq_reply/index.ts
//
// A supplier's private "Send your prices" page (from the request-for-quotation email; no login).
// Body { token, action }:
//   view   → who is asking, the items this supplier was asked for, and anything they already sent
//   submit → { lines: [{ rfq_line_id, unit_price, quantity?, lead_time_days? }], prices_include_vat: 'excl'|'incl'|'none',
//              valid_until?, notes?, file_base64?, filename?, mime? } their prices (they can send again to change them)
// The token is the only key and only reaches this one supplier's request. Never shows the client or selling prices.
// The office is notified when prices arrive. Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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
const MAX_BYTES = 8 * 1024 * 1024;
const VAT = ["excl", "incl", "none"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Method not allowed", 405);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const token = String(body.token ?? "").trim();
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return fail("This link is not valid.", 404);
    const action = String(body.action ?? "view");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const { data: r } = await admin.from("rfq_recipients")
      .select("id, company_id, rfq_id, supplier_id, status, line_ids, viewed_at, prices_include_vat, response_valid_until, response_notes, reply_attachment_path, supplier:contractors(name, contact_person, is_vat_registered)")
      .eq("reply_token", token).maybeSingle();
    if (!r) return fail("This link is not valid.", 404);
    const { data: rfq } = await admin.from("rfqs")
      .select("id, quote_id, rfq_number, status, delivery_address, required_by_date, response_deadline, created_at")
      .eq("id", r.rfq_id).maybeSingle();
    if (!rfq) return fail("This request is no longer available.", 404);
    // Links stop working 120 days after the request was made.
    if (Date.now() - new Date(rfq.created_at).getTime() > 120 * 86400000) return fail("This request has expired. Please contact us if you still want to quote.", 410);
    const closed = ["cancelled", "closed", "awarded"].includes(String(rfq.status));
    const { data: company } = await admin.from("companies")
      .select("name, brand_logo_path, contact_phone, contact_email, website").eq("id", r.company_id).maybeSingle();
    const companyName = String(company?.name ?? "").trim() || "The company";
    const supplier = (r.supplier ?? {}) as { name?: string; contact_person?: string | null; is_vat_registered?: boolean | null };

    const asked = (r.line_ids ?? null) as string[] | null;
    const { data: allLines } = await admin.from("rfq_lines").select("id, description, quantity, unit, specifications, sort_order")
      .eq("rfq_id", rfq.id).order("sort_order");
    const lines = (allLines ?? []).filter((l) => String(l.description ?? "").trim() && (!asked || asked.includes(l.id)));

    if (action === "submit") {
      if (closed) return fail("This request is closed, so prices can no longer be sent. Thank you.");
      const vat = String(body.prices_include_vat ?? "");
      if (!VAT.includes(vat)) return fail("Please say whether your prices include VAT.");
      const allowed = new Set(lines.map((l) => l.id));
      const rows = (Array.isArray(body.lines) ? body.lines : []).map((x) => x as Record<string, unknown>)
        .filter((x) => allowed.has(String(x.rfq_line_id)) && Number(x.unit_price) > 0 && Number(x.unit_price) < 1e9)
        .map((x) => {
          const qty = x.quantity == null || x.quantity === "" ? null : Math.max(0, Number(x.quantity));
          const lead = x.lead_time_days == null || x.lead_time_days === "" ? null : Math.min(3650, Math.max(0, Math.round(Number(x.lead_time_days))));
          const price = Math.round(Number(x.unit_price) * 10000) / 10000;
          const line = lines.find((l) => l.id === String(x.rfq_line_id))!;
          return {
            company_id: r.company_id, rfq_id: rfq.id, recipient_id: r.id, rfq_line_id: line.id,
            unit_price: price, quantity: Number.isFinite(qty as number) ? qty : null, lead_time_days: Number.isFinite(lead as number) ? lead : null,
            subtotal: Math.round(price * Number(qty ?? line.quantity ?? 1) * 100) / 100,
            availability_notes: String(x.notes ?? "").trim().slice(0, 300) || null,
          };
        });
      if (!rows.length) return fail("Please enter a price for at least one item.");

      let attachment: string | null = r.reply_attachment_path ?? null;
      if (body.file_base64) {
        const mime = String(body.mime ?? "").toLowerCase();
        if (mime !== "application/pdf") return fail("Please attach your quote as a PDF.");
        let bytes: Uint8Array;
        try { bytes = Uint8Array.from(atob(String(body.file_base64).replace(/^data:[^,]*,/, "")), (c) => c.charCodeAt(0)); } catch { return fail("The file could not be read."); }
        if (!bytes.length) return fail("The file is empty.");
        if (bytes.length > MAX_BYTES) return fail("The file is too big. Please keep it under 8 MB.");
        const path = `rfq_replies/${r.company_id}/${r.id}/${crypto.randomUUID()}.pdf`;
        const up = await admin.storage.from("workforce-media").upload(path, bytes, { contentType: "application/pdf", upsert: false });
        if (up.error) return fail("The file could not be saved. Please try again.", 500);
        attachment = path;
      }

      const { error: e1 } = await admin.from("rfq_response_lines").upsert(rows, { onConflict: "recipient_id,rfq_line_id" });
      if (e1) return fail("Your prices could not be saved. Please try again.", 500);
      const now = new Date().toISOString();
      const validUntil = /^\d{4}-\d{2}-\d{2}$/.test(String(body.valid_until ?? "")) ? String(body.valid_until) : null;
      const subtotal = rows.reduce((s, x) => s + x.subtotal, 0);
      const { error: e2 } = await admin.from("rfq_recipients").update({
        status: "responded", responded_at: now, replied_online: true, prices_include_vat: vat,
        response_valid_until: validUntil, response_notes: String(body.notes ?? "").trim().slice(0, 1000) || null,
        response_subtotal: Math.round(subtotal * 100) / 100,
        response_delivery_days: rows.reduce((m, x) => Math.max(m, x.lead_time_days ?? 0), 0) || null,
        reply_attachment_path: attachment, updated_at: now,
      }).eq("id", r.id);
      if (e2) return fail("Your prices could not be saved. Please try again.", 500);
      const { data: q } = rfq.quote_id ? await admin.from("commercial_quotes").select("quote_number").eq("id", rfq.quote_id).maybeSingle() : { data: null };
      await admin.rpc("_notify_office", {
        p_company_id: r.company_id, p_type: "rfq_reply_online",
        p_title: `${supplier.name ?? "A supplier"} sent prices`,
        p_body: `${supplier.name ?? "A supplier"} priced ${rows.length} of ${lines.length} ${lines.length === 1 ? "item" : "items"} on ${rfq.rfq_number ?? "your request"}${q?.quote_number ? ` (quote ${q.quote_number})` : ""}. Compare and choose on the quote's Buyout tab.`,
        p_ref_type: rfq.quote_id ? "quote" : "rfq", p_ref_id: rfq.quote_id ?? rfq.id, p_key: `rfq_reply:${r.id}:${now.slice(0, 16)}`,
        p_data: { rfq_id: rfq.id, recipient_id: r.id, quote_id: rfq.quote_id },
      });
      return json({ ok: true, message: `Thank you! ${companyName} has your prices.` });
    }

    if (action !== "view") return fail("Unknown action.");
    if (!r.viewed_at) await admin.from("rfq_recipients").update({ viewed_at: new Date().toISOString(), status: r.status === "sent" ? "viewed" : r.status }).eq("id", r.id);
    const { data: mine } = await admin.from("rfq_response_lines").select("rfq_line_id, unit_price, quantity, lead_time_days, availability_notes").eq("recipient_id", r.id);
    return json({
      ok: true,
      company: { name: companyName, brand_logo_path: company?.brand_logo_path ?? null, contact_phone: company?.contact_phone ?? null, contact_email: company?.contact_email ?? null, website: company?.website ?? null },
      supplier: { name: supplier.name ?? null, contact_person: supplier.contact_person ?? null, is_vat_registered: supplier.is_vat_registered ?? null },
      rfq: { number: rfq.rfq_number, required_by: rfq.required_by_date, reply_by: rfq.response_deadline, delivery_address: rfq.delivery_address },
      lines: lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unit: l.unit, specifications: l.specifications })),
      reply: {
        sent: r.status === "responded", prices_include_vat: r.prices_include_vat, valid_until: r.response_valid_until, notes: r.response_notes,
        has_attachment: !!r.reply_attachment_path,
        lines: (mine ?? []).map((m) => ({ rfq_line_id: m.rfq_line_id, unit_price: m.unit_price, quantity: m.quantity, lead_time_days: m.lead_time_days, notes: m.availability_notes })),
      },
      can_reply: !closed,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
});
