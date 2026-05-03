-- Align seeded My PA template wording with UI "Project" terminology.
UPDATE public.pa_task_templates
SET
  title = 'Project pipeline check',
  notes = 'Confirm next steps on projects closing this month.'
WHERE title = 'Deal pipeline check';
