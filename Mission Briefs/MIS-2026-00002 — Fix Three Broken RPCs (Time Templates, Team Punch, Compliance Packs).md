# MIS-2026-00002 — Fix Three Broken RPCs

**Mission ID:** MIS-2026-00002  
**Priority:** Critical  
**Affects:** kaisync-web — time-templates, team-punch, compliance-packs pages  
**Gap reference:** GAP-53, GAP-56, GAP-57, GAP-58  

---

## Summary

Three pages that were considered complete are silently broken because they call Supabase RPCs that either do not exist or have the wrong name. This Mission fixes all three with the correct RPC calls, and adds the missing DB functions for Team Punch and Compliance Packs.

---

## Business Objective

Restore functional clock-in/out for teams, functional compliance pack management, and functional shift template defaulting — all of which are core daily operations.

---

## Current Behaviour vs Expected Behaviour

### Issue 1 — Time Templates: Wrong RPC name

**Current:**
```typescript
await supabase.rpc('set_default_shift_template', { template_id: id })
```
**Problem:** `set_default_shift_template` does not exist. The correct RPC is `hr_set_default_shift_template` and it requires `p_company_id` as well.

**Expected:**
```typescript
await supabase.rpc('hr_set_default_shift_template', {
  p_company_id: companyId,
  p_template_id: id,
})
```

---

### Issue 2 — Team Punch: RPCs do not exist in DB

**Current:**
```typescript
await supabase.rpc('team_clock_in', { employee_ids: ids, location: { lat, lng }, address })
await supabase.rpc('team_clock_out', { employee_ids: ids, location: { lat, lng }, address })
```
**Problem:** Neither `team_clock_in` nor `team_clock_out` exists in the database. The entire Team Punch page is non-functional.

**Expected:** Two new Postgres functions must be created, then called from the web page.

---

### Issue 3 — Compliance Packs: RPCs do not exist in DB

**Current:**
```typescript
await supabase.rpc('upsert_compliance_pack', { ... })
await supabase.rpc('set_default_compliance_pack', { pack_id: packId })
```
**Problem:** Neither RPC exists in the database. Saving a pack or setting a default silently fails.

**Expected:** Two new Postgres functions must be created, then called correctly.

---

## Architecture

### Fix 1 — Time Templates (web-only change)

In `src/app/dashboard/time-templates/page.tsx`, find the `handleSetDefault` function and change:

```typescript
// BEFORE
try { await supabase.rpc('set_default_shift_template', { template_id: id }) } catch {}

// AFTER
const { error } = await supabase.rpc('hr_set_default_shift_template', {
  p_company_id: companyId,
  p_template_id: id,
})
if (error) console.error('set default template:', error.message)
```

The `companyId` state variable is already resolved earlier in the `load()` function — store it in state and pass it here.

---

### Fix 2 — Team Punch (DB migration + web change)

#### New DB function: `hr_team_clock_in`

```sql
CREATE OR REPLACE FUNCTION public.hr_team_clock_in(
  p_company_id uuid,
  p_employee_ids uuid[],
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_address text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_now timestamptz := now();
BEGIN
  FOREACH v_employee_id IN ARRAY p_employee_ids LOOP
    -- Only clock in employees not already clocked in
    IF NOT EXISTS (
      SELECT 1 FROM attendance_sessions
      WHERE company_id = p_company_id
        AND employee_id = v_employee_id
        AND punch_out IS NULL
    ) THEN
      INSERT INTO attendance_sessions (
        company_id, employee_id, punch_in,
        latitude, longitude, address
      ) VALUES (
        p_company_id, v_employee_id, v_now,
        p_latitude, p_longitude, p_address
      );
    END IF;
  END LOOP;
END;
$$;
```

#### New DB function: `hr_team_clock_out`

```sql
CREATE OR REPLACE FUNCTION public.hr_team_clock_out(
  p_company_id uuid,
  p_employee_ids uuid[],
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_address text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_now timestamptz := now();
BEGIN
  FOREACH v_employee_id IN ARRAY p_employee_ids LOOP
    UPDATE attendance_sessions
    SET 
      punch_out = v_now,
      punch_out_latitude = p_latitude,
      punch_out_longitude = p_longitude,
      punch_out_address = p_address
    WHERE company_id = p_company_id
      AND employee_id = v_employee_id
      AND punch_out IS NULL;
  END LOOP;
END;
$$;
```

#### Web change in `src/app/dashboard/team-punch/page.tsx`

```typescript
// BEFORE
await supabase.rpc('team_clock_in', { employee_ids: ids, location: { lat, lng }, address })
await supabase.rpc('team_clock_out', { employee_ids: ids, location: { lat, lng }, address })

// AFTER
await supabase.rpc('hr_team_clock_in', {
  p_company_id: companyId,
  p_employee_ids: ids,
  p_latitude: lat ?? null,
  p_longitude: lng ?? null,
  p_address: address ?? null,
})

await supabase.rpc('hr_team_clock_out', {
  p_company_id: companyId,
  p_employee_ids: ids,
  p_latitude: lat ?? null,
  p_longitude: lng ?? null,
  p_address: address ?? null,
})
```

The `companyId` is already resolved in `loadTeams()` — store it in state and use it in the clock functions.

---

### Fix 3 — Compliance Packs (DB migration + web change)

#### New DB function: `hr_upsert_compliance_pack`

```sql
CREATE OR REPLACE FUNCTION public.hr_upsert_compliance_pack(
  p_company_id uuid,
  p_pack_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_item_doc_type_ids uuid[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pack_id uuid := COALESCE(p_pack_id, gen_random_uuid());
BEGIN
  INSERT INTO compliance_packs (id, company_id, name, description)
  VALUES (v_pack_id, p_company_id, p_name, p_description)
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at = now();

  -- Replace items
  DELETE FROM compliance_pack_items WHERE pack_id = v_pack_id;

  INSERT INTO compliance_pack_items (pack_id, doc_type_id, requirement)
  SELECT v_pack_id, unnest(p_item_doc_type_ids), 'required';

  RETURN v_pack_id;
END;
$$;
```

#### New DB function: `hr_set_default_compliance_pack`

```sql
CREATE OR REPLACE FUNCTION public.hr_set_default_compliance_pack(
  p_company_id uuid,
  p_pack_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Clear existing default
  UPDATE compliance_packs
  SET is_default = false
  WHERE company_id = p_company_id AND is_default = true;

  -- Set new default
  UPDATE compliance_packs
  SET is_default = true
  WHERE id = p_pack_id AND company_id = p_company_id;
END;
$$;
```

#### Web change in `src/app/dashboard/compliance-packs/page.tsx`

```typescript
// BEFORE
await supabase.rpc('upsert_compliance_pack', { ... })
await supabase.rpc('set_default_compliance_pack', { pack_id: packId })

// AFTER
await supabase.rpc('hr_upsert_compliance_pack', {
  p_company_id: companyId,
  p_pack_id: editId ?? null,
  p_name: editName.trim(),
  p_description: editDesc.trim() || null,
  p_item_doc_type_ids: selectedDocTypeIds,  // array of uuid
})

await supabase.rpc('hr_set_default_compliance_pack', {
  p_company_id: companyId,
  p_pack_id: packId,
})
```

Review the existing state variables in the compliance packs page — `editName`, `editDesc`, and the items array — and map them correctly to the RPC parameters above.

---

## Database Impact

**Migrations required:**

1. `hr_team_clock_in(p_company_id uuid, p_employee_ids uuid[], ...)` — new function
2. `hr_team_clock_out(p_company_id uuid, p_employee_ids uuid[], ...)` — new function
3. `hr_upsert_compliance_pack(p_company_id uuid, p_pack_id uuid, p_name text, ...)` — new function
4. `hr_set_default_compliance_pack(p_company_id uuid, p_pack_id uuid)` — new function

**Verify before implementing:**
- Confirm the `attendance_sessions` table column names: `punch_in`, `punch_out`, `latitude`, `longitude`, `punch_out_latitude`, `punch_out_longitude`, `address`, `punch_out_address`. Check `types/database.ts` and adjust the SQL if column names differ.
- Confirm `compliance_packs` has an `is_default boolean` column. If not, add it in the migration.
- Confirm `compliance_pack_items` schema matches: `pack_id`, `doc_type_id`, `requirement`.

---

## Files to Change

| File | Change |
|---|---|
| `src/app/dashboard/time-templates/page.tsx` | Fix RPC name + pass `p_company_id` |
| `src/app/dashboard/team-punch/page.tsx` | Update both RPC calls to new names + params |
| `src/app/dashboard/compliance-packs/page.tsx` | Update both RPC calls to new names + params |
| New Supabase migration | 4 new DB functions |

---

## Regression Risks

- **Team Punch:** The new functions insert into `attendance_sessions`. Verify this is the correct table name — it may be `timesheet_punches` in some schemas. Check `types/database.ts`.
- **Compliance Packs:** The `DELETE + INSERT` pattern for pack items will remove and re-add all items on every save. This is intentional and correct.
- **Time Templates:** The RPC name fix is trivial — no data impact.

---

## Testing Requirements

1. **Time Templates:** Set a template as default — confirm the DB `is_default` flag updates correctly.
2. **Team Punch:** Select 2+ employees, clock in — confirm `attendance_sessions` rows created. Clock out — confirm `punch_out` updated.
3. **Compliance Packs:** Create a new pack, add doc types, save — confirm pack and items saved in DB. Set as default — confirm `is_default` flag updated.

---

## Acceptance Criteria

- [ ] Time Templates "Set Default" works without error
- [ ] Team Punch clock-in creates `attendance_sessions` rows for all selected employees
- [ ] Team Punch clock-out updates `punch_out` on those rows
- [ ] Compliance Packs save creates/updates pack and items in DB
- [ ] Compliance Packs set-default updates `is_default` flag
- [ ] No TypeScript errors

---

## Definition of Done

- 4 DB migrations applied and verified
- 3 page.tsx files updated with corrected RPC calls
- All features manually tested end-to-end
