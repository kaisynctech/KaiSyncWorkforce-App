-- Reliable read of job before/after photo URL arrays (for clients that fail to deserialize text[])
CREATE OR REPLACE FUNCTION public.get_job_photo_urls(p_job_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'photo_urls_before', coalesce(
      (SELECT photo_urls_before FROM public.jobs WHERE id = p_job_id),
      '{}'::text[]),
    'photo_urls_after', coalesce(
      (SELECT photo_urls_after FROM public.jobs WHERE id = p_job_id),
      '{}'::text[])
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_job_photo_urls(uuid) TO authenticated;
