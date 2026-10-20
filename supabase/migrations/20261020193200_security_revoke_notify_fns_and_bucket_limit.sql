-- Security Phase 0, stage A (CLIENT-AUDIT-001 S5, S6, S10). No app change needed.
--
-- S5/S6: these helpers insert client email/SMS deliveries or staff notifications
-- with caller-chosen text and no access check, and anyone with the public app key
-- could call them. They are only ever called from SECURITY DEFINER functions and
-- triggers owned by postgres (verified 20 Oct 2026: trg_client_deal_progress_notify,
-- trg_hr_message_notify, trg_client_deal_update_notify, trg_client_payment_notify,
-- trg_project_document_notify, trg_app_message_client_notify_hr,
-- trg_app_message_hr_notify_client, contractor_portal_insert_document), and the
-- app never calls them directly, so removing outside access changes nothing for users.
REVOKE EXECUTE ON FUNCTION public.enqueue_client_portal_notification(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_hr_client_portal_message(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_hr_contractor_document(uuid, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- S10: workforce-media had no size limit. Largest file today is 2.4 MB; 25 MB allows
-- phone photos and scanned PDFs. (No file-type list yet: some browsers send an empty
-- type for Office files; a type list will come with the upload changes.)
UPDATE storage.buckets SET file_size_limit = 26214400 WHERE id = 'workforce-media';
