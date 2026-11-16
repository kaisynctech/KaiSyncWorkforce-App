// supabase/functions/public_document/index.ts
//
// The client's online invoice or quote, opened from the private link in the email (no login).
// Body { token, action }:
//   view    → company letterhead, client, the document, its lines, and what the client can do
//   proof   → { file_base64, filename, mime, amount?, reference?, notes? } proof of payment for an invoice
//   accept  → { name, choices? } accept a quote (choices: the option lines the client picked). With a deposit it
//             issues the deposit invoice, paid from the same page; otherwise a draft invoice for the office to send
//   decline → { reason? } decline a quote
//   ask     → { name?, body } a question about a quote; the office answers on the quote, the answer shows here
//   proof   (quote) → proof of payment for the quote's deposit invoice
//   sign    (job report) → { name, signature (PNG data URL), comment?, outcome: signed | not_happy, rating? 1–5 }
//           the client signs the job report (no prices) or says what is wrong; the office is notified by the database
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
// "R 24 391,50": the same way the app writes amounts (not left to the server's locale).
const rand = (n: unknown, cur?: string | null) => {
  const [int, dec] = Math.abs(Number(n ?? 0)).toFixed(2).split(".");
  return `${!cur || cur.toUpperCase() === "ZAR" ? "R" : cur.toUpperCase()} ${Number(n) < 0 ? "-" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${dec}`;
};

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
    const showBank = link.kind === "invoice" ? company.show_bank_on_invoices !== false
      : link.kind === "quote" ? company.show_bank_on_quotes === true : false;
    if (!showBank) {
      for (const k of ["bank_account_holder", "bank_name", "bank_account_number", "bank_branch_code", "bank_account_type", "bank_swift_code"]) {
        (company as Record<string, unknown>)[k] = null;
      }
    }

    // ── Job report (no prices) ───────────────────────────────────────────────
    if (link.kind === "job_report") return await jobReport(admin, link, company, body, action);

    // ── Invoice ──────────────────────────────────────────────────────────────
    if (link.kind === "invoice") {
      const { data: inv } = await admin.from("finance_invoices")
        .select("id, company_id, client_id, invoice_number, status, currency, issue_date, due_date, notes, subtotal, vat_amount, total_amount, amount_paid, balance_due, client:clients(name, legal_name, address, billing_address, vat_number, email)")
        .eq("id", link.doc_id).eq("company_id", link.company_id).maybeSingle();
      if (!inv || inv.status === "draft") return fail("This invoice is not available.", 404);
      const closed = ["voided", "cancelled"].includes(String(inv.status));
      const paid = Number(inv.balance_due ?? 0) <= 0.004 || inv.status === "paid";

      if (action === "proof") {
        if (closed) return fail("This invoice was cancelled, so no payment is needed.");
        if (paid) return fail("This invoice is already paid in full. Thank you!");
        return await saveProof(admin, body, inv, (inv.client as { name?: string } | null)?.name ?? "A client");
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
          subtotal: inv.subtotal, vat: inv.vat_amount, total: inv.total_amount, paid: inv.amount_paid, balance: inv.balance_due, currency: inv.currency,
        },
        lines: lines ?? [],
        proofs: proofs ?? [],
        can_pay: !closed && !paid,
        closed, fully_paid: paid && !closed,
      });
    }

    // ── Quote ────────────────────────────────────────────────────────────────
    const { data: q } = await admin.from("commercial_quotes")
      .select("id, company_id, client_id, quote_number, title, status, currency, valid_until, scope_notes, terms_and_conditions, internal_notes, subtotal, vat_amount, total_amount, deposit_required, header_values, template_id, accepted_at, declined_at, declined_reason, viewed_at, client:clients(name, legal_name, address, billing_address, email)")
      .eq("id", link.doc_id).eq("company_id", link.company_id).maybeSingle();
    if (!q || q.status === "draft") return fail("This quote is not available.", 404);
    const expired = !!q.valid_until && new Date(`${String(q.valid_until).slice(0, 10)}T23:59:59+02:00`).getTime() < Date.now();
    const open = !["accepted", "declined", "expired", "cancelled", "voided"].includes(String(q.status)) && !expired;
    const clientName = (q.client as { name?: string } | null)?.name ?? "The client";
    const hasDeposit = Number(q.deposit_required ?? 0) > 0;
    // A quotation with a deposit is paid from this page, so its banking shows like on an invoice.
    if (hasDeposit && company.show_bank_on_invoices !== false && !company.bank_account_number) {
      const { data: bank } = await admin.from("companies")
        .select("bank_account_holder, bank_name, bank_account_number, bank_branch_code, bank_account_type, bank_swift_code")
        .eq("id", link.company_id).maybeSingle();
      Object.assign(company, bank ?? {});
    }
    // The deposit invoice issued when the quotation was accepted (piece 8): the client pays it from here.
    const depositInvoice = async () => {
      if (!hasDeposit || q.status !== "accepted") return null;
      const { data } = await admin.from("finance_invoices")
        .select("id, company_id, client_id, invoice_number, status, currency, due_date, total_amount, amount_paid, balance_due")
        .eq("company_id", q.company_id).eq("quote_id", q.id).not("status", "in", "(draft,voided,cancelled)")
        .order("created_at").limit(1).maybeSingle();
      return data;
    };

    if (action === "proof") {
      const inv = await depositInvoice();
      if (!inv) return fail("There is no deposit to pay on this quote yet.");
      if (Number(inv.balance_due ?? 0) <= 0.004 || inv.status === "paid") return fail("The deposit is already paid. Thank you!");
      return await saveProof(admin, body, inv, clientName);
    }

    if (action === "ask") {
      const text = String(body.body ?? "").trim().slice(0, 2000);
      const who = String(body.name ?? "").trim().slice(0, 120) || clientName;
      if (text.length < 2) return fail("Please type your question.");
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await admin.from("document_messages").select("id", { count: "exact", head: true })
        .eq("doc_id", q.id).eq("from_client", true).gte("created_at", since);
      if ((count ?? 0) >= 10) return fail("Too many questions today. Please contact us directly.", 429);
      const { data: msg, error: mErr } = await admin.from("document_messages").insert({
        company_id: q.company_id, kind: "quote", doc_id: q.id, from_client: true, author_name: who, body: text,
      }).select("id").single();
      if (mErr) return fail("Your question could not be sent. Please try again.", 500);
      await admin.rpc("_notify_office", {
        p_company_id: q.company_id, p_type: "quote_question",
        p_title: `${clientName} asked about quote ${q.quote_number ?? ""}`.trim(),
        p_body: `${who}: ${text.length > 160 ? text.slice(0, 157) + "…" : text}`,
        p_ref_type: "quote", p_ref_id: q.id, p_key: `quote_question:${msg.id}`, p_data: { quote_id: q.id, message_id: msg.id },
      });
      return json({ ok: true, message: `Sent. ${companyName} will answer here, and you'll see it when you open this link.` });
    }

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
        // The client's choices between a line and its options (only this quote's option lines count).
        const choices = (Array.isArray(body.choices) ? body.choices : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
        let chosen = 0;
        if (choices.length) {
          const { data: n, error: chErr } = await admin.rpc("_quote_apply_choices", { p_quote_id: q.id, p_choices: choices });
          if (chErr) return fail("Your choices could not be saved. Please try again.", 500);
          chosen = Number(n ?? 0);
        }
        const { data: fresh } = await admin.from("commercial_quotes").select("total_amount, deposit_required").eq("id", q.id).maybeSingle();
        const { error } = await admin.from("commercial_quotes").update({
          status: "accepted", accepted_at: now, updated_at: now,
          internal_notes: [q.internal_notes, `Accepted online by ${name} on ${now.slice(0, 10)}${chosen ? ` (chose ${chosen} option${chosen === 1 ? "" : "s"})` : ""}.`].filter(Boolean).join("\n"),
        }).eq("id", q.id).eq("status", q.status);
        if (error) return fail("Something went wrong. Please try again.", 500);
        // The acceptance step makes the invoice (a deposit invoice when there is a deposit); this returns it.
        const { data: invId, error: cErr } = await admin.rpc("_quote_accept_invoice", { p_quote_id: q.id });
        const deposit = Number(fresh?.deposit_required ?? q.deposit_required ?? 0);
        await admin.rpc("_notify_office", {
          p_company_id: q.company_id, p_type: "quote_accepted_online",
          p_title: `${clientName} accepted quote ${q.quote_number ?? ""}`.trim(),
          p_body: `${name} accepted ${q.quote_number ?? "the quote"} (${rand(fresh?.total_amount ?? q.total_amount, q.currency)}) online.${cErr ? "" : deposit > 0 ? " The deposit invoice was sent to them on the quotation page." : " A draft invoice is ready for you to check and send."}`,
          p_ref_type: cErr ? "quote" : "invoice", p_ref_id: cErr ? q.id : String(invId), p_key: `quote_accepted:${q.id}`,
          p_data: { quote_id: q.id, invoice_id: cErr ? null : invId, accepted_by: name },
        });
        return json({ ok: true, message: deposit > 0
          ? `Thank you, ${name}! ${companyName} has your acceptance. Please pay the deposit of ${rand(deposit, q.currency)} below to confirm.`
          : `Thank you, ${name}! Your acceptance has been sent to ${companyName}.` });
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
    const [{ data: lines }, { data: tpl }, { data: messages }, inv] = await Promise.all([
      admin.from("commercial_quote_lines")
        .select("id, description, quantity, unit, unit_sell_price, subtotal_sell, vat_amount, line_total, sort_order, is_excluded, section_heading, extra, option_of, recurring_period")
        .eq("quote_id", q.id).order("sort_order"),
      q.template_id
        ? admin.from("quote_templates").select("features, header_fields, columns").eq("id", q.template_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from("document_messages").select("from_client, author_name, body, created_at").eq("doc_id", q.id)
        .order("created_at").limit(100),
      depositInvoice(),
    ]);
    const nowIso = new Date().toISOString();
    await admin.from("document_links").update({
      view_count: (link.view_count ?? 0) + 1, last_viewed_at: nowIso, first_viewed_at: link.first_viewed_at ?? nowIso,
    }).eq("token", token);
    if (!q.viewed_at) await admin.from("commercial_quotes").update({ viewed_at: nowIso }).eq("id", q.id);

    // Only what the client may see: no cost, margin or team-only columns, no internal fields.
    const features: string[] = tpl?.features ?? [];
    const sections = features.includes("sections");
    const columns = ((tpl?.columns ?? []) as { key: string; label: string; visible?: boolean; team_only?: boolean }[])
      .filter((c) => c.visible !== false && !c.team_only && c.key !== "cost" && c.key !== "margin")
      .map((c) => ({ key: c.key, label: c.label }));
    const extraKeys = new Set(columns.map((c) => c.key));
    const clean = (l: Record<string, unknown>) => {
      const x = (l.extra ?? {}) as Record<string, unknown>;
      const extra: Record<string, string> = {};
      for (const [k, v] of Object.entries(x)) if ((extraKeys.has(k) || k === "days" || k === "note") && v != null && v !== "") extra[k] = String(v);
      return {
        id: l.id, description: l.description, quantity: l.quantity, unit: l.unit, unit_sell_price: l.unit_sell_price,
        subtotal_sell: l.subtotal_sell, vat_amount: l.vat_amount, line_total: l.line_total, section: sections ? l.section_heading : null,
        extra, option_of: l.option_of, recurring_period: l.recurring_period, is_contingency: x.kind === "contingency",
      };
    };
    // A chosen option takes its line's place in the order.
    const sortOf = new Map(((lines ?? []) as Record<string, unknown>[]).map((l) => [String(l.id), Number(l.sort_order ?? 0)]));
    const all = ((lines ?? []) as Record<string, unknown>[])
      .map((l) => ({ l, k: l.option_of && !l.is_excluded ? (sortOf.get(String(l.option_of)) ?? Number(l.sort_order ?? 0)) : Number(l.sort_order ?? 0) }))
      .sort((a, b) => a.k - b.k).map((x) => x.l);
    const hv = (q.header_values ?? {}) as Record<string, string>;
    const HEADER: Record<string, string> = { vehicle: "Vehicle / machine", client_order_no: "Client order no.", event_date: "Event date", site_address: "Site address", contract_term: "Contract term" };
    const depPct = Number(hv.__deposit_pct ?? 0) || (hasDeposit && Number(q.total_amount) > 0 ? Math.round(Number(q.deposit_required) / Number(q.total_amount) * 10000) / 100 : 0);
    const recurring: Record<string, number> = {};
    for (const l of all) {
      if (l.is_excluded || !l.recurring_period) continue;
      const k = String(l.recurring_period);
      recurring[k] = Math.round(((recurring[k] ?? 0) + Number(l.subtotal_sell ?? 0)) * 100) / 100;
    }
    let invProofs: unknown[] = [];
    if (inv) {
      const { data: pr } = await admin.from("finance_payment_proofs").select("status, amount, created_at").eq("invoice_id", inv.id)
        .order("created_at", { ascending: false }).limit(5);
      invProofs = pr ?? [];
    }
    return json({
      ok: true, kind: "quote", company, client: q.client,
      doc: {
        number: q.quote_number, title: q.title, status: q.status, valid_until: q.valid_until, notes: q.scope_notes,
        terms: q.terms_and_conditions, subtotal: q.subtotal, vat: q.vat_amount, total: q.total_amount,
        accepted_at: q.accepted_at, declined_at: q.declined_at, expired, currency: q.currency,
        vat_rate: Number(q.subtotal) > 0 ? Math.round(Number(q.vat_amount ?? 0) / Number(q.subtotal) * 10000) / 10000 : 0,
        header_fields: ((tpl?.header_fields ?? []) as string[]).filter((h) => (hv[h] ?? "").trim()).map((h) => ({ label: HEADER[h] ?? h, value: hv[h] })),
        deposit: hasDeposit ? { pct: depPct, amount: Number(q.deposit_required) } : null,
        recurring: Object.entries(recurring).map(([period, amount]) => ({ period, amount })),
      },
      columns,
      // Counted lines (as before), and the options the client can choose while the quote is open.
      lines: all.filter((l) => !l.is_excluded).map(clean),
      options: open ? all.filter((l) => l.is_excluded && l.option_of).map(clean) : [],
      messages: messages ?? [],
      deposit_invoice: inv ? {
        number: inv.invoice_number, due_date: inv.due_date, total: inv.total_amount, paid: inv.amount_paid, balance: inv.balance_due,
        status: inv.status, proofs: invProofs,
      } : null,
      can_respond: open,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
});

// deno-lint-ignore no-explicit-any
type Admin = any;
type InvRow = { id: string; company_id: string; client_id: string | null; invoice_number: string | null; currency: string | null };

/** A proof of payment for an invoice (an invoice link, or a quote's deposit invoice). */
async function saveProof(admin: Admin, body: Record<string, unknown>, inv: InvRow, clientName: string): Promise<Response> {
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
  if (pErr || !proof) return fail("The proof could not be saved. Please try again.", 500);
  await admin.rpc("_notify_office", {
    p_company_id: inv.company_id, p_type: "online_payment_proof",
    p_title: `Proof of payment from ${clientName}`,
    p_body: `${clientName} sent proof of payment for invoice ${inv.invoice_number ?? ""}${amount ? ` (${rand(amount, inv.currency)})` : ""}. Check it on the invoice and record the payment.`,
    p_ref_type: "invoice", p_ref_id: inv.id, p_key: `online_proof:${proof.id}`,
    p_data: { invoice_id: inv.id, proof_id: proof.id },
  });
  return json({ ok: true, message: "Thank you! We've received your proof of payment and will confirm it shortly." });
}

type LinkRow = { company_id: string; doc_id: string; kind: string };

/** The whole-job report: view it (photos as short-lived links), sign it or say what is wrong. */
async function jobReport(admin: Admin, link: LinkRow, company: Record<string, unknown>, body: Record<string, unknown>, action: string): Promise<Response> {
  const { data: s } = await admin.from("job_signoffs")
    .select("id, company_id, job_id, scope, version, status, content, technician_name, technician_signature, technician_signed_at, client_name, client_signature, client_comment, client_signed_at, signed_via")
    .eq("id", link.doc_id).eq("company_id", link.company_id).eq("scope", "job").maybeSingle();
  if (!s || s.status === "draft") return fail("This report is not available.", 404);
  const { data: job } = await admin.from("jobs").select("job_code, title").eq("id", s.job_id).maybeSingle();

  if (action === "sign") {
    if (s.status !== "awaiting_client") {
      return fail(s.status === "signed" ? "This report is already signed." : "This report is being updated. Please wait for the new link.", 409);
    }
    const outcome = String(body.outcome ?? "");
    if (outcome !== "signed" && outcome !== "not_happy") return fail("Please sign or tell us what is wrong.");
    const name = String(body.name ?? "").trim().slice(0, 120);
    if (name.length < 2) return fail("Please type your name.");
    const comment = String(body.comment ?? "").trim().slice(0, 2000) || null;
    const signature = outcome === "signed" ? String(body.signature ?? "") : null;
    if (outcome === "signed" && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature ?? "") || (signature ?? "").length > 300000)) {
      return fail("Please sign in the box.");
    }
    if (outcome === "not_happy" && !comment) return fail("Please tell us what is wrong.");
    const { error } = await admin.from("job_signoffs").update({
      status: outcome, client_name: name, client_signature: signature, client_comment: comment,
      client_signed_at: new Date().toISOString(), signed_via: "link",
    }).eq("id", s.id).eq("status", "awaiting_client");
    if (error) return fail("It could not be saved. Please try again.", 500);
    const rating = Number(body.rating ?? 0);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      await admin.from("job_feedback").insert({
        company_id: s.company_id, job_id: s.job_id, employee_id: null, rating,
        comments: comment, submitted_at: new Date().toISOString(),
      });
    }
    return json({ ok: true, message: outcome === "signed" ? "Thank you! The report is signed." : "Thank you. We have been told and will be in touch." });
  }

  // View
  const content = (s.content ?? {}) as Record<string, unknown>;
  delete content.edits;
  const paths = ((content.photos as string[] | undefined) ?? []).filter((p) => typeof p === "string" && p);
  const photos: string[] = [];
  const storagePaths = paths.map((p) => {
    const m = p.match(/\/workforce-media\/(.+?)(\?|$)/);
    return m ? decodeURIComponent(m[1]) : /^https?:/.test(p) ? null : p;
  });
  const toSign = storagePaths.filter((p): p is string => !!p);
  const signed = toSign.length ? (await admin.storage.from("workforce-media").createSignedUrls(toSign, 3600)).data ?? [] : [];
  paths.forEach((p, i) => {
    const sp = storagePaths[i];
    const url = sp ? signed.find((x: { path: string | null; signedUrl: string }) => x.path === sp)?.signedUrl : p;
    if (url) photos.push(url);
  });
  return json({
    ok: true,
    kind: "job_report",
    company,
    report: {
      job_code: job?.job_code ?? null, job_title: job?.title ?? null, version: s.version, status: s.status, content,
      photos, technician_name: s.technician_name, technician_signature: s.technician_signature, technician_signed_at: s.technician_signed_at,
      client_name: s.client_name, client_signature: s.client_signature, client_comment: s.client_comment, client_signed_at: s.client_signed_at,
    },
    can_respond: s.status === "awaiting_client",
  });
}
