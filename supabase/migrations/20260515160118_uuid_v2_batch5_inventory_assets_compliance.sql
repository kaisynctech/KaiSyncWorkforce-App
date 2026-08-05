
CREATE TABLE inventory_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             text NOT NULL,
  sku              text,
  description      text,
  unit_of_measure  text NOT NULL DEFAULT 'each',
  unit_cost        double precision NOT NULL DEFAULT 0,
  selling_price    double precision NOT NULL DEFAULT 0,
  quantity_on_hand double precision NOT NULL DEFAULT 0,
  reorder_level    double precision NOT NULL DEFAULT 0,
  supplier         text,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_usage (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  job_id            uuid REFERENCES jobs(id),
  employee_id       uuid REFERENCES employees(id),
  quantity_used     double precision NOT NULL DEFAULT 0,
  unit_cost_at_use  double precision NOT NULL DEFAULT 0,
  notes             text,
  used_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id          uuid REFERENCES sites(id),
  unit_id          uuid REFERENCES units(id),
  asset_type       text NOT NULL,
  label            text,
  manufacturer     text,
  model_number     text,
  serial_number    text,
  install_date     date,
  warranty_expires date,
  status           text NOT NULL DEFAULT 'active',
  notes            text,
  photo_urls       text[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE compliance_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id            uuid REFERENCES sites(id),
  asset_id           uuid REFERENCES assets(id),
  compliance_type    text NOT NULL,
  certificate_number text,
  issued_date        date,
  expiry_date        date,
  issued_by          text,
  document_url       text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE incident_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES employees(id),
  job_id           uuid REFERENCES jobs(id),
  site_id          uuid REFERENCES sites(id),
  description      text NOT NULL,
  severity         text NOT NULL DEFAULT 'low',
  photo_urls       text[] NOT NULL DEFAULT '{}',
  is_closed        boolean NOT NULL DEFAULT false,
  resolution_notes text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
;
