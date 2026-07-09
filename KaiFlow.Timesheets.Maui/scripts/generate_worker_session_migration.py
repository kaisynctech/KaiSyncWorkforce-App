#!/usr/bin/env python3
"""Generate worker session enforcement migration from latest anon-granted RPC definitions."""
from __future__ import annotations

import re
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
OUT = MIGRATIONS / "20260601120000_worker_session_enforcement_rpcs.sql"

EXCLUDE = {
    "employee_resolve_by_code",
    "employee_sign_in_with_code",
    "employee_refresh_code_session",
    "employee_revoke_code_session",
    "employee_validate_session",
    "employee_get_my_memberships_by_code",
    "employee_self_register",
}

EXTRA_ANON = {
    "sync_operational_pa_tasks",
    "upsert_employee_pa_settings",
    "enqueue_pa_task_notifications",
    "message_unread_counts_for_threads",
    "message_company_feed_unread_count",
}

CUSTOM_GUARD: dict[str, str] = {
    "employee_get_my_notifications_for_employee": (
        "  PERFORM public._assert_worker_access_by_employee(p_employee_id, p_session_token);\n"
    ),
    "employee_mark_notification_read_for_employee": (
        "  PERFORM public._assert_worker_access_by_employee(p_employee_id, p_session_token);\n"
    ),
    "employee_update_leave_request": (
        "  PERFORM public._assert_worker_access_by_employee(p_employee_id, p_session_token);\n"
    ),
    "employee_send_company_feed_message": (
        "  PERFORM public._assert_worker_access(p_company_id, p_sender_employee_id, p_session_token);\n"
    ),
    "employee_send_thread_message": (
        "  PERFORM public._assert_worker_access(p_company_id, p_sender_employee_id, p_session_token);\n"
    ),
    "employee_get_direct_peer_thread_map": (
        "  PERFORM public._assert_worker_access(p_company_id, p_my_employee_id, p_session_token);\n"
    ),
    "employee_find_direct_thread_peer": (
        "  PERFORM public._assert_worker_access(p_company_id, p_from_id, p_session_token);\n"
    ),
    "employee_get_or_create_direct_thread_peer": (
        "  PERFORM public._assert_worker_access(p_company_id, p_creator_id, p_session_token);\n"
    ),
    "employee_create_job": (
        "  PERFORM public._assert_worker_access(p_company_id, p_creator_employee_id, p_session_token);\n"
    ),
    "sync_operational_pa_tasks": (
        "  IF p_scope_employee_id IS NOT NULL THEN\n"
        "    PERFORM public._assert_worker_access(p_company_id, p_scope_employee_id, p_session_token);\n"
        "  ELSIF auth.uid() IS NULL THEN\n"
        "    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';\n"
        "  END IF;\n"
    ),
    "enqueue_pa_task_notifications": (
        "  PERFORM public._assert_worker_access(\n"
        "    p_company_id,\n"
        "    (SELECT s.employee_id FROM public.employee_code_sessions s\n"
        "     WHERE s.session_token = p_session_token AND s.company_id = p_company_id\n"
        "       AND s.revoked_at IS NULL AND s.expires_at > now() LIMIT 1),\n"
        "    p_session_token\n"
        "  );\n"
    ),
}

INTERNAL_CALLS = [
    (r"public\.employee_get_job_for_employee\(([^)]*?)\)", r"public.employee_get_job_for_employee(\1, p_session_token)"),
    (r"public\.employee_get_job_card_for_employee\(([^)]*?)\)", r"public.employee_get_job_card_for_employee(\1, p_session_token)"),
    (r"public\.employee_mark_thread_read_for_worker\(([^)]*?)\)", r"public.employee_mark_thread_read_for_worker(\1, p_session_token)"),
    (r"public\.employee_job_site_sign_in\(([^)]*?)\)", r"public.employee_job_site_sign_in(\1, p_session_token)"),
    (r"public\.message_unread_counts_for_threads\(([^)]*?)\)", r"public.message_unread_counts_for_threads(\1, p_session_token)"),
]


def parse_param_type(part: str) -> str:
    part = re.split(r"\s+default\s+", part.strip(), maxsplit=1, flags=re.I)[0].strip()
    if not part:
        return ""
    if part.lower().endswith(" precision") and "double" in part.lower():
        return "double precision"
    tokens = part.split()
    return tokens[-1]


def split_params(args: str) -> list[str]:
    parts: list[str] = []
    cur: list[str] = []
    depth = 0
    for ch in args:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    tail = "".join(cur).strip()
    if tail:
        parts.append(tail)
    return parts


def arg_types_from_def(defn: str) -> str:
    m = re.search(r"(?is)function\s+public\.[a-z0-9_]+\s*\(([^)]*)\)", defn)
    if not m:
        return ""
    types = [parse_param_type(p) for p in split_params(m.group(1)) if p.strip()]
    return ", ".join(t for t in types if t)


def extract_functions(text: str) -> list[tuple[str, str, str]]:
    results: list[tuple[str, str, str]] = []
    pattern = re.compile(r"(?is)create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\(")
    for m in pattern.finditer(text):
        name = m.group(1)
        i = m.end()
        depth = 1
        while i < len(text) and depth:
            ch = text[i]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            i += 1
        body_start = re.search(r"(?is)\s*returns\s", text[i:])
        if not body_start:
            continue
        j = i + body_start.start()
        dollar = re.search(r"(?is)\bas\s+\$\$", text[j:])
        if not dollar:
            continue
        k = j + dollar.end()
        end = text.find("$$;", k)
        if end < 0:
            continue
        full = text[m.start() : end + 3]
        sig = arg_types_from_def(full)
        results.append((name, sig, full))
    return results


def parse_anon_grants() -> set[str]:
    grants: set[str] = set()
    grant_re = re.compile(
        r"GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.([a-z0-9_]+)\s*\([^)]*\)\s+TO\s+anon",
        re.IGNORECASE,
    )
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name == OUT.name:
            continue
        for m in grant_re.finditer(path.read_text(encoding="utf-8", errors="replace")):
            grants.add(m.group(1))
    grants.update(EXTRA_ANON)
    return grants


def default_guard(defn: str, name: str) -> str:
    if name in CUSTOM_GUARD:
        return CUSTOM_GUARD[name]
    if "p_company_id" in defn and "p_employee_id" in defn:
        return "  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);\n"
    if "p_employee_id" in defn:
        return "  PERFORM public._assert_worker_access_by_employee(p_employee_id, p_session_token);\n"
    if "p_company_id" in defn and "p_my_employee_id" in defn:
        return "  PERFORM public._assert_worker_access(p_company_id, p_my_employee_id, p_session_token);\n"
    return "  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);\n"


def add_session_param(defn: str) -> str:
    if re.search(r"p_session_token\s+text", defn, re.I):
        return defn
    m = re.search(r"(?is)(create\s+or\s+replace\s+function\s+public\.[a-z0-9_]+\s*\()", defn)
    if not m:
        return defn
    start = m.end()
    depth = 1
    i = start
    while i < len(defn) and depth:
        if defn[i] == "(":
            depth += 1
        elif defn[i] == ")":
            depth -= 1
        i += 1
    insert_at = i - 1
    prefix = defn[:insert_at].rstrip()
    suffix = defn[insert_at:]
    sep = "" if prefix.endswith("(") else ",\n  "
    return prefix + sep + "p_session_token text DEFAULT NULL" + suffix


def patch_internal_calls(body: str) -> str:
    for pattern, repl in INTERNAL_CALLS:
        def _sub(m: re.Match[str]) -> str:
            args = m.group(1)
            if "p_session_token" in args:
                return m.group(0)
            return repl.replace(r"\1", args)

        body = re.sub(pattern, _sub, body)
    return body.replace(", p_session_token, p_session_token)", ", p_session_token)")


def inject_guard(defn: str, name: str) -> str:
    guard = default_guard(defn, name)
    if "_assert_worker_access" in defn:
        return defn

    if re.search(r"(?is)language\s+sql\b", defn):
        rm = re.search(
            r"(?is)(returns\s+(?:setof\s+\S+|table\s*\([^)]*\)|\S+))(.*?)(as\s+\$\$\s*)(.*?)(\$\$;)",
            defn,
        )
        if not rm:
            return defn
        returns, middle, as_kw, sql_body, close = rm.groups()
        if not re.search(r"(?is)language\s+sql\b", middle):
            return defn
        sql_body = patch_internal_calls(sql_body.strip())
        middle = re.sub(r"(?is)language\s+sql\b", "LANGUAGE plpgsql", middle)
        if re.search(r"(?is)\breturns\s+setof\b", returns) or re.search(r"(?is)\breturns\s+table\b", returns):
            body = f"{as_kw}\nBEGIN\n{guard}  RETURN QUERY\n  {sql_body.rstrip(';')};\nEND;\n{close}"
        elif re.search(r"(?is)\breturns\s+json\b", returns):
            body = f"{as_kw}\nBEGIN\n{guard}  RETURN ({sql_body.rstrip(';')});\nEND;\n{close}"
        elif re.search(r"(?is)\breturns\s+void\b", returns):
            body = f"{as_kw}\nBEGIN\n{guard}  PERFORM ({sql_body.rstrip(';')});\nEND;\n{close}"
        else:
            body = f"{as_kw}\nBEGIN\n{guard}  RETURN ({sql_body.rstrip(';')});\nEND;\n{close}"
        return defn[: rm.start()] + returns + middle + body + defn[rm.end() :]

    bm = re.search(r"(?is)(as\s+\$\$\s*)", defn)
    if not bm:
        return defn
    after = bm.end()
    begin = re.search(r"(?is)\bbegin\b", defn[after:])
    if begin:
        pos = after + begin.end()
        return defn[:pos] + "\n" + guard + defn[pos:]
    return defn


def inject_session(defn: str, name: str) -> str:
    patched = add_session_param(defn)
    body_m = re.search(r"(?is)(as\s+\$\$)(.*?)(\$\$;)", patched)
    if body_m:
        body = patch_internal_calls(body_m.group(2))
        patched = patched[: body_m.start(2)] + body + patched[body_m.end(2) :]
    patched = inject_guard(patched, name)
    return patched


def main() -> None:
    anon_grants = parse_anon_grants()
    latest: dict[str, str] = {}

    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name == OUT.name:
            continue
        for name, _sig, full in extract_functions(path.read_text(encoding="utf-8", errors="replace")):
            if name in EXCLUDE:
                continue
            if name.startswith("employee_") or name in EXTRA_ANON:
                if name in anon_grants:
                    latest[name] = full

    parts = [
        "-- ════════════════════════════════════════════════════════════════════════════",
        "-- WORKER SESSION ENFORCEMENT — Per-RPC session token binding",
        "--",
        "-- Adds p_session_token (last param) + _assert_worker_access() to all worker-facing",
        "-- employee_* RPCs (and related PA/messaging helpers) granted to anon.",
        "--",
        "-- Requires: 20260601110000_worker_session_enforcement_foundation.sql",
        "-- Regenerate: python scripts/generate_worker_session_migration.py",
        "-- ════════════════════════════════════════════════════════════════════════════",
        "",
        "SET search_path = public;",
        "",
        "-- ─── Drop pre-session overloads ────────────────────────────────────────────",
        "",
    ]

    patched_defs: dict[str, str] = {}
    for name in sorted(latest):
        full = latest[name]
        old_sig = arg_types_from_def(full)
        if old_sig:
            parts.append(f"DROP FUNCTION IF EXISTS public.{name}({old_sig});")
        patched_defs[name] = inject_session(full, name)

    parts.append("")
    parts.append("-- ─── Recreate with session enforcement ─────────────────────────────────────")
    parts.append("")

    grants_out: list[str] = []
    for name in sorted(patched_defs):
        patched = patched_defs[name]
        parts.append(f"-- {name}")
        parts.append(patched)
        parts.append("")
        sig = arg_types_from_def(patched)
        if sig:
            grants_out.append(
                f"GRANT EXECUTE ON FUNCTION public.{name}({sig}) TO anon, authenticated;"
            )

    parts.append("-- ─── Re-grant anon + authenticated ─────────────────────────────────────────")
    parts.append("")
    parts.extend(grants_out)
    parts.extend([
        "",
        "-- ════════════════════════════════════════════════════════════════════════════",
        "-- ROLLBACK NOTES (manual)",
        "--   1. DROP each (... , text) overload above; redeploy prior bodies from source migrations.",
        "--   2. Revert client RPC calls that pass p_session_token.",
        "--   3. _assert_worker_access helpers from foundation migration may remain.",
        "-- ════════════════════════════════════════════════════════════════════════════",
    ])

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"Wrote {len(patched_defs)} functions to {OUT}")


if __name__ == "__main__":
    main()
