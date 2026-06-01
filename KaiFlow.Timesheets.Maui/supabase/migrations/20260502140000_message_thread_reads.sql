-- Per-employee read pointers for thread messages and company feed (unread counts).

CREATE TABLE IF NOT EXISTS public.app_message_thread_reads (
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  thread_id bigint NOT NULL REFERENCES public.app_message_threads(id) ON DELETE CASCADE,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_app_message_thread_reads_company_employee
  ON public.app_message_thread_reads(company_id, employee_id);
ALTER TABLE public.app_message_thread_reads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_thread_reads_hr') THEN
    CREATE POLICY p_thread_reads_hr ON public.app_message_thread_reads
      FOR ALL USING (company_id = current_hr_company_id())
      WITH CHECK (company_id = current_hr_company_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_thread_reads_employee') THEN
    CREATE POLICY p_thread_reads_employee ON public.app_message_thread_reads
      FOR ALL USING (
        EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.id = app_message_thread_reads.employee_id
            AND e.profile_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.id = app_message_thread_reads.employee_id
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.app_message_company_feed_reads (
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id bigint NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, employee_id)
);
ALTER TABLE public.app_message_company_feed_reads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_company_feed_reads_hr') THEN
    CREATE POLICY p_company_feed_reads_hr ON public.app_message_company_feed_reads
      FOR ALL USING (company_id = current_hr_company_id())
      WITH CHECK (company_id = current_hr_company_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_company_feed_reads_employee') THEN
    CREATE POLICY p_company_feed_reads_employee ON public.app_message_company_feed_reads
      FOR ALL USING (
        EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.id = app_message_company_feed_reads.employee_id
            AND e.profile_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.id = app_message_company_feed_reads.employee_id
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.message_unread_counts_for_threads(
  p_company_id bigint,
  p_employee_id bigint,
  p_thread_ids bigint[]
)
RETURNS TABLE(thread_id bigint, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.thread_id, COUNT(*)::bigint
  FROM app_messages m
  LEFT JOIN app_message_thread_reads r
    ON r.company_id = m.company_id
   AND r.thread_id = m.thread_id
   AND r.employee_id = p_employee_id
  WHERE m.company_id = p_company_id
    AND m.thread_id IS NOT NULL
    AND m.thread_id = ANY(p_thread_ids)
    AND (
      m.sender_employee_id IS DISTINCT FROM p_employee_id
      OR (m.sender_employee_id IS NULL AND m.sender_hr_user_id IS NOT NULL)
    )
    AND m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamptz)
  GROUP BY m.thread_id;
$$;
CREATE OR REPLACE FUNCTION public.message_company_feed_unread_count(
  p_company_id bigint,
  p_employee_id bigint
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
  FROM app_messages m
  LEFT JOIN app_message_company_feed_reads r
    ON r.company_id = m.company_id
   AND r.employee_id = p_employee_id
  WHERE m.company_id = p_company_id
    AND m.thread_id IS NULL
    AND (
      m.sender_employee_id IS DISTINCT FROM p_employee_id
      OR (m.sender_employee_id IS NULL AND m.sender_hr_user_id IS NOT NULL)
    )
    AND m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamptz);
$$;
GRANT EXECUTE ON FUNCTION public.message_unread_counts_for_threads(bigint, bigint, bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.message_company_feed_unread_count(bigint, bigint) TO authenticated;
