-- Client email queue (approved 30 Oct 2026). Until now nothing sent client_notification_deliveries:
-- notify_dispatch was never scheduled and the deployed version could not process this queue.
-- Every 5 minutes, if anything is waiting, the database calls notify_dispatch with a private key
-- kept in Vault (never leaves the database). Old messages are expired, not sent.

CREATE EXTENSION IF NOT EXISTS pg_net;

-- The private key the scheduler sends and the function checks.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'notify_dispatch_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'notify_dispatch_secret',
      'Private key the 5-minute scheduler sends to the notify_dispatch edge function.');
  END IF;
END $$;

-- The edge function asks the database whether the key it received is right (service role only).
CREATE OR REPLACE FUNCTION public.notify_dispatch_secret_ok(p_secret text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(length(p_secret) >= 32 AND p_secret = (
    SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'notify_dispatch_secret' LIMIT 1), false);
$$;

-- Called by the scheduler: only wakes the function when something is waiting.
CREATE OR REPLACE FUNCTION public.notify_dispatch_kick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.client_notification_deliveries WHERE status = 'pending')
     AND NOT EXISTS (SELECT 1 FROM public.app_notification_deliveries WHERE status = 'pending') THEN
    RETURN;
  END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'notify_dispatch_secret' LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://vcivtjwreybaxgtdhtou.supabase.co/functions/v1/notify_dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
END $$;

-- Messages queued before sending was switched on are too old to send now.
UPDATE public.client_notification_deliveries
   SET status = 'skipped', error_message = 'expired: queued before client emails were switched on', last_attempt_at = now()
 WHERE status = 'pending' AND created_at < now() - interval '7 days';

SELECT cron.schedule('client-notifications-dispatch', '*/5 * * * *', 'SELECT public.notify_dispatch_kick()');

-- Permissions (run separately): notify_dispatch_secret_ok → service_role only; notify_dispatch_kick → no one (cron runs as postgres).
