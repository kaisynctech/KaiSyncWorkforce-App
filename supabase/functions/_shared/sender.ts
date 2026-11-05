// supabase/functions/_shared/sender.ts
//
// Who an email comes from, and who it is copied to. Used by every function that emails a client,
// supplier or employee.
//
//   personal → quotes, invoices, credit notes, statements and manual reminders, purchase orders, RFQs.
//              Shows the person who pressed Send ("Thabo Mokoena (Ironvale Construction)"); replies go to
//              their login email. Once the company's domain is verified and their login email is on that
//              domain, it is sent from their own address.
//   company  → receipts, remittance advice, payslips, automatic reminders, recurring invoices.
//              Shows the company name; replies go to the company email.
//
// It is never sent *from* a Gmail/Outlook address: email providers reject mail that claims to come from
// a domain we haven't verified. The sending address is the company's verified one, or ours.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type SendMode = "personal" | "company";
export type Sender = {
  from: string;            // "Display name" <address>
  replyTo: string | null;
  personName: string | null; // for the sign-off; null when sent in the company's name
};

export const validEmail = (e: unknown) => {
  const v = String(e ?? "").trim();
  return /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/.test(v) ? v : "";
};
const cleanName = (s: unknown) => String(s ?? "").replace(/["<>\r\n()]/g, "").replace(/\s+/g, " ").trim().slice(0, 70);

/** Up to 10 valid, de-duplicated CC addresses, without the main recipient. */
export function cleanCc(list: unknown, to: string): string[] {
  const out: string[] = [];
  const seen = new Set([to.toLowerCase()]);
  for (const raw of Array.isArray(list) ? list : []) {
    const e = validEmail(raw);
    if (!e || seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase());
    out.push(e);
    if (out.length >= 10) break;
  }
  return out;
}

export async function senderFor(
  admin: SupabaseClient,
  opts: { companyId: string; companyName: string; companyEmail: string | null; user: { id: string; email?: string | null } | null; mode: SendMode },
): Promise<Sender> {
  const configured = (Deno.env.get("NOTIFY_FROM_EMAIL") ?? "").trim() || "no-reply@kaisyncworkforce.com";
  const base = (configured.match(/<([^>]+)>/)?.[1] ?? configured).trim();
  // The company's own address once its domain is verified (Settings → General), otherwise ours.
  const { data: own } = await admin.rpc("company_sender_address", { p_company_id: opts.companyId });
  const ownAddress = typeof own === "string" && own ? own : null;
  const companyName = cleanName(opts.companyName) || "Our company";
  const companyEmail = validEmail(opts.companyEmail);
  const userEmail = validEmail(opts.user?.email);

  if (opts.mode === "personal" && opts.user) {
    const { data: emp } = await admin.from("employees").select("name, surname")
      .eq("company_id", opts.companyId).eq("user_id", opts.user.id).limit(1).maybeSingle();
    const person = cleanName([emp?.name, emp?.surname].filter(Boolean).join(" ")) || null;
    const domain = ownAddress ? ownAddress.split("@")[1].toLowerCase() : null;
    const address = domain && userEmail.toLowerCase().endsWith(`@${domain}`) ? userEmail : (ownAddress ?? base);
    const display = person ? `${person} (${companyName})` : companyName;
    return { from: `"${display.slice(0, 120)}" <${address}>`, replyTo: userEmail || companyEmail || null, personName: person };
  }
  return { from: `"${companyName}" <${ownAddress ?? base}>`, replyTo: companyEmail || userEmail || null, personName: null };
}

/** "Kind regards, Thabo Mokoena / Ironvale Construction" (HTML) for personal emails, the company otherwise. */
export function signOffHtml(esc: (s: unknown) => string, sender: Sender, companyName: string): string {
  return sender.personName
    ? `Kind regards,<br><strong>${esc(sender.personName)}</strong><br>${esc(companyName)}`
    : `Kind regards,<br><strong>${esc(companyName)}</strong>`;
}
export function signOffText(sender: Sender, companyName: string): string {
  return sender.personName ? `Kind regards,\n${sender.personName}\n${companyName}` : `Kind regards,\n${companyName}`;
}
