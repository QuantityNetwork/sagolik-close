-- =============================================================================
-- Document storage (Supabase Storage). Skipped automatically when the storage
-- schema is absent (e.g. plain-Postgres CI for RLS tests).
--
-- Object key layout:  <transaction_id>/<document_id>/v<version>-<sha256>
-- Uploads happen server-side after validation + scanning (service role).
-- Clients read only via short-lived signed URLs minted by the server after an
-- authorization check; the select policy below is defence in depth.
-- =============================================================================
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('documents', 'documents', false, 26214400,
            array['application/pdf','image/png','image/jpeg','image/webp','image/heic',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
    on conflict (id) do nothing;

    execute $p$
      create policy "documents bucket: read via document permission" on storage.objects for select to authenticated
      using (
        bucket_id = 'documents'
        and public.can_view_document(((storage.foldername(name))[2])::uuid)
      )
    $p$;
  end if;
end $$;
