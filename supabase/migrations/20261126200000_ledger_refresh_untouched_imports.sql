-- When the Gmail processor version changes, a re-read email replaces its earlier
-- import only while the user has not edited it. The scanner stores the fields it
-- wrote in payload.email.imported; any user edit to those fields makes the record
-- differ from that snapshot, and the record is then left alone.
create or replace function public.ledger_commit_scan(p_user uuid, p_lease uuid, p_run uuid, p_expenses jsonb, p_result jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare item jsonb; inserted integer := 0; refreshed integer := 0; changed integer; v_scanned integer;
begin
  perform 1 from public.ledger_gmail_connections where user_id = p_user and enabled and status = 'connected' and lease = p_lease and lease_until > now() for update;
  if not found then
    update public.ledger_sync_history set status = 'cancelled', completed_at = now() where id = p_run and user_id = p_user;
    return jsonb_build_object('cancelled', true, 'added', 0, 'duplicates', 0, 'refreshed', 0);
  end if;
  for item in select value from jsonb_array_elements(p_expenses) loop
    changed := 0;
    if item#>>'{email,processorVersion}' is not null then
      begin
        update public.ledger_expenses e set payload = item
          where e.user_id = p_user and e.id = item->>'id'
            and e.payload#>>'{email,processorVersion}' is distinct from item#>>'{email,processorVersion}'
            and e.payload->'email'->'imported' is not null
            and e.payload->'email'->'imported' = jsonb_build_object(
              'merchant', e.payload->'merchant', 'amount', e.payload->'amount', 'date', e.payload->'date',
              'category', e.payload->'category', 'status', e.payload->'status', 'kind', e.payload->'kind', 'note', e.payload->'note');
        get diagnostics changed = row_count;
      exception when unique_violation then changed := 0; -- The refreshed invoice now matches another record; keep both as they were.
      end;
      refreshed := refreshed + changed;
    end if;
    if changed = 0 then
      insert into public.ledger_expenses(user_id, id, payload) values (p_user, item->>'id', item) on conflict do nothing;
      get diagnostics changed = row_count;
      inserted := inserted + changed;
    end if;
  end loop;
  insert into public.ledger_gmail_processed(user_id, message_id, parser_version)
    select distinct p_user, value, coalesce(p_result->>'processorVersion', 'payment-v1') from jsonb_array_elements_text(coalesce(p_result->'processedMessageIds', '[]'::jsonb))
    on conflict (user_id, message_id) do update set parser_version = excluded.parser_version, processed_at = now();
  v_scanned := coalesce((p_result->>'scanned')::integer, 0);
  update public.ledger_gmail_connections set lease = null, lease_until = null, last_sync_at = now(), last_error = null,
    next_page_token = p_result->>'nextPageToken',
    next_sync_at = now() + case when coalesce((p_result->>'hasMore')::boolean, false) then interval '0 seconds' else interval '15 minutes' end
    where user_id = p_user;
  update public.ledger_sync_history set status = 'complete', completed_at = now(), scanned = v_scanned,
    added = inserted, duplicates = jsonb_array_length(p_expenses) - inserted - refreshed, skipped = coalesce(p_result->'skipped', '[]'::jsonb)
    where id = p_run and user_id = p_user;
  return jsonb_build_object('added', inserted, 'duplicates', jsonb_array_length(p_expenses) - inserted - refreshed, 'refreshed', refreshed);
end $$;
revoke all on function public.ledger_commit_scan(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ledger_commit_scan(uuid, uuid, uuid, jsonb, jsonb) to service_role;
