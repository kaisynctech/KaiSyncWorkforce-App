-- Company free-trial foundation
-- Adds two-month free-trial start tracking.

set search_path = public;

alter table public.companies
  add column if not exists trial_started_at timestamptz null;

update public.companies
set trial_started_at = coalesce(trial_started_at, created_at, now())
where trial_started_at is null;
