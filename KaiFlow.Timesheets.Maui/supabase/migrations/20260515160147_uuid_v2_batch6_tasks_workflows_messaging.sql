
CREATE TABLE pa_task_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title            text NOT NULL,
  description      text,
  default_priority text NOT NULL DEFAULT 'medium',
  recurrence_rule  text,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pa_tasks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title                text NOT NULL,
  description          text,
  status               text NOT NULL DEFAULT 'open',
  priority             text NOT NULL DEFAULT 'medium',
  site_id              uuid REFERENCES sites(id),
  unit_id              uuid REFERENCES units(id),
  assigned_employee_id uuid REFERENCES employees(id),
  template_id          uuid REFERENCES pa_task_templates(id),
  due_date             date,
  completed_at         timestamptz,
  photo_urls           text[] NOT NULL DEFAULT '{}',
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_form_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  fields      jsonb NOT NULL DEFAULT '[]',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_form_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id  uuid NOT NULL REFERENCES workflow_form_templates(id),
  submitted_by uuid NOT NULL,
  job_id       uuid REFERENCES jobs(id),
  site_id      uuid REFERENCES sites(id),
  data         jsonb NOT NULL DEFAULT '{}',
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_threads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subject              text,
  participant_ids      uuid[] NOT NULL DEFAULT '{}',
  last_message_at      timestamptz,
  last_message_preview text,
  is_archived          boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  thread_id       uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL,
  body            text NOT NULL,
  attachment_urls text[] NOT NULL DEFAULT '{}',
  read_by_ids     uuid[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_teams (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name               text NOT NULL,
  description        text,
  leader_employee_id uuid REFERENCES employees(id),
  member_ids         uuid[] NOT NULL DEFAULT '{}',
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendar_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  start_time    timestamptz NOT NULL,
  end_time      timestamptz,
  is_all_day    boolean NOT NULL DEFAULT false,
  attendee_ids  uuid[] NOT NULL DEFAULT '{}',
  location      text,
  event_type    text NOT NULL DEFAULT 'general',
  linked_job_id uuid REFERENCES jobs(id),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
;
