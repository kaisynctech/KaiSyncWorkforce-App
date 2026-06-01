# Platform admin smoke test

Use this checklist after deploying platform SaaS migrations or before onboarding a pilot tenant. Replace `<test_company_id>` with a real company UUID.

**Operator account:** `kaisynctech@gmail.com` (must exist in `platform_admins`).

---

## Pre-flight

### Confirm platform admin access

```sql
SELECT pa.*, u.email
FROM public.platform_admins pa
JOIN auth.users u ON u.id = pa.auth_user_id
WHERE lower(u.email) = lower('kaisynctech@gmail.com');
```

Expected: one row, `role = 'owner'`, `is_active = true`.

If missing:

```sql
INSERT INTO public.platform_admins (auth_user_id, email, role, is_active)
SELECT u.id, u.email, 'owner', true
FROM auth.users u
WHERE lower(u.email) = lower('kaisynctech@gmail.com')
ON CONFLICT (auth_user_id) DO UPDATE SET role = 'owner', is_active = true;
```

### Confirm migrations

```sql
SELECT version FROM supabase_migrations.schema_migrations
WHERE version LIKE '202605293%'
ORDER BY version;
```

Expected: `20260529300000` through `20260529330000`.

### Pick a test company

```sql
SELECT id, name, code, subscription_active
FROM public.companies
ORDER BY created_at DESC
LIMIT 5;
```

---

## App smoke test (by tab)

### A. Access

| Step | Action | Expected |
|------|--------|----------|
| A1 | Sign in as platform admin | HR dashboard loads |
| A2 | Sidebar shows **Platform Console** | Visible for admin only |
| A3 | Open Platform Console | Platform Administration page |
| A4 | **← HR Console** | Returns to HR dashboard |
| A5 | Sign in as non-admin HR user | Platform Console hidden |

### B. Overview

| Step | Action | Expected |
|------|--------|----------|
| B1 | Overview tab (default) | KPI cards load |
| B2 | Check KPIs | Companies, employees, MAU, MRR, errors, pending feedback |
| B3 | Trend charts | Company growth, revenue, active users, errors render |

### C. Companies

| Step | Action | Expected |
|------|--------|----------|
| C1 | Companies tab | List loads |
| C2 | Search by name/code | List filters |
| C3 | Select a company | Row selected (for Health tab) |
| C4 | **Refresh billing** | Monthly charge updates |
| C5 | **Suspend** test company | Status → suspended |
| C6 | **Activate** same company | Status → active |

**Billing math (30 employees):** R2,500 + (5 × R99) = **R2,995**

```sql
SELECT employee_count, monthly_charge, status, updated_at
FROM public.company_subscriptions
WHERE company_id = '<test_company_id>';
```

### D. Subscriptions

| Step | Action | Expected |
|------|--------|----------|
| D1 | Subscriptions tab | Companies with employee count + charge |
| D2 | After refresh billing | Charge matches Companies tab |

### E. Feedback (admin)

| Step | Action | Expected |
|------|--------|----------|
| E1 | Submit feedback from Settings (tenant) | See section F |
| E2 | Feedback tab | Item appears, status **New** |
| E3 | **Planned** | Status → Planned |
| E4 | **Completed** | Optional version prompt; status → Completed |

### F. Tenant feedback

| Step | Action | Expected |
|------|--------|----------|
| F1 | Settings → **Send Feedback** | Page opens |
| F2 | Submit empty message | Validation error |
| F3 | Submit Feature Request | Thank-you alert; item in admin Feedback tab |

### G. Health

| Step | Action | Expected |
|------|--------|----------|
| G1 | Select company on Companies tab | — |
| G2 | Health tab | Score, status, last login, active users, errors, billing |

```sql
SELECT public.platform_customer_health('<test_company_id>'::uuid);
```

| Score | Status |
|-------|--------|
| ≥ 70 | Healthy |
| 40–69 | At Risk |
| < 40 | Inactive |

### H. Reports

| Step | Action | Expected |
|------|--------|----------|
| H1 | Export Excel | File with company table |
| H2 | Export PDF | KPI summary PDF |

### I. Support & Audit

| Step | Action | Expected |
|------|--------|----------|
| I1 | Support tab + note for selected company | Note saved |
| I2 | Audit tab after suspend/activate | `subscription_status_changed` entry |

---

## Database flows

### Suspend company

**UI:** Companies → Suspend

**RPC:** `platform_set_subscription_status(company_id, 'suspended', note)`

| Table | Change |
|-------|--------|
| `saas_company_subscriptions` | `subscription_status → 'suspended'` |
| `companies` | `subscription_active → false` |
| `saas_platform_audit_log` | New audit row |
| `app_events` | `company_suspended` |

Note: `company_subscriptions.status` syncs on **Refresh billing**, not on suspend alone.

### Reactivate company

Same RPC with `'active'`. Sets `subscription_active → true`, `billing_status → 'active'`. Telemetry: `company_reactivated`.

### Refresh billing

**RPC:** `platform_refresh_company_subscription(company_id)`

1. Count active `employees` for company
2. Load `saas_company_subscriptions` + `saas_plans`
3. `monthly_charge = kaiflow_calculate_monthly_charge(count, 2500, 25, 99)`
4. Update `saas_company_subscriptions.current_employee_count` and `amount_due`
5. Upsert `company_subscriptions` snapshot

Telemetry: `subscription_created` (first row) or `subscription_updated`.

### Submit feedback (tenant)

INSERT into `platform_feedback` (status `New`). Telemetry: `feedback_submitted`.

---

## Post-test verification SQL

```sql
SELECT count(*) FROM platform_admins pa
JOIN auth.users u ON u.id = pa.auth_user_id
WHERE lower(u.email) = 'kaisynctech@gmail.com' AND pa.is_active;

SELECT * FROM company_subscriptions WHERE company_id = '<test_company_id>';

SELECT subscription_status, current_employee_count, amount_due
FROM saas_company_subscriptions WHERE company_id = '<test_company_id>';

SELECT action, created_at FROM saas_platform_audit_log ORDER BY created_at DESC LIMIT 5;

SELECT action, created_at FROM app_events
WHERE action IN ('company_suspended','company_reactivated','feedback_submitted','subscription_updated')
ORDER BY created_at DESC LIMIT 10;
```

---

## Known gaps

1. **Revenue chart** — empty until paid rows exist in `saas_billing_transactions`.
2. **Suspend vs snapshot** — run Refresh billing to sync `company_subscriptions.status`.
3. **MRR** — only counts `company_subscriptions` where status is `active` or `trialing`.
