// supabase/functions/_shared/compose.ts
//
// Editable emails. Every email function can return a preview (subject, the message as plain text, and the
// finished HTML) without sending, and accepts the user's edited subject and message when sending.
// Only the message text is editable; the greeting, the online button, item tables, attachments and the
// sign-off stay as built by the server.

/** HTML paragraph → plain text for the editable message box. */
export function htmlToText(h: string): string {
  return h.replace(/<br\s*\/?>/g, "\n").replace(/<\/tr>/g, "\n").replace(/<\/td>/g, "  ").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&middot;/g, "·").replace(/&amp;/g, "&").trim();
}

/** The user's edited message → escaped HTML paragraphs (blank line = new paragraph). */
export function textToParas(text: string, esc: (s: unknown) => string): string[] {
  return text.replace(/\r\n/g, "\n").slice(0, 6000).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => esc(p).replace(/\n/g, "<br>"));
}

/** An edited message, or null when none was sent (then the standard wording is used). */
export function editedText(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
}

export function editedSubject(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : "";
  return s || null;
}
