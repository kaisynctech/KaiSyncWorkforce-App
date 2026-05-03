-- ============================================================
-- My PA phase 3 — recurring task templates (HR-managed defaults)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pa_task_templates (
  id                  bigserial PRIMARY KEY,
  company_id          bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title               text NOT NULL,
  notes               text,
  priority            text NOT NULL DEFAULT 'medium'
                      CHECK (priority IN ('low','medium','high')),
  recurrence_pattern  text NOT NULL DEFAULT 'none'
                      CHECK (recurrence_pattern IN ('none','daily','weekly','monthly')),
  linked_type         text NOT NULL DEFAULT 'none'
                      CHECK (linked_type IN ('none','client','job','deal','payment','meeting')),
  sort_order          int NOT NULL DEFAULT 100,
  is_system           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pa_task_templates_company_sort
  ON public.pa_task_templates(company_id, sort_order, title);

CREATE OR REPLACE FUNCTION public.set_pa_task_templates_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pa_task_templates_updated_at ON public.pa_task_templates;
CREATE TRIGGER trg_pa_task_templates_updated_at
BEFORE UPDATE ON public.pa_task_templates
FOR EACH ROW
EXECUTE FUNCTION public.set_pa_task_templates_updated_at();

ALTER TABLE public.pa_task_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_pa_task_templates_hr') THEN
    CREATE POLICY p_pa_task_templates_hr ON public.pa_task_templates
      FOR ALL USING (company_id = current_hr_company_id());
  END IF;
END $$;

-- Seed default templates once per company (skip companies that already have rows).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.companies LOOP
    IF EXISTS (SELECT 1 FROM public.pa_task_templates t WHERE t.company_id = r.id) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.pa_task_templates
      (company_id, title, notes, priority, recurrence_pattern, linked_type, sort_order, is_system)
    VALUES
      (
        r.id,
        'Weekly ops review',
        'Review overdue jobs, silent accounts, and payment exceptions.',
        'medium',
        'weekly',
        'none',
        10,
        true
      ),
      (
        r.id,
        'Daily inbox sweep',
        'Clear urgent HR messages and employee replies before midday.',
        'low',
        'daily',
        'none',
        20,
        true
      ),
      (
        r.id,
        'Project pipeline check',
        'Confirm next steps on projects closing this month.',
        'high',
        'weekly',
        'deal',
        30,
        true
      ),
      (
        r.id,
        'Payment follow-up batch',
        'Chase outstanding client invoices and log promised dates.',
        'medium',
        'weekly',
        'payment',
        40,
        true
      );
  END LOOP;
END $$;

-- New companies created after this migration still get the default template pack.
CREATE OR REPLACE FUNCTION public.seed_pa_task_templates_for_new_company()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.pa_task_templates t WHERE t.company_id = NEW.id LIMIT 1) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pa_task_templates
    (company_id, title, notes, priority, recurrence_pattern, linked_type, sort_order, is_system)
  VALUES
    (
      NEW.id,
      'Weekly ops review',
      'Review overdue jobs, silent accounts, and payment exceptions.',
      'medium',
      'weekly',
      'none',
      10,
      true
    ),
    (
      NEW.id,
      'Daily inbox sweep',
      'Clear urgent HR messages and employee replies before midday.',
      'low',
      'daily',
      'none',
      20,
      true
    ),
    (
      NEW.id,
      'Project pipeline check',
      'Confirm next steps on projects closing this month.',
      'high',
      'weekly',
      'deal',
      30,
      true
    ),
    (
      NEW.id,
      'Payment follow-up batch',
      'Chase outstanding client invoices and log promised dates.',
      'medium',
      'weekly',
      'payment',
      40,
      true
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_pa_templates_company ON public.companies;
CREATE TRIGGER trg_seed_pa_templates_company
AFTER INSERT ON public.companies
FOR EACH ROW
EXECUTE FUNCTION public.seed_pa_task_templates_for_new_company();
