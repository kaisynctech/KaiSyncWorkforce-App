
CREATE TABLE time_punches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        text NOT NULL DEFAULT 'in',
  date_time   timestamptz NOT NULL,
  latitude    double precision,
  longitude   double precision,
  address     text,
  job_id      uuid REFERENCES jobs(id),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE labor_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id),
  job_id      uuid REFERENCES jobs(id),
  job_code_id uuid REFERENCES job_codes(id),
  work_date   date NOT NULL,
  hours       double precision NOT NULL DEFAULT 0,
  hourly_rate double precision NOT NULL DEFAULT 0,
  source_type text NOT NULL DEFAULT 'manual',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leave_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES employees(id),
  leave_type          text NOT NULL,
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  half_day_start      boolean NOT NULL DEFAULT false,
  half_day_end        boolean NOT NULL DEFAULT false,
  total_days          double precision NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'pending',
  reason              text,
  decision_note       text,
  approver_hr_user_id uuid,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES employees(id),
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  regular_hours  double precision NOT NULL DEFAULT 0,
  overtime_hours double precision NOT NULL DEFAULT 0,
  gross_pay      double precision NOT NULL DEFAULT 0,
  deductions     double precision NOT NULL DEFAULT 0,
  net_pay        double precision NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'pending',
  approved_by    uuid,
  approved_at    timestamptz,
  paid_at        timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
;
