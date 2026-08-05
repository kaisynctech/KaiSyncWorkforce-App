# Attendance reliability certification

Complete on a **real device** with a **real employee code**. Mark each item PASS/FAIL.

## Pre-flight

- [ ] MAUI build includes Phase 3 (`employee_log_app_event`, punch fail-closed)
- [ ] Migration `20260528180000` applied
- [ ] Supabase dashboard open to `time_punches` + `app_events`

## E2E protocol

### A. Login & session

1. Code login → dashboard loads — ___
2. Note `app_events` row: action `code_login` — ___

### B. Clock in (online)

3. Clock in with location permission — ___
4. Verify `time_punches` row: type `in`, lat/lng non-null — ___
5. Verify `app_events`: action `punch_inserted` — ___

### C. Persistence

6. Force-kill app — ___
7. Reopen → still clocked in — ___
8. Punch history shows today's IN — ___

### D. Clock out

9. Clock out — ___
10. Verify OUT row in DB — ___
11. Hours/totals match expectation — ___

### E. Offline

12. Airplane mode ON — ___
13. Clock in (or out) — queued locally — ___
14. Verify `app_events`: `offline_punch_enqueued` — ___
15. Airplane mode OFF — ___
16. Verify replay: `offline_punch_replay` in telemetry — ___
17. DB shows punch — ___

### F. Stress

18. Rapid double-tap clock — only one punch — ___
19. Background app 5 min → resume → state correct — ___

## Certification

| Role | Name | Date | Result |
|------|------|------|--------|
| Tester | | | PASS / FAIL |

## DB verification queries

```sql
-- Latest punches for employee
select id, type, date_time, latitude, longitude, address, created_at
from time_punches
where employee_id = '<employee_uuid>'
order by date_time desc
limit 10;

-- Telemetry for session
select created_at, screen, action, level, error_text, meta
from app_events
where company_id = '<company_uuid>'
  and created_at > now() - interval '1 day'
order by created_at desc;
```
