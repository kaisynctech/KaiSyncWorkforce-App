# Field worker E2E verification (MAUI production)

Production client: **KaiFlow.Timesheets.Maui** only.  
Backend source of truth: **MAUI** `supabase/migrations/` + C# RPC contracts.

Use a real employee code on a physical device (Android or Windows). HR JWT flows are out of scope for this checklist.

## Prerequisites

- [ ] Latest MAUI build installed on device (`dotnet build` / VS deploy)
- [ ] Supabase migrations applied (`supabase db push --linked` from MAUI project)
- [ ] Valid company code + employee code for a field worker test account
- [ ] Network available; optional second run with airplane mode for offline queue

---

## 1. Code login & session

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Open app → Employee code login | Dashboard loads with employee name |
| 1.2 | Force-close app, reopen | Auto-restores session without re-entering code |
| 1.3 | Wait 24h or revoke session in DB (optional) | App re-prompts or refreshes via `employee_refresh_code_session` |

---

## 2. Attendance (clock in/out)

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Clock **In** from dashboard | Status shows clocked in; timestamp visible |
| 2.2 | Force-close app, reopen | Still clocked in; last punch visible |
| 2.3 | Clock **Out** | Status shows clocked out |
| 2.4 | Open punch history | Today’s in/out punches listed (RPC read, not empty) |
| 2.5 | (Optional) Enable airplane mode → clock in → restore network | Offline queue replays; punch appears in history |

**Telemetry:** Debug output should show `[EVENT] offline_punch_replay` or punch RPC errors if failure.

---

## 3. Jobs & job card

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Open assigned job from dashboard | Job details load via `employee_get_job_for_employee` |
| 3.2 | Open job card | Checklist, photos, on-site status load |
| 3.3 | Toggle checklist item | Persists after reload |
| 3.4 | Record inventory usage | Item appears in used-inventory list after reload |

---

## 4. Messaging (code-login RPC path)

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Messages → Direct tab | Peer threads load (not empty if threads exist) |
| 4.2 | Open a direct thread | Messages load ascending |
| 4.3 | Send a message | Appears in thread; survives reload |
| 4.4 | Company feed tab | Feed thread visible; messages load |
| 4.5 | Send company feed message | Appears after reload |
| 4.6 | New direct message → pick colleague | Thread created via `employee_get_or_create_direct_thread_peer` |

---

## 5. Work teams & directory

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Dashboard teams section | Teams load via `employee_get_work_teams` |
| 5.2 | New direct message colleague list | Peers load via `employee_list_company_peers` |

---

## 6. Sign-off

| Result | Tester | Date | Build version | Notes |
|--------|--------|------|---------------|-------|
| PASS / FAIL | | | | |

---

## RPC smoke (optional, from dev machine)

From `KaiFlow.Timesheets.Maui/supabase/smoke/`:

```powershell
.\pre_deploy_probe.ps1
```

After deploy, re-run and confirm messaging/inventory/punch RPCs return **200** (no PGRST203).
