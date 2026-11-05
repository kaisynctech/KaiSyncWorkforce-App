// supabase/functions/public_document/index.ts
//
// The client's online invoice or quote, opened from the private link in the email (no login).
// Body { token, action }:
//   view    → company letterhead, client, the document, its lines, and what the client can do
//   proof   → { file_base64, filename, mime, amount?, reference?, notes? } proof of payment for an invoice
//   accept  → { name } accept a quote: it becomes a draft invoice for the office to send
//   decline → { reason? } decline a quote
// The token is the only key. It expires after 180 days. Everything is read with the service role and
// limited to that one document. The office is notified of proofs, acceptances and declines.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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
const rand = (n: unknown) => "R " + Number(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COMPANY_COLUMNS =
  "name, legal_name, registration_number, is_vat_registered, vat_number, address, postal_address, contact_phone, contact_email, website, brand_logo_path, bank_account_holder, bank_name, bank_account_number, bank_branch_code, bank_account_type, bank_swift_code, show_bank_on_invoices, show_bank_on_quotes, document_footer";
const MIME: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 8 * 1024 * 1024;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Method not allowed", 405);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const token = String(body.token ?? "").trim();
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return fail("This link is not valid.", 404);
    const action = String(body.action ?? "view");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const { data: link } = await admin.from("document_links").select("*").eq("token", token).maybeSingle();
    if (!link) return fail("This link is not valid.", 404);
    if (new Date(link.expires_at).getTime() < Date.now()) return fail("This link has expired. Please ask for a new one.", 410);

    const { data: company } = await admin.from("companies").select(COMPANY_COLUMNS).eq("id", link.company_id).maybeSingle();
    if (!company) return fail("This link is not valid.", 404);
    const companyName = String(company.name ?? "").trim() || "The company";
    // Banking only when the company shows it on this kind of document.
    const showBank = link.kind === "invoice" ? company.show_bank_on_invoices !== false : company.show_bank_on_quotes === true;
    if (!showBank) {
      for (const k of ["bank_account_holder", "bank_name", "bank_account_number", "bank_branch_code", "bank_account_type", "bank_swift_code"]) {
        (company as Record<string, unknown>)[k] = null;
      }
    }

    // ── Invoice ──────────────────────────────────────────────────────────────
    if (link.kind === "invoice") {
      const { data: inv } = await admin.from("finance_invoices")
        .select("id, company_id, client_id, invoice_number, status, issue_date, due_date, notes, subtotal, vat_amount, total_amount, amount_paid, balance_due, client:clients(name, legal_name, address, billing_address, vat_number, email)")
        .eq("id", link.doc_id).eq("company_id", link.company_id).maybeSingle();
      if (!inv || inv.status === "draft") return fail("This invoice is not available.", 404);
      const closed = ["voided", "cancelled"].includes(String(inv.status));
      const paid = Number(inv.balance_due ?? 0) <= 0.004 || inv.status === "paid";

      if (action === "proof") {
        if (closed) return fail("This invoice was cancelled, so no payment is needed.");
        if (paid) return fail("This invoice is already paid in full. Thank you!");
        const mime = String(body.mime ?? "").toLowerCase();
        const ext = MIME[mime];
        if (!ext) return fail("Please send a PDF or a photo (JPG or PNG).");
        const b64 = String(body.file_base64 ?? "").replace(/^data:[^,]*,/, "");
        let bytes: Uint8Array;
        try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return fail("The file could not be read."); }
        if (bytes.length === 0) return fail("The file is empty.");
        if (bytes.length > MAX_BYTES) return fail("The file is too big. Please keep it under 8 MB.");
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { count } = await admin.from("finance_payment_proofs").select("id", { count: "exact", head: true })
          .eq("invoice_id", inv.id).gte("created_at", since);
        if ((count ?? 0) >= 10) return fail("Too many uploads today. Please contact us instead.", 429);
        const amount = body.amount == null || body.amount === "" ? null : Number(body.amount);
        if (amount != null && !(amount > 0 && amount < 1e9)) return fail("Enter the amount you paid, or leave it empty.");
        const path = `client_documents/${inv.company_id}/${inv.client_id}/payment_proofs/${crypto.randomUUID()}.${ext}`;
        const up = await admin.storage.from("workforce-media").upload(path, bytes, { contentType: mime, upsert: false });
        if (up.error) return fail("The file could not be saved. Please try again.", 500);
        const reference = String(body.reference ?? "").trim().slice(0, 120) || null;
        const notes = String(body.notes ?? "").trim().slice(0, 500) || null;
        const { data: proof, error: pErr } = await admin.from("finance_payment_proofs").insert({
          company_id: inv.company_id, invoice_id: inv.id, storage_path: path, amount, reference, notes, status: "submitted",
        }).select("id").single();
        if (pErr) return fail("The proof could not be saved. Please try again.", 500);
        const clientName = (inv.client as { name?: string } | null)?.name ?? "A client";
        await admin.rpc("_notify_office", {
          p_company_id: inv.company_id, p_type: "online_payment_proof",
          p_title: `Proof of payment from ${clientName}`,
          p_body: `${clientName} sent proof of payment for invoice ${inv.invoice_number ?? ""}${amount ? ` (${rand(amount)})` : ""}. Check it on the invoice and record the payment.`,
          p_ref_type: "invoice", p_ref_id: inv.id, p_key: `online_proof:${proof.id}`,
          p_data: { invoice_id: inv.id, proof_id: proof.id },
        });
        return json({ ok: true, message: "Thank you! We've received your proof of payment and will confirm it shortly." });
      }

      if (action !== "view") return fail("Unknown action.");
      const [{ data: lines }, { data: proofs }] = await Promise.all([
        admin.from("finance_invoice_lines").select("description, quantity, unit_price, vat_amount, total_amount, line_no")
          .eq("invoice_id", inv.id).order("line_no"),
        admin.from("finance_payment_proofs").select("status, amount, created_at").eq("invoice_id", inv.id).order("created_at", { ascending: false }).limit(5),
      ]);
      await admin.from("document_links").update({
        view_count: (link.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString(),
        first_viewed_at: link.first_viewed_at ?? new Date().toISOString(),
      }).eq("token", token);
      return json({
        ok: true, kind: "invoice", company,
        client: inv.client,
        doc: {
          number: inv.invoice_number, status: inv.status, issue_date: inv.issue_date, due_date: inv.due_date, notes: inv.notes,
          subtotal: inv.subtotal, vat: inv.vat_amount, total: inv.total_amount, paid: inv.amount_paid, balance: inv.balance_due,
        },
        lines: lines ?? [],
        proofs: proofs ?? [],
        can_pay: !closed && !paid,
        closed, fully_paid: paid && !closed,
      });
    }

    // ── Quote ────────────────────────────────────────────────────────────────
    const { data: q } = await admin.from("commercial_quotes")
      .select("id, company_id, client_id, quote_number, title, status, valid_until, scope_notes, terms_and_conditions, internal_notes, subtotal, vat_amount, total_amount, accepted_at, declined_at, declined_reason, viewed_at, client:clients(name, legal_name, address, billing_address, email)")
      .eq("id", link.doc_id).eq("company_id", link.company_id).maybeSingle();
    if (!q || q.status === "draft") return fail("This quote is not available.", 404);
    const expired = !!q.valid_until && new Date(`${String(q.valid_until).slice(0, 10)}T23:59:59+02:00`).getTime() < Date.now();
    const open = !["accepted", "declined", "expired", "cancelled", "voided"].includes(String(q.status)) && !expired;
    const clientName = (q.client as { name?: string } | null)?.name ?? "The client";

    if (action === "accept" || action === "decline") {
      if (!open) {
        return fail(q.status === "accepted" ? "This quote was already accepted. Thank you!"
          : q.status === "declined" ? "This quote was already declined."
          : "This quote can no longer be accepted online. Please contact us.");
      }
      const now = new Date().toISOString();
      if (action === "accept") {
        const name = String(body.name ?? "").trim().slice(0, 120);
        if (name.length < 2) return fail("Please type your name to accept.");
        const { error } = await admin.from("commercial_quotes").update({
          status: "accepted", accepted_at: now, updated_at: now,
          internal_notes: [q.internal_notes, `Accepted online by ${name} on ${now.slice(0, 10)}.`].filter(Boolean).join("\n"),
        }).eq("id", q.id).eq("status", q.status);
        if (error) return fail("Something went wrong. Please try again.", 500);
        const { data: invId, error: cErr } = await admin.rpc("_quote_to_draft_invoice", { p_quote_id: q.id });
        await admin.rpc("_notify_office", {
          p_company_id: q.company_id, p_type: "quote_accepted_online",
          p_title: `${clientName} accepted quote ${q.quote_number ?? ""}`.trim(),
          p_body: `${name} accepted ${q.quote_number ?? "the quote"} (${rand(q.total_amount)}) online.${cErr ? "" : " A draft invoice is ready for you to check and send."}`,
          p_ref_type: cErr ? "quote" : "invoice", p_ref_id: cErr ? q.id : String(invId), p_key: `quote_accepted:${q.id}`,
          p_data: { quote_id: q.id, invoice_id: cErr ? null : invId, accepted_by: name },
        });
        return json({ ok: true, message: `Thank you, ${name}! Your acceptance has been sent to ${companyName}.` });
      }
      const reason = String(body.reason ?? "").trim().slice(0, 500) || null;
      const { error } = await admin.from("commercial_quotes").update({
        status: "declined", declined_at: now, declined_reason: reason, updated_at: now,
      }).eq("id", q.id).eq("status", q.status);
      if (error) return fail("Something went wrong. Please try again.", 500);
      await admin.rpc("_notify_office", {
        p_company_id: q.company_id, p_type: "quote_declined_online",
        p_title: `${clientName} declined quote ${q.quote_number ?? ""}`.trim(),
        p_body: `${clientName} declined ${q.quote_number ?? "the quote"} online.${reason ? ` Reason: ${reason}` : ""}`,
        p_ref_type: "quote", p_ref_id: q.id, p_key: `quote_declined:${q.id}`, p_data: { quote_id: q.id },
      });
      return json({ ok: true, message: `Thanks for letting us know. ${companyName} has been told.` });
    }

    if (action !== "view") return fail("Unknown action.");
    const { data: lines } = await admin.from("commercial_quote_lines")
      .select("description, quantity, unit, unit_sell_price, subtotal_sell, line_total, sort_order, is_excluded")
      .eq("quote_id", q.id).order("sort_order");
    const nowIso = new Date().toISOString();
    await admin.from("document_links").update({
      view_count: (link.view_count ?? 0) + 1, last_viewed_at: nowIso, first_viewed_at: link.first_viewed_at ?? nowIso,
    }).eq("token", token);
    if (!q.viewed_at) await admin.from("commercial_quotes").update({ viewed_at: nowIso }).eq("id", q.id);
    return json({
      ok: true, kind: "quote", company, client: q.client,
      doc: {
        number: q.quote_number, title: q.title, status: q.status, valid_until: q.valid_until, notes: q.scope_notes,
        terms: q.terms_and_conditions, subtotal: q.subtotal, vat: q.vat_amount, total: q.total_amount,
        accepted_at: q.accepted_at, declined_at: q.declined_at, expired,
      },
      lines: (lines ?? []).filter((l) => !l.is_excluded),
      can_respond: open,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
});
