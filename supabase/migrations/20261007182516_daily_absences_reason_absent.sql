-- Allow HR "Mark Absent" reason used by dashboard overview.
-- Existing check only allowed sick | personal | emergency | other.

ALTER TABLE public.daily_absences
  DROP CONSTRAINT IF EXISTS daily_absences_reason_check;

ALTER TABLE public.daily_absences
  ADD CONSTRAINT daily_absences_reason_check
  CHECK (reason IN ('sick', 'personal', 'emergency', 'other', 'absent'));
