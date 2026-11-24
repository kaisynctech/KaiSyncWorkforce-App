-- Linked companies, stage 2 part B (approved 30 Oct 2026): the customer company acts on the
-- provider's work inside its own app — accept or ask changes to quotes, project messages,
-- documents, compliance uploads, and (owner, HR or admin only) its details and banking.
--
-- Same pattern as part A: the portal action's body moves into _cpc_<name>(p_client, …); the
-- portal wrapper keeps its name, arguments and results; linked_<name> checks the link and the
-- person. Linked actions are recorded with the person (auth user) and shown with their name.

-- ── Who is acting through a link ───────────────────────────────────────────
-- "Thandi Mokoena (test company)" for the signed-in person in their company.
CREATE OR REPLACE FUNCTION public._linked_actor_name(p_company_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(nullif(btrim(concat_ws(' ', e.name, e.surname)), ''), 'Office') || ' (' || c.name || ')'
  FROM public.companies c
  LEFT JOIN LATERAL (SELECT e.name, e.surname FROM public.employees e
                     WHERE e.company_id = c.id AND e.user_id = auth.uid() LIMIT 1) e ON true
  WHERE c.id = p_company_id;
$$;

-- One app event on the provider's side for each linked action.
CREATE OR REPLACE FUNCTION public._linked_event(p_company_id uuid, p_link_id uuid, p_action text, p_meta jsonb)
RETURNS void LANGUAGE sql SET search_path = public AS $$
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  SELECT l.provider_company_id, auth.uid(), 'LinkedCompany', p_action, 'info',
         coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('link_id', l.id, 'by_company_id', p_company_id,
                                                             'by', public._linked_actor_name(p_company_id)),
         now()
  FROM public.company_links l WHERE l.id = p_link_id;
$$;

-- ── Quotes ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._cpc_accept_quotation(p_client uuid, p_deal_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_deal public.client_deals%ROWTYPE; v_has_quote boolean;
BEGIN
  SELECT d.* INTO v_deal
  FROM public.clients cl JOIN public.client_deals d ON d.client_id = cl.id AND d.company_id = cl.company_id
  WHERE cl.id = p_client AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  IF v_deal.quotation_response = 'accepted' THEN RETURN; END IF;
  SELECT (coalesce(v_deal.offer_amount, 0) > 0 OR nullif(trim(coalesce(v_deal.quotation_notes, '')), '') IS NOT NULL
          OR v_deal.quotation_sent_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.project_quotation_lines ql WHERE ql.deal_id = v_deal.id)
          OR EXISTS (SELECT 1 FROM public.commercial_quotes q WHERE q.deal_id = v_deal.id AND q.status = 'sent')) INTO v_has_quote;
  IF NOT v_has_quote THEN RAISE EXCEPTION 'QUOTATION_NOT_SHARED'; END IF;
  UPDATE public.client_deals SET quotation_response = 'accepted', quotation_response_note = NULL, quotation_response_storage_path = NULL,
    quotation_response_at = now(), updated_at = now() WHERE id = v_deal.id;
END $$;

CREATE OR REPLACE FUNCTION public._cpc_revise_quotation(p_client uuid, p_deal_id uuid, p_note text, p_storage_path text)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_deal public.client_deals%ROWTYPE; v_prefix text;
BEGIN
  IF nullif(trim(coalesce(p_note, '')), '') IS NULL THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;
  SELECT d.* INTO v_deal
  FROM public.clients cl JOIN public.client_deals d ON d.client_id = cl.id AND d.company_id = cl.company_id
  WHERE cl.id = p_client AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  IF v_deal.quotation_response = 'accepted' THEN RAISE EXCEPTION 'QUOTATION_ALREADY_ACCEPTED'; END IF;
  IF nullif(trim(coalesce(p_storage_path, '')), '') IS NOT NULL THEN
    v_prefix := 'client_documents/' || v_deal.company_id::text || '/' || v_deal.client_id::text || '/';
    IF p_storage_path LIKE '%..%' OR left(p_storage_path, length(v_prefix)) <> v_prefix THEN RAISE EXCEPTION 'FILE_REQUIRED'; END IF;
  END IF;
  UPDATE public.client_deals SET quotation_response = 'revision_requested', quotation_response_note = trim(p_note),
    quotation_response_storage_path = nullif(trim(coalesce(p_storage_path, '')), ''), quotation_response_at = now(), updated_at = now()
  WHERE id = v_deal.id;
END $$;

-- ── Project messages and documents ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._cpc_send_message(p_client uuid, p_deal_id uuid, p_body text, p_display_name text)
RETURNS json LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_deal public.client_deals%ROWTYPE; v_thread_id uuid; v_msg_id uuid;
BEGIN
  IF trim(coalesce(p_body, '')) = '' THEN RAISE EXCEPTION 'MESSAGE_REQUIRED'; END IF;
  SELECT d.* INTO v_deal
  FROM public.clients cl JOIN public.client_deals d ON d.client_id = cl.id AND d.company_id = cl.company_id
  WHERE cl.id = p_client AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  v_thread_id := public._get_or_create_deal_thread(v_deal.company_id, v_deal.id, v_deal.manager_employee_id);
  INSERT INTO public.app_messages (id, thread_id, sender_id, body, company_id, created_at, sender_client_id, sender_display_name)
  VALUES (gen_random_uuid(), v_thread_id, coalesce(v_deal.manager_employee_id, p_client), trim(p_body), v_deal.company_id, now(),
          p_client, p_display_name)
  RETURNING id INTO v_msg_id;
  RETURN json_build_object('id', v_msg_id, 'body', trim(p_body), 'created_at', now(), 'sender_client_id', p_client);
END $$;

CREATE OR REPLACE FUNCTION public._cpc_add_document_link(p_client uuid, p_deal_id uuid, p_document_name text, p_file_url text)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_deal public.client_deals%ROWTYPE; v_id uuid;
BEGIN
  IF trim(coalesce(p_document_name, '')) = '' OR trim(coalesce(p_file_url, '')) = '' THEN RAISE EXCEPTION 'DOCUMENT_REQUIRED'; END IF;
  SELECT d.* INTO v_deal
  FROM public.clients cl JOIN public.client_deals d ON d.client_id = cl.id AND d.company_id = cl.company_id
  WHERE cl.id = p_client AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  INSERT INTO public.project_documents (company_id, deal_id, document_name, document_type, file_url)
  VALUES (v_deal.company_id, v_deal.id, trim(p_document_name), 'client_upload', trim(p_file_url)) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public._cpc_prepare_upload(p_client uuid, p_storage_path text)
RETURNS json LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_client uuid; v_company uuid;
  v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_client_prefix text; v_project_prefix text; v_deal uuid;
BEGIN
  SELECT c.id, c.company_id INTO v_client, v_company FROM public.clients c WHERE c.id = p_client;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  IF v_path = '' OR v_path LIKE '%..%' THEN RAISE EXCEPTION 'FILE_REQUIRED'; END IF;
  v_client_prefix := 'client_documents/' || v_company::text || '/' || v_client::text || '/';
  v_project_prefix := 'project_documents/' || v_company::text || '/';
  IF left(v_path, length(v_client_prefix)) = v_client_prefix THEN
    NULL;
  ELSIF left(v_path, length(v_project_prefix)) = v_project_prefix THEN
    BEGIN
      v_deal := split_part(v_path, '/', 3)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'FILE_REQUIRED';
    END;
    IF NOT EXISTS (SELECT 1 FROM public.client_deals d WHERE d.id = v_deal AND d.company_id = v_company AND d.client_id = v_client AND d.visibility <> 'private') THEN
      RAISE EXCEPTION 'FILE_REQUIRED';
    END IF;
  ELSE
    RAISE EXCEPTION 'FILE_REQUIRED';
  END IF;
  INSERT INTO public.media_upload_grants (company_id, employee_id, storage_path, purpose, expires_at)
  VALUES (v_company, NULL, v_path, 'client_portal_document', now() + interval '15 minutes')
  ON CONFLICT (storage_path) DO UPDATE SET company_id = EXCLUDED.company_id, employee_id = NULL, purpose = EXCLUDED.purpose,
    expires_at = EXCLUDED.expires_at, consumed_at = NULL;
  RETURN json_build_object('storage_path', v_path);
END $$;

CREATE OR REPLACE FUNCTION public._cpc_submit_document_request(p_client uuid, p_request_id uuid, p_storage_path text, p_file_size_bytes bigint, p_mime_type text)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_client uuid; v_company uuid; v_prefix text;
BEGIN
  SELECT c.id, c.company_id INTO v_client, v_company FROM public.clients c WHERE c.id = p_client;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  v_prefix := 'client_documents/' || v_company::text || '/' || v_client::text || '/';
  IF coalesce(p_storage_path, '') = '' OR p_storage_path LIKE '%..%' OR left(p_storage_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'FILE_REQUIRED';
  END IF;
  UPDATE public.client_document_requests
  SET status = 'submitted', storage_path = p_storage_path, file_url = p_storage_path,
      file_size_bytes = p_file_size_bytes, mime_type = nullif(trim(coalesce(p_mime_type, '')), ''),
      submitted_at = now(), review_note = NULL, updated_at = now()
  WHERE id = p_request_id AND client_id = v_client AND company_id = v_company AND status IN ('requested', 'changes_requested');
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_OPEN'; END IF;
  RETURN p_request_id;
END $$;

-- ── Compliance uploads ──────────────────────────────────────────────────────
-- p_user: the signed-in person for a linked upload (null from the portal).
CREATE OR REPLACE FUNCTION public._cpc_insert_document(p_client uuid, p_document_type text, p_document_name text, p_storage_path text,
  p_expiry_date date, p_old_document_id uuid, p_user uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_client uuid; v_company uuid; v_id uuid; v_path text := trim(both '/' from coalesce(p_storage_path, ''));
BEGIN
  SELECT c.id, c.company_id INTO v_client, v_company FROM public.clients c WHERE c.id = p_client;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  IF left(v_path, length('client_documents/' || v_company::text || '/' || v_client::text || '/')) <>
     'client_documents/' || v_company::text || '/' || v_client::text || '/' OR v_path LIKE '%..%' THEN
    RAISE EXCEPTION 'FILE_PATH_NOT_ALLOWED';
  END IF;
  IF p_old_document_id IS NOT NULL THEN
    UPDATE public.contractor_documents SET is_current = false, updated_at = now()
    WHERE id = p_old_document_id AND client_id = v_client AND company_id = v_company AND direction = 'from_party';
  END IF;
  INSERT INTO public.contractor_documents (company_id, client_id, document_type, document_name, file_url, storage_path,
    expiry_date, approval_status, is_required, is_current, uploaded_by_role, direction)
  VALUES (v_company, v_client, p_document_type, coalesce(nullif(trim(p_document_name), ''), p_document_type), v_path, v_path,
    p_expiry_date, 'pending', false, true, 'client_portal', 'from_party')
  RETURNING id INTO v_id;
  UPDATE public.media_upload_grants SET consumed_at = now() WHERE storage_path = v_path AND consumed_at IS NULL;
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (v_company, p_user, 'ClientPortal', 'client_compliance_uploaded', 'info',
          jsonb_build_object('client_id', v_client::text, 'document_id', v_id, 'document_type', p_document_type,
                             'replaced', p_old_document_id IS NOT NULL), now());
  PERFORM public.notify_hr_client_compliance_upload(v_company, v_client, coalesce(nullif(trim(p_document_name), ''), p_document_type));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public._cpc_submit_compliance_document(p_client uuid, p_type_code text, p_name text, p_storage_path text,
  p_mime text, p_size bigint, p_issue date, p_expiry date, p_notes text, p_user uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_client uuid; v_company uuid; v_pack uuid; v_item public.compliance_pack_items%ROWTYPE; v_id uuid; v_label text;
BEGIN
  SELECT c.id, c.company_id INTO v_client, v_company FROM public.clients c WHERE c.id = p_client;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  SELECT pack_id INTO v_pack FROM public.party_compliance WHERE company_id = v_company AND party_kind = 'client' AND party_id = v_client;
  SELECT * INTO v_item FROM public.compliance_pack_items
  WHERE pack_id = v_pack AND company_id = v_company AND NOT is_archived
    AND document_type_code = p_type_code AND direction = 'from_party' LIMIT 1;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'This document is not on your checklist'; END IF;
  IF v_item.expiry_required AND p_expiry IS NULL THEN RAISE EXCEPTION 'Please enter the expiry date'; END IF;
  IF coalesce(p_size, 0) > 25 * 1024 * 1024 THEN RAISE EXCEPTION 'The file is larger than 25 MB'; END IF;
  v_id := public._compliance_add_document(v_company, 'client', v_client, p_type_code, 'from_party', p_name,
    p_storage_path, p_mime, p_size, p_issue, p_expiry, p_notes, 'client_portal', v_client, 'pending');
  UPDATE public.media_upload_grants SET consumed_at = now()
  WHERE storage_path = trim(both '/' from p_storage_path) AND consumed_at IS NULL;
  SELECT coalesce((SELECT t.label FROM public.compliance_document_types t WHERE t.code = p_type_code
                   AND (t.company_id = v_company OR t.company_id IS NULL) ORDER BY t.company_id NULLS LAST LIMIT 1), p_type_code)
    INTO v_label;
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (v_company, p_user, 'ClientPortal', 'client_compliance_uploaded', 'info',
          jsonb_build_object('client_id', v_client::text, 'document_id', v_id, 'type', p_type_code, 'label', v_label), now());
  PERFORM public.notify_hr_client_compliance_upload(v_company, v_client, v_label);
  RETURN v_id;
END $$;

-- ── Details and banking ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._cpc_update_profile(p_client uuid, p_name text, p_legal_name text, p_company_number text, p_vat_number text,
  p_contact_person text, p_email text, p_phone text, p_mobile text, p_direct_line text, p_fax text, p_website text, p_address text,
  p_billing_address text, p_user uuid, p_source text)
RETURNS json LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_client_id uuid; v_company_id uuid; v_old public.clients%ROWTYPE; v_changes jsonb := '[]'::jsonb; v_summary text; f record;
BEGIN
  SELECT c.id, c.company_id INTO v_client_id, v_company_id FROM public.clients c WHERE c.id = p_client;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  IF trim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'Company name is required'; END IF;
  SELECT * INTO v_old FROM public.clients WHERE id = v_client_id AND company_id = v_company_id FOR UPDATE;
  FOR f IN
    SELECT * FROM (VALUES
      ('name', 'Company Name', v_old.name::text, p_name),
      ('legal_name', 'Legal Name', v_old.legal_name::text, p_legal_name),
      ('company_number', 'Registration No.', v_old.company_number::text, p_company_number),
      ('vat_number', 'VAT Number', v_old.vat_number::text, p_vat_number),
      ('contact_person', 'Contact Person', v_old.contact_person::text, p_contact_person),
      ('email', 'Email', v_old.email::text, p_email),
      ('phone', 'Phone', v_old.phone::text, p_phone),
      ('mobile', 'Mobile', v_old.mobile::text, p_mobile),
      ('direct_line', 'Direct Line', v_old.direct_line::text, p_direct_line),
      ('fax', 'Fax', v_old.fax::text, p_fax),
      ('website', 'Website', v_old.website::text, p_website),
      ('address', 'Address', v_old.address::text, p_address),
      ('billing_address', 'Billing Address', v_old.billing_address::text, p_billing_address)
    ) AS t(field, label, old_value, new_value)
  LOOP
    IF length(coalesce(f.new_value, '')) > 1000 THEN RAISE EXCEPTION '% is too long', f.label; END IF;
    IF nullif(trim(coalesce(f.old_value, '')), '') IS DISTINCT FROM nullif(trim(coalesce(f.new_value, '')), '') THEN
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'field', f.field, 'label', f.label, 'from', coalesce(f.old_value, ''), 'to', coalesce(nullif(trim(f.new_value), ''), '')));
    END IF;
  END LOOP;
  IF jsonb_array_length(v_changes) = 0 THEN RETURN public._cpc_get_profile(v_client_id); END IF;
  UPDATE public.clients SET
    name            = trim(p_name),
    legal_name      = nullif(trim(coalesce(p_legal_name, '')), ''),
    company_number  = nullif(trim(coalesce(p_company_number, '')), ''),
    vat_number      = nullif(trim(coalesce(p_vat_number, '')), ''),
    contact_person  = nullif(trim(coalesce(p_contact_person, '')), ''),
    email           = nullif(trim(coalesce(p_email, '')), ''),
    phone           = nullif(trim(coalesce(p_phone, '')), ''),
    mobile          = nullif(trim(coalesce(p_mobile, '')), ''),
    direct_line     = nullif(trim(coalesce(p_direct_line, '')), ''),
    fax             = nullif(trim(coalesce(p_fax, '')), ''),
    website         = nullif(trim(coalesce(p_website, '')), ''),
    address         = nullif(trim(coalesce(p_address, '')), ''),
    billing_address = nullif(trim(coalesce(p_billing_address, '')), '')
  WHERE id = v_client_id AND company_id = v_company_id;
  v_summary := (SELECT string_agg(x->>'label', ', ') FROM jsonb_array_elements(v_changes) x);
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (v_company_id, p_user, 'ClientPortal', 'client_profile_updated', 'info',
          jsonb_build_object('client_id', v_client_id::text, 'source', p_source, 'field_changes', v_changes), now());
  PERFORM public.notify_hr_client_profile_updated(v_company_id, v_client_id, v_summary);
  RETURN public._cpc_get_profile(v_client_id);
END $$;

CREATE OR REPLACE FUNCTION public._cpc_get_banking(p_client uuid)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT json_build_object(
    'current', (
      SELECT json_build_object('account_holder', b.account_holder, 'bank_name', b.bank_name,
                               'masked_account', public._mask_account(b.account_number), 'branch_code', b.branch_code,
                               'updated_at', b.updated_at)
      FROM public.client_bank_details b WHERE b.client_id = x.id AND b.company_id = x.company_id),
    'latest', (
      SELECT json_build_object('status', u.status, 'account_holder', u.account_holder, 'bank_name', u.bank_name,
                               'masked_account', public._mask_account(u.account_number), 'branch_code', u.branch_code,
                               'account_type', u.account_type, 'submitted_at', u.submitted_at,
                               'reviewed_at', u.reviewed_at, 'rejection_reason', u.rejection_reason)
      FROM public.client_banking_updates u
      WHERE u.client_id = x.id AND u.company_id = x.company_id AND u.status <> 'superseded'
      ORDER BY u.submitted_at DESC LIMIT 1)
  )
  FROM public.clients x WHERE x.id = p_client;
$$;

CREATE OR REPLACE FUNCTION public._cpc_submit_banking(p_client uuid, p_account_holder text, p_bank_name text, p_account_number text,
  p_branch_code text, p_account_type text, p_user uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_client_id uuid; v_company_id uuid; v_id uuid;
  v_acc text := regexp_replace(coalesce(p_account_number, ''), '\s', '', 'g');
BEGIN
  SELECT c.id, c.company_id INTO v_client_id, v_company_id FROM public.clients c WHERE c.id = p_client;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  IF trim(coalesce(p_account_holder, '')) = '' THEN RAISE EXCEPTION 'Account holder name is required'; END IF;
  IF trim(coalesce(p_bank_name, '')) = '' THEN RAISE EXCEPTION 'Bank name is required'; END IF;
  IF v_acc = '' THEN RAISE EXCEPTION 'Account number is required'; END IF;
  IF v_acc !~ '^[0-9]{5,20}$' THEN RAISE EXCEPTION 'Account number must be 5 to 20 digits'; END IF;
  IF length(p_account_holder) > 200 OR length(p_bank_name) > 200 OR length(coalesce(p_branch_code, '')) > 20
     OR length(coalesce(p_account_type, '')) > 50 THEN
    RAISE EXCEPTION 'A banking field is too long';
  END IF;
  UPDATE public.client_banking_updates SET status = 'superseded'
  WHERE client_id = v_client_id AND company_id = v_company_id AND status = 'pending';
  INSERT INTO public.client_banking_updates (company_id, client_id, account_holder, bank_name, account_number, branch_code, account_type)
  VALUES (v_company_id, v_client_id, trim(p_account_holder), trim(p_bank_name), v_acc,
          nullif(trim(coalesce(p_branch_code, '')), ''), nullif(trim(coalesce(p_account_type, '')), ''))
  RETURNING id INTO v_id;
  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
  VALUES (v_company_id, p_user, 'ClientPortal', 'client_banking_update_submitted', 'info',
          jsonb_build_object('client_id', v_client_id::text, 'update_id', v_id, 'account_last4', right(v_acc, 4)), now());
  PERFORM public.notify_hr_client_banking_update(v_company_id, v_client_id, right(v_acc, 4));
  RETURN v_id;
END $$;

-- ── Portal wrappers (same names, arguments and results as before) ──────────
CREATE OR REPLACE FUNCTION public._cp_client_or_raise(p_company_code text, p_client_code text, p_error text)
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  SELECT x.client_id INTO v FROM public._client_portal_client(p_company_code, p_client_code) x;
  IF v IS NULL THEN RAISE EXCEPTION '%', p_error; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.client_portal_accept_quotation(p_company_code text, p_client_code text, p_deal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public._cpc_accept_quotation(public._cp_client_or_raise(p_company_code, p_client_code, 'PROJECT_NOT_AVAILABLE'), p_deal_id); END $$;
CREATE OR REPLACE FUNCTION public.client_portal_revise_quotation(p_company_code text, p_client_code text, p_deal_id uuid, p_note text, p_storage_path text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF nullif(trim(coalesce(p_note, '')), '') IS NULL THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;
  PERFORM public._cpc_revise_quotation(public._cp_client_or_raise(p_company_code, p_client_code, 'PROJECT_NOT_AVAILABLE'), p_deal_id, p_note, p_storage_path);
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_send_message(p_company_code text, p_client_code text, p_deal_id uuid, p_body text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF trim(coalesce(p_body, '')) = '' THEN RAISE EXCEPTION 'MESSAGE_REQUIRED'; END IF;
  RETURN public._cpc_send_message(public._cp_client_or_raise(p_company_code, p_client_code, 'PROJECT_NOT_AVAILABLE'), p_deal_id, p_body, 'Client');
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_add_document_link(p_company_code text, p_client_code text, p_deal_id uuid, p_document_name text, p_file_url text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF trim(coalesce(p_document_name, '')) = '' OR trim(coalesce(p_file_url, '')) = '' THEN RAISE EXCEPTION 'DOCUMENT_REQUIRED'; END IF;
  RETURN public._cpc_add_document_link(public._cp_client_or_raise(p_company_code, p_client_code, 'PROJECT_NOT_AVAILABLE'), p_deal_id, p_document_name, p_file_url);
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_register_document(p_company_code text, p_client_code text, p_deal_id uuid, p_document_name text, p_file_url text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF trim(coalesce(p_document_name, '')) = '' OR trim(coalesce(p_file_url, '')) = '' THEN RAISE EXCEPTION 'DOCUMENT_REQUIRED'; END IF;
  RETURN public._cpc_add_document_link(public._cp_client_or_raise(p_company_code, p_client_code, 'PROJECT_NOT_AVAILABLE'), p_deal_id, p_document_name, p_file_url);
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_prepare_upload(p_company_code text, p_client_code text, p_storage_path text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RETURN public._cpc_prepare_upload(public._cp_client_or_raise(p_company_code, p_client_code, 'CLIENT_NOT_FOUND'), p_storage_path); END $$;
CREATE OR REPLACE FUNCTION public.client_portal_submit_document_request(p_company_code text, p_client_code text, p_request_id uuid, p_storage_path text,
  p_file_size_bytes bigint DEFAULT NULL, p_mime_type text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public._cpc_submit_document_request(public._cp_client_or_raise(p_company_code, p_client_code, 'CLIENT_NOT_FOUND'),
    p_request_id, p_storage_path, p_file_size_bytes, p_mime_type);
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_insert_document(p_company_code text, p_client_code text, p_document_type text, p_document_name text,
  p_storage_path text, p_expiry_date date DEFAULT NULL, p_old_document_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public._cpc_insert_document(public._cp_client_or_raise(p_company_code, p_client_code, 'CLIENT_NOT_FOUND'),
    p_document_type, p_document_name, p_storage_path, p_expiry_date, p_old_document_id, NULL);
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_submit_compliance_document(p_company_code text, p_client_code text, p_type_code text, p_name text,
  p_storage_path text, p_mime text, p_size bigint, p_issue date, p_expiry date, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public._cpc_submit_compliance_document(public._cp_client_or_raise(p_company_code, p_client_code, 'CLIENT_NOT_FOUND'),
    p_type_code, p_name, p_storage_path, p_mime, p_size, p_issue, p_expiry, p_notes, NULL);
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_update_profile(p_company_code text, p_client_code text, p_name text, p_legal_name text,
  p_company_number text, p_vat_number text, p_contact_person text, p_email text, p_phone text, p_mobile text, p_direct_line text,
  p_fax text, p_website text, p_address text, p_billing_address text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public._cpc_update_profile(public._cp_client_or_raise(p_company_code, p_client_code, 'CLIENT_NOT_FOUND'),
    p_name, p_legal_name, p_company_number, p_vat_number, p_contact_person, p_email, p_phone, p_mobile, p_direct_line,
    p_fax, p_website, p_address, p_billing_address, NULL, 'client_portal');
END $$;
CREATE OR REPLACE FUNCTION public.client_portal_get_banking(p_company_code text, p_client_code text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_get_banking(x.client_id) FROM public._client_portal_client(p_company_code, p_client_code) x;
$$;
CREATE OR REPLACE FUNCTION public.client_portal_submit_banking(p_company_code text, p_client_code text, p_account_holder text, p_bank_name text,
  p_account_number text, p_branch_code text, p_account_type text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public._cpc_submit_banking(public._cp_client_or_raise(p_company_code, p_client_code, 'CLIENT_NOT_FOUND'),
    p_account_holder, p_bank_name, p_account_number, p_branch_code, p_account_type, NULL);
END $$;

-- ── Linked wrappers ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.linked_accept_quotation(p_company_id uuid, p_link_id uuid, p_deal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._cpc_accept_quotation(public._linked_client(p_company_id, p_link_id), p_deal_id);
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_quote_accepted', jsonb_build_object('deal_id', p_deal_id));
END $$;
CREATE OR REPLACE FUNCTION public.linked_revise_quotation(p_company_id uuid, p_link_id uuid, p_deal_id uuid, p_note text, p_storage_path text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._cpc_revise_quotation(public._linked_client(p_company_id, p_link_id), p_deal_id, p_note, p_storage_path);
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_quote_revision_requested', jsonb_build_object('deal_id', p_deal_id));
END $$;
CREATE OR REPLACE FUNCTION public.linked_send_message(p_company_id uuid, p_link_id uuid, p_deal_id uuid, p_body text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v json;
BEGIN
  v := public._cpc_send_message(public._linked_client(p_company_id, p_link_id), p_deal_id, p_body, public._linked_actor_name(p_company_id));
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_message_sent', jsonb_build_object('deal_id', p_deal_id));
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.linked_add_document_link(p_company_id uuid, p_link_id uuid, p_deal_id uuid, p_document_name text, p_file_url text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  v := public._cpc_add_document_link(public._linked_client(p_company_id, p_link_id), p_deal_id, p_document_name, p_file_url);
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_project_document_added', jsonb_build_object('deal_id', p_deal_id, 'document_id', v));
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.linked_register_document(p_company_id uuid, p_link_id uuid, p_deal_id uuid, p_document_name text, p_file_url text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.linked_add_document_link(p_company_id, p_link_id, p_deal_id, p_document_name, p_file_url);
$$;
CREATE OR REPLACE FUNCTION public.linked_prepare_upload(p_company_id uuid, p_link_id uuid, p_storage_path text)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public._cpc_prepare_upload(public._linked_client(p_company_id, p_link_id), p_storage_path);
$$;
CREATE OR REPLACE FUNCTION public.linked_submit_document_request(p_company_id uuid, p_link_id uuid, p_request_id uuid, p_storage_path text,
  p_file_size_bytes bigint DEFAULT NULL, p_mime_type text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  v := public._cpc_submit_document_request(public._linked_client(p_company_id, p_link_id), p_request_id, p_storage_path, p_file_size_bytes, p_mime_type);
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_document_request_submitted', jsonb_build_object('request_id', p_request_id));
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.linked_insert_document(p_company_id uuid, p_link_id uuid, p_document_type text, p_document_name text,
  p_storage_path text, p_expiry_date date DEFAULT NULL, p_old_document_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  v := public._cpc_insert_document(public._linked_client(p_company_id, p_link_id), p_document_type, p_document_name, p_storage_path,
    p_expiry_date, p_old_document_id, auth.uid());
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_compliance_uploaded', jsonb_build_object('document_id', v));
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.linked_submit_compliance_document(p_company_id uuid, p_link_id uuid, p_type_code text, p_name text,
  p_storage_path text, p_mime text, p_size bigint, p_issue date, p_expiry date, p_notes text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  v := public._cpc_submit_compliance_document(public._linked_client(p_company_id, p_link_id), p_type_code, p_name, p_storage_path,
    p_mime, p_size, p_issue, p_expiry, p_notes, auth.uid());
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_compliance_uploaded', jsonb_build_object('document_id', v));
  RETURN v;
END $$;
-- Details and banking: owner, HR or admin of the customer company only.
CREATE OR REPLACE FUNCTION public.linked_update_profile(p_company_id uuid, p_link_id uuid, p_name text, p_legal_name text,
  p_company_number text, p_vat_number text, p_contact_person text, p_email text, p_phone text, p_mobile text, p_direct_line text,
  p_fax text, p_website text, p_address text, p_billing_address text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid; v json;
BEGIN
  v_client := public._linked_client(p_company_id, p_link_id);
  PERFORM public._company_link_admin(p_company_id);
  v := public._cpc_update_profile(v_client, p_name, p_legal_name, p_company_number, p_vat_number, p_contact_person, p_email,
    p_phone, p_mobile, p_direct_line, p_fax, p_website, p_address, p_billing_address, auth.uid(), 'linked_company');
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_details_updated', '{}'::jsonb);
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.linked_get_banking(p_company_id uuid, p_link_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid;
BEGIN
  v_client := public._linked_client(p_company_id, p_link_id);
  PERFORM public._company_link_admin(p_company_id);
  RETURN public._cpc_get_banking(v_client);
END $$;
CREATE OR REPLACE FUNCTION public.linked_submit_banking(p_company_id uuid, p_link_id uuid, p_account_holder text, p_bank_name text,
  p_account_number text, p_branch_code text, p_account_type text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid; v uuid;
BEGIN
  v_client := public._linked_client(p_company_id, p_link_id);
  PERFORM public._company_link_admin(p_company_id);
  v := public._cpc_submit_banking(v_client, p_account_holder, p_bank_name, p_account_number, p_branch_code, p_account_type, auth.uid());
  PERFORM public._linked_event(p_company_id, p_link_id, 'linked_banking_submitted', '{}'::jsonb);
  RETURN v;
END $$;

-- Permissions (run separately): cores and helpers — no direct calls; linked_* — signed-in only.
