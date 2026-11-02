-- Ironvale Construction (Playground) only: about 6 months of realistic made-up history
-- (May–Oct 2026) so Insights can be designed and tested. Approved 30 Oct 2026.
-- Every row carries the marker 'seed:insights' (or a seeded client) so it can be removed:
--   time_punches.notes, jobs.external_ref, leave_requests.reason, incident_reports.resolution_notes,
--   commercial_quotes.internal_notes, finance_invoices.notes, finance_transactions.notes,
--   payment_approvals.notes, clients.notes; lines and ledger rows hang off seeded quotes/invoices.
-- Uses only Ironvale's non-linked clients, so no Linked-company alerts fire.

DO $seed$
DECLARE
  c_co   constant uuid := 'ac99a73d-3768-4191-b8c3-550802d1ae26';
  c_own  constant uuid := 'f00a8257-57c3-48ba-9eec-8852f16ed969';
  c_emp  constant uuid := '969ae488-d4d3-4f45-ad77-2f9741b821c2';  -- the owner's employee record (finance tables point at employees)
  c_mark constant text := 'seed:insights';
  c_from constant date := date '2026-05-01';
  c_to   constant date := date '2026-10-29';
  v_clients uuid[];
  v_techs uuid[];
  v_services uuid[] := array['adfc68b5-2c4e-41f1-a0d0-62cb35b83351','68679084-e4ec-4e6d-8619-a760b416fe08']::uuid[];
  v_titles text[] := array['Replace damaged ceiling boards','Repair storm-water drain','Install site lighting','Fix leaking roof sheets',
    'Concrete slab repair','Paint external walls','Replace security fencing','Tile bathroom block','Plumbing repair — ablution block',
    'Electrical fault finding','Install steel staircase','Waterproof parking deck','Repair boundary wall','Service generator',
    'Install air-conditioning units','Replace fire doors','Kerb and paving repair','Glazing replacement','Install handrails','Drainage inspection'];
  v_inc text[] := array['Slip on wet scaffold board','Minor cut from angle grinder','Near miss — falling material','Vehicle reversing incident',
    'Dust exposure complaint','Trench wall collapse (no injuries)','Hand injury lifting rebar','Electrical shock — tool fault'];
  v_holidays date[] := array[date '2026-05-01', date '2026-06-16', date '2026-08-10', date '2026-09-24'];
  r record; d date; i int; v_id uuid; v_quote uuid; v_inv uuid; v_job uuid; v_client uuid;
  v_open timestamptz; v_amt numeric; v_vat numeric; v_tot numeric; v_paid numeric; v_status text;
  v_issue date; v_due date; v_num text; v_n int;
BEGIN
  PERFORM setseed(0.4242);

  -- Clients (5 new, plus SAB Rosslyn; never the linked "test company").
  INSERT INTO clients (company_id, name, type, contact_person, email, phone, notes, payment_terms_days)
  SELECT c_co, n, 'company', cp, lower(replace(split_part(n, ' ', 1), ',', '')) || '@example.test', '011 555 0' || (100 + k)::text, c_mark, 30
  FROM (VALUES ('Bluewater Developments (test)', 'Thabo Mokoena', 1), ('Gauteng Health Facilities (test)', 'Anika Pillay', 2),
               ('Midrand Retail Park (test)', 'Johan Venter', 3), ('Sandton Tower Body Corporate (test)', 'Lerato Dube', 4),
               ('Tshwane Roads Depot (test)', 'Sipho Nkosi', 5)) t(n, cp, k)
  WHERE NOT EXISTS (SELECT 1 FROM clients x WHERE x.company_id = c_co AND x.name = t.n);
  SELECT array_agg(id) INTO v_clients FROM clients
   WHERE company_id = c_co AND (notes = c_mark OR name = 'SAB Rosslyn (test)') AND linked_company_id IS NULL;

  SELECT array_agg(id) INTO v_techs FROM employees
   WHERE company_id = c_co AND is_active AND department IN ('Skilled Trades', 'Engineering', 'Site Supervision', 'Workshop & Maintenance');

  -- Leave (before attendance, so leave days have no clock-ins).
  FOR r IN SELECT id FROM employees WHERE company_id = c_co AND is_active LOOP
    FOR i IN 1 .. (floor(random() * 3))::int LOOP
      d := c_from + (floor(random() * 170))::int;
      IF extract(isodow FROM d) > 5 THEN d := d + (8 - extract(isodow FROM d))::int; END IF;
      INSERT INTO leave_requests (company_id, employee_id, leave_type, start_date, end_date, total_days, status, reason, decided_at, created_at)
      SELECT c_co, r.id, lt, d, d + (days - 1), days,
             CASE WHEN random() < 0.9 THEN 'approved' ELSE 'declined' END, c_mark,
             (d - 5)::timestamptz, (d - 7)::timestamptz
      FROM (SELECT CASE WHEN x < 0.6 THEN 'Annual Leave' WHEN x < 0.85 THEN 'Sick Leave' WHEN x < 0.95 THEN 'Family Responsibility' ELSE 'Unpaid Leave' END lt,
                   CASE WHEN x < 0.6 THEN 2 + floor(random() * 4)::int WHEN x < 0.85 THEN 1 + floor(random() * 2)::int ELSE 1 END days
            FROM (SELECT random() x) q) s
      WHERE d + (days - 1) <= c_to;
    END LOOP;
  END LOOP;
  -- A few still waiting for a decision (next month).
  INSERT INTO leave_requests (company_id, employee_id, leave_type, start_date, end_date, total_days, status, reason, created_at)
  SELECT c_co, id, 'Annual Leave', date '2026-11-09', date '2026-11-13', 5, 'pending', c_mark, now() - interval '2 days'
  FROM employees WHERE company_id = c_co AND is_active ORDER BY random() LIMIT 9;

  -- Attendance: in/out per working day from each person's shift template.
  INSERT INTO time_punches (company_id, employee_id, type, date_time, notes, created_at)
  SELECT c_co, w.employee_id, p.type, p.at, c_mark, p.at
  FROM (
    SELECT e.id employee_id, gs.dt::date wday,
           coalesce(t.start_time, time '07:00') st, coalesce(t.end_time, time '16:00') et,
           random() r_abs, random() r_late, random() r_ot, random() r_early, random() r1, random() r2
    FROM employees e
    LEFT JOIN employee_shift_templates t ON t.id = e.shift_template_id
    CROSS JOIN generate_series(c_from, c_to, interval '1 day') gs(dt)
    WHERE e.company_id = c_co AND e.is_active
      AND (e.employment_date IS NULL OR e.employment_date <= gs.dt::date)
      AND NOT (gs.dt::date = ANY (v_holidays))
      AND CASE extract(isodow FROM gs.dt)
            WHEN 6 THEN coalesce(t.name, '') ILIKE '%Sat%'
            WHEN 7 THEN coalesce(t.name, '') ILIKE '%Sun%'
            WHEN 5 THEN coalesce(t.name, '') NOT ILIKE '%Mon–Thu%'
            ELSE true END
      AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = e.id AND l.status = 'approved' AND gs.dt::date BETWEEN l.start_date AND l.end_date)
      AND NOT EXISTS (SELECT 1 FROM time_punches x WHERE x.employee_id = e.id AND x.date_time >= gs.dt AND x.date_time < gs.dt + interval '1 day')
  ) w
  CROSS JOIN LATERAL (VALUES
    ('in',  ((w.wday + w.st) AT TIME ZONE 'Africa/Johannesburg')
              + CASE WHEN w.r_late < 0.07 THEN make_interval(mins => 5 + floor(w.r1 * 40)::int)
                     ELSE -make_interval(mins => floor(w.r1 * 15)::int) END),
    ('out', ((w.wday + w.et + CASE WHEN w.et < w.st THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Africa/Johannesburg')
              + CASE WHEN w.r_ot < 0.15 THEN make_interval(mins => 30 + floor(w.r2 * 120)::int)
                     WHEN w.r_early < 0.03 THEN -make_interval(mins => 30 + floor(w.r2 * 60)::int)
                     ELSE make_interval(mins => floor(w.r2 * 20)::int) END)
  ) p(type, at)
  WHERE w.r_abs >= 0.04;

  -- Jobs (about 160), quotes (about 75), invoices and payments.
  FOR i IN 1 .. 160 LOOP
    -- In date order, so job, quote and invoice numbers run in order like real life.
    v_open := (c_from + floor((i - 1) * 178.0 / 160)::int) + make_interval(hours => 7 + floor(random() * 9)::int);
    v_client := v_clients[1 + floor(random() * array_length(v_clients, 1))::int];
    v_status := CASE
      WHEN v_open < now() - interval '21 days' THEN (CASE WHEN random() < 0.9 THEN 'completed' WHEN random() < 0.5 THEN 'cancelled' ELSE 'open' END)
      WHEN random() < 0.4 THEN 'completed' WHEN random() < 0.6 THEN 'scheduled' ELSE 'open' END;
    v_amt := round((2500 + random() * 45000)::numeric, -1);
    INSERT INTO jobs (company_id, title, description, client_id, status, priority, opened_at, created_at, updated_at,
      first_response_at, closed_at, scheduled_start, scheduled_end, assignee_employee_id, assigned_employee_ids,
      estimated_cost, actual_cost, labor_cost, is_callback, service_id, job_code, external_ref, visibility)
    VALUES (c_co, v_titles[1 + floor(random() * array_length(v_titles, 1))::int], 'Test history for Insights.', v_client, v_status,
      (array['low','medium','medium','high','critical'])[1 + floor(random() * 5)::int], v_open, v_open, v_open,
      v_open + make_interval(hours => 1 + floor(random() * 30)::int),
      CASE WHEN v_status IN ('completed','cancelled') THEN v_open + make_interval(days => 1 + floor(random() * 12)::int, hours => floor(random() * 8)::int) END,
      v_open + interval '1 day', v_open + make_interval(days => 2 + floor(random() * 5)::int),
      CASE WHEN v_status = 'open' AND random() < 0.4 THEN NULL ELSE v_techs[1 + floor(random() * array_length(v_techs, 1))::int] END,
      '{}'::uuid[], v_amt, CASE WHEN v_status = 'completed' THEN round((v_amt * (0.8 + random() * 0.45))::numeric, -1) ELSE 0 END,
      round(v_amt * 0.45, -1), random() < 0.06,
      CASE WHEN random() < 0.5 THEN v_services[1 + floor(random() * 2)::int] END,
      public._next_job_code(c_co), c_mark, 'inherit')
    RETURNING id INTO v_job;

    -- About half the jobs come from a quote; most completed jobs are invoiced.
    IF random() < 0.47 THEN
      v_vat := round(v_amt * 0.15, 2); v_tot := v_amt + v_vat;
      v_status := CASE WHEN v_open > now() - interval '10 days' THEN (CASE WHEN random() < 0.5 THEN 'sent' ELSE 'viewed' END)
                       WHEN random() < 0.62 THEN 'accepted' WHEN random() < 0.75 THEN 'declined' ELSE 'sent' END;
      INSERT INTO commercial_quotes (company_id, quote_number, client_id, job_id, title, status, currency, subtotal, vat_amount, total_amount,
        cost_total, gross_profit, gross_margin_percent, valid_until, payment_terms_days, sent_at, viewed_at, accepted_at, declined_at,
        declined_reason, internal_notes, created_by, created_at, updated_at)
      VALUES (c_co, public.generate_quote_number(c_co), v_client, v_job, (SELECT title FROM jobs WHERE id = v_job), v_status, 'ZAR',
        v_amt, v_vat, v_tot, round(v_amt * 0.68, 2), round(v_amt * 0.32, 2), 32, (v_open - interval '3 days')::date + 30, 30,
        v_open - interval '3 days', CASE WHEN v_status <> 'sent' THEN v_open - interval '2 days' END,
        CASE WHEN v_status = 'accepted' THEN v_open - interval '1 day' END,
        CASE WHEN v_status = 'declined' THEN v_open - interval '1 day' END,
        CASE WHEN v_status = 'declined' THEN (array['Price too high','Went with another contractor','Project postponed'])[1 + floor(random() * 3)::int] END,
        c_mark, c_own, v_open - interval '4 days', v_open - interval '1 day')
      RETURNING id INTO v_quote;
      INSERT INTO commercial_quote_lines (company_id, quote_id, description, item_type, quantity, unit_sell_price, subtotal_sell, cost_price,
        subtotal_cost, vat_rate, vat_amount, line_total, source_type)
      VALUES (c_co, v_quote, (SELECT title FROM jobs WHERE id = v_job), 'labour', 1, v_amt, v_amt, round(v_amt * 0.68, 2), round(v_amt * 0.68, 2),
        0.15, v_vat, v_tot, 'manual');
    END IF;

    IF (SELECT status FROM jobs WHERE id = v_job) = 'completed' AND random() < 0.85 THEN
      v_amt := coalesce(nullif((SELECT actual_cost FROM jobs WHERE id = v_job), 0), v_amt);
      v_amt := round(v_amt * 1.25, 2); v_vat := round(v_amt * 0.15, 2); v_tot := v_amt + v_vat;
      v_issue := ((SELECT closed_at FROM jobs WHERE id = v_job))::date + floor(random() * 4)::int;
      v_due := v_issue + 30;
      -- Older invoices mostly paid; recent ones open; some late payers.
      v_paid := CASE WHEN v_due < current_date - 20 THEN (CASE WHEN random() < 0.82 THEN v_tot WHEN random() < 0.5 THEN round(v_tot * 0.5, 2) ELSE 0 END)
                     WHEN v_due < current_date THEN (CASE WHEN random() < 0.55 THEN v_tot ELSE 0 END)
                     ELSE (CASE WHEN random() < 0.25 THEN v_tot ELSE 0 END) END;
      v_status := CASE WHEN v_paid >= v_tot THEN 'paid' WHEN v_paid > 0 THEN 'partially_paid'
                       WHEN v_due < current_date THEN 'overdue' ELSE 'sent' END;
      d := least(v_due + floor(random() * 25)::int - 10, current_date);
      INSERT INTO finance_invoices (company_id, client_id, job_id, invoice_number, status, currency, subtotal, vat_rate, vat_amount,
        total_amount, amount_paid, balance_due, is_vat_inclusive, tax_type, issue_date, due_date, paid_date, sent_at, notes, created_by,
        created_at, updated_at, invoice_type)
      VALUES (c_co, (SELECT client_id FROM jobs WHERE id = v_job), v_job, public.generate_invoice_number(c_co), v_status, 'ZAR',
        v_amt, 0.15, v_vat, v_tot, v_paid, v_tot - v_paid, false, 'standard', v_issue, v_due,
        CASE WHEN v_status = 'paid' THEN d END,
        v_issue::timestamptz + interval '9 hours', c_mark, c_emp, v_issue::timestamptz, v_issue::timestamptz, 'standard')
      RETURNING id, invoice_number INTO v_inv, v_num;
      INSERT INTO finance_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, subtotal, vat_rate, vat_amount, total_amount)
      VALUES (c_co, v_inv, 1, (SELECT title FROM jobs WHERE id = v_job), 1, v_amt, v_amt, 0.15, v_vat, v_tot);
      IF v_paid > 0 THEN
        INSERT INTO finance_transactions (company_id, transaction_type, direction, source_table, source_id, reference_number,
          amount, total_amount, transaction_date, payment_method, notes, created_by, created_at)
        VALUES (c_co, 'invoice', 'incoming', 'finance_invoices', v_inv, v_num, v_paid, v_paid, d, 'eft', c_mark, c_emp, d::timestamptz);
        INSERT INTO customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id, reference_number, description, debit, credit, entry_date, created_by)
        VALUES (c_co, (SELECT client_id FROM jobs WHERE id = v_job), 'payment', 'finance_invoices', v_inv, v_num, 'Payment received — ' || v_num, 0, v_paid, d, c_emp);
      END IF;
    END IF;
  END LOOP;

  -- Incidents (about 24).
  FOR i IN 1 .. 24 LOOP
    v_open := (c_from + floor(random() * 178)::int) + make_interval(hours => 7 + floor(random() * 9)::int);
    INSERT INTO incident_reports (company_id, employee_id, title, description, severity, category, status, is_closed, occurred_at,
      created_at, updated_at, resolution_notes)
    SELECT c_co, (SELECT id FROM employees WHERE company_id = c_co AND is_active ORDER BY random() LIMIT 1), t, t || ' (test history).',
      (array['low','low','medium','medium','high','critical'])[1 + floor(random() * 6)::int], 'safety',
      CASE WHEN v_open < now() - interval '14 days' AND random() < 0.85 THEN 'closed' ELSE 'open' END,
      v_open < now() - interval '14 days' AND random() < 0.85, v_open, v_open, v_open, c_mark
    FROM (SELECT v_inc[1 + floor(random() * array_length(v_inc, 1))::int] t) s;
  END LOOP;
  UPDATE incident_reports SET is_closed = (status = 'closed') WHERE company_id = c_co AND resolution_notes = c_mark;

  -- Payroll May–Sep, based on each person's October payslip (±4%), already paid.
  INSERT INTO payment_approvals (company_id, employee_id, period_start, period_end, regular_hours, overtime_hours, gross_pay, deductions,
    net_pay, status, approved_by, approved_at, paid_at, notes, created_at, working_days, leave_days, absent_days, regular_pay, overtime_pay,
    shared_with_employee, pay_basis, base_salary, branch_label, cost_center)
  SELECT c_co, p.employee_id, m::date, (m + interval '1 month - 1 day')::date,
    p.regular_hours, round((coalesce(p.overtime_hours, 0) * (0.6 + random() * 0.8))::numeric, 1),
    round((p.gross_pay * f)::numeric, 2), round((coalesce(p.deductions, 0) * f)::numeric, 2),
    round((p.gross_pay * f - coalesce(p.deductions, 0) * f)::numeric, 2), 'paid', c_own,
    (m + interval '1 month - 6 days'), (m + interval '1 month - 5 days'), c_mark, (m + interval '1 month - 8 days'),
    p.working_days, p.leave_days, p.absent_days, round((coalesce(p.regular_pay, 0) * f)::numeric, 2),
    round((coalesce(p.overtime_pay, 0) * f)::numeric, 2), false, p.pay_basis, p.base_salary, p.branch_label, p.cost_center
  FROM payment_approvals p
  CROSS JOIN generate_series(date '2026-05-01', date '2026-09-01', interval '1 month') m
  CROSS JOIN LATERAL (SELECT 0.96 + random() * 0.08 f) ff
  WHERE p.company_id = c_co AND p.period_start = date '2026-10-01'
    AND NOT EXISTS (SELECT 1 FROM payment_approvals x WHERE x.employee_id = p.employee_id AND x.period_start = m::date);
END $seed$;
