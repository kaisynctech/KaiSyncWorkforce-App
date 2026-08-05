
CREATE TABLE clients (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  type                 text NOT NULL DEFAULT 'individual',
  contact_person       text,
  phone                text,
  email                text,
  address              text,
  notes                text,
  linked_company_id    uuid,
  source_contractor_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id     uuid REFERENCES clients(id),
  name          text NOT NULL,
  address       text,
  latitude      double precision,
  longitude     double precision,
  notes         text,
  radius_meters double precision NOT NULL DEFAULT 200,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  unit_number text NOT NULL,
  address     text,
  floor       text,
  unit_type   text,
  is_occupied boolean NOT NULL DEFAULT false,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE residents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id       uuid NOT NULL REFERENCES sites(id),
  unit_id       uuid REFERENCES units(id),
  name          text NOT NULL,
  surname       text NOT NULL DEFAULT '',
  phone         text,
  email         text,
  move_in_date  date,
  move_out_date date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title                  text NOT NULL,
  description            text,
  client_id              uuid REFERENCES clients(id),
  site_id                uuid REFERENCES sites(id),
  unit_id                uuid REFERENCES units(id),
  scheduled_start        timestamptz,
  scheduled_end          timestamptz,
  status                 text NOT NULL DEFAULT 'scheduled',
  priority               text NOT NULL DEFAULT 'none',
  opened_at              timestamptz,
  first_response_at      timestamptz,
  closed_at              timestamptz,
  assignee_employee_id   uuid REFERENCES employees(id),
  assigned_employee_ids  uuid[] NOT NULL DEFAULT '{}',
  contractor_employee_id uuid,
  estimated_cost         double precision NOT NULL DEFAULT 0,
  actual_cost            double precision NOT NULL DEFAULT 0,
  inventory_cost         double precision NOT NULL DEFAULT 0,
  labor_cost             double precision NOT NULL DEFAULT 0,
  is_callback            boolean NOT NULL DEFAULT false,
  is_preventive          boolean NOT NULL DEFAULT false,
  parent_job_id          uuid,
  external_ref           text,
  site_radius_mode       boolean NOT NULL DEFAULT false,
  site_radius_meters     double precision NOT NULL DEFAULT 200,
  resident_reporter      text,
  photo_urls             text[] NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
;
