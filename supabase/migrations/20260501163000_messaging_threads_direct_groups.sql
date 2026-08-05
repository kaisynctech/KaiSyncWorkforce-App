-- Threaded messaging: direct and group/team chat support

CREATE TABLE IF NOT EXISTS public.app_message_threads (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  thread_type text NOT NULL CHECK (thread_type IN ('direct','group')),
  created_by_employee_id bigint REFERENCES public.employees(id) ON DELETE SET NULL,
  created_by_hr_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_message_threads_company_time
  ON public.app_message_threads(company_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.app_message_thread_members (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  thread_id bigint NOT NULL REFERENCES public.app_message_threads(id) ON DELETE CASCADE,
  member_employee_id bigint REFERENCES public.employees(id) ON DELETE CASCADE,
  member_hr_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member','manager')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_message_thread_members_identity_chk CHECK (
    member_employee_id IS NOT NULL OR member_hr_user_id IS NOT NULL
  ),
  CONSTRAINT uq_thread_member_employee UNIQUE (thread_id, member_employee_id),
  CONSTRAINT uq_thread_member_hr UNIQUE (thread_id, member_hr_user_id)
);
CREATE INDEX IF NOT EXISTS idx_app_message_thread_members_company
  ON public.app_message_thread_members(company_id, thread_id);
ALTER TABLE public.app_messages
  ADD COLUMN IF NOT EXISTS thread_id bigint REFERENCES public.app_message_threads(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_app_messages_thread_time
  ON public.app_messages(thread_id, created_at DESC);
ALTER TABLE public.app_message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_message_thread_members ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_message_threads_hr') THEN
    CREATE POLICY p_message_threads_hr ON public.app_message_threads
      FOR ALL USING (company_id = current_hr_company_id())
      WITH CHECK (company_id = current_hr_company_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_message_threads_employee_select') THEN
    CREATE POLICY p_message_threads_employee_select ON public.app_message_threads
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM public.app_message_thread_members m
          JOIN public.employees e
            ON e.id = m.member_employee_id
           AND e.company_id = app_message_threads.company_id
          WHERE m.thread_id = app_message_threads.id
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_message_members_hr') THEN
    CREATE POLICY p_message_members_hr ON public.app_message_thread_members
      FOR ALL USING (company_id = current_hr_company_id())
      WITH CHECK (company_id = current_hr_company_id());
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_message_members_employee_select') THEN
    CREATE POLICY p_message_members_employee_select ON public.app_message_thread_members
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.company_id = app_message_thread_members.company_id
            AND e.id = app_message_thread_members.member_employee_id
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_messages_thread_employee_select') THEN
    CREATE POLICY p_messages_thread_employee_select ON public.app_messages
      FOR SELECT USING (
        thread_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.app_message_thread_members m
          JOIN public.employees e
            ON e.id = m.member_employee_id
           AND e.company_id = app_messages.company_id
          WHERE m.thread_id = app_messages.thread_id
            AND e.profile_id = auth.uid()
        )
      );
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_messages_thread_employee_insert') THEN
    CREATE POLICY p_messages_thread_employee_insert ON public.app_messages
      FOR INSERT WITH CHECK (
        sender_employee_id IS NOT NULL
        AND sender_hr_user_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.employees e
          WHERE e.company_id = app_messages.company_id
            AND e.id = app_messages.sender_employee_id
            AND e.profile_id = auth.uid()
        )
        AND (
          thread_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.app_message_thread_members m
            WHERE m.thread_id = app_messages.thread_id
              AND m.member_employee_id = app_messages.sender_employee_id
          )
        )
      );
  END IF;
END $$;
