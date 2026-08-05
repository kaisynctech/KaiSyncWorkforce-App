
CREATE TABLE companies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL,
  name                text NOT NULL,
  plan_code           text NOT NULL DEFAULT 'starter',
  subscription_active boolean NOT NULL DEFAULT true,
  trial_started_at    timestamptz,
  enabled_modules     jsonb NOT NULL DEFAULT '{}',
  custom_settings     jsonb NOT NULL DEFAULT '{}',
  owner_user_id       uuid REFERENCES auth.users(id),
  contact_email       text,
  contact_phone       text,
  address             text,
  logo_url            text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE employees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              text NOT NULL,
  surname           text NOT NULL DEFAULT '',
  employee_code     text,
  employment_type   text NOT NULL DEFAULT 'permanent',
  access_level      text NOT NULL DEFAULT 'employee',
  worker_type       text NOT NULL DEFAULT 'employee',
  position          text,
  branch            text,
  employment_date   date,
  hourly_rate       numeric NOT NULL DEFAULT 0,
  daily_rate        numeric NOT NULL DEFAULT 0,
  weekly_rate       numeric NOT NULL DEFAULT 0,
  monthly_salary    numeric NOT NULL DEFAULT 0,
  overtime_rate     numeric NOT NULL DEFAULT 0,
  double_time_rate  numeric NOT NULL DEFAULT 0,
  daily_hours       numeric NOT NULL DEFAULT 8,
  work_days_weekly  integer NOT NULL DEFAULT 5,
  email             text,
  phone             text,
  manager_user_id   uuid,
  is_active         boolean NOT NULL DEFAULT true,
  profile_photo_url text,
  id_number         text,
  bank_account      text,
  bank_name         text,
  bank_branch_code  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company_relationships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'employee',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
;
