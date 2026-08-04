-- Drop dead bigint-era permission / contractor_admin overloads.
-- UUID-era web uses my_permissions(uuid) and user_has_permission(uuid, text).

DROP FUNCTION IF EXISTS public.has_permission(bigint, text);
DROP FUNCTION IF EXISTS public.my_permissions(bigint);
DROP FUNCTION IF EXISTS public.contractor_admin_assert(bigint, bigint);
DROP FUNCTION IF EXISTS public.contractor_admin_create_and_link_member(bigint, bigint, text, text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.contractor_admin_replace_members(bigint, bigint, jsonb);
DROP FUNCTION IF EXISTS public.contractor_admin_set_allow_all_jobs(bigint, bigint, boolean);
DROP FUNCTION IF EXISTS public.contractor_admin_set_member_email(bigint, bigint, bigint, text);
