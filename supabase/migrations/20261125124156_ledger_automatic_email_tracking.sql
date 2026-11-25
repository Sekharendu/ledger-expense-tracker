-- Internal Gmail progress. Client roles cannot read message IDs or watch metadata.
create table public.ledger_gmail_processed (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null check (length(message_id) between 1 and 256),
  parser_version text not null default 'payment-v1' check (length(parser_version) between 1 and 64),
  processed_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
alter table public.ledger_gmail_processed enable row level security;
revoke all on public.ledger_gmail_processed from public, anon, authenticated;
grant all on public.ledger_gmail_processed to service_role;

alter table public.ledger_gmail_connections
  add column gmail_watch_expires_at timestamptz,
  add column gmail_watch_history_id text,
  add column gmail_watch_error text,
  add column gmail_watch_topic text,
  add column gmail_watch_attempted_at timestamptz;

-- The lease, expenses, processed IDs, and continuation cursor commit together.
create or replace function public.ledger_commit_scan(p_user uuid, p_lease uuid, p_run uuid, p_expenses jsonb, p_result jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare item jsonb; inserted integer := 0; changed integer; v_scanned integer;
begin
  perform 1 from public.ledger_gmail_connections where user_id = p_user and enabled and status = 'connected' and lease = p_lease and lease_until > now() for update;
  if not found then
    update public.ledger_sync_history set status = 'cancelled', completed_at = now() where id = p_run and user_id = p_user;
    return jsonb_build_object('cancelled', true, 'added', 0, 'duplicates', 0);
  end if;
  for item in select value from jsonb_array_elements(p_expenses) loop
    insert into public.ledger_expenses(user_id, id, payload) values (p_user, item->>'id', item) on conflict do nothing;
    get diagnostics changed = row_count;
    inserted := inserted + changed;
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
    added = inserted, duplicates = jsonb_array_length(p_expenses) - inserted, skipped = coalesce(p_result->'skipped', '[]'::jsonb)
    where id = p_run and user_id = p_user;
  return jsonb_build_object('added', inserted, 'duplicates', jsonb_array_length(p_expenses) - inserted);
end $$;
revoke all on function public.ledger_commit_scan(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ledger_commit_scan(uuid, uuid, uuid, jsonb, jsonb) to service_role;

-- A different mailbox must not inherit the preceding mailbox's processed IDs.
create or replace function public.ledger_finish_gmail(p_hash text, p_email text, p_tokens text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare account uuid;
begin
  update public.ledger_oauth_attempts set status = 'complete', encrypted_proof = ''
    where token_hash = p_hash and status = 'exchanging' and expires_at > now() returning user_id into account;
  if account is null then return false; end if;
  perform 1 from public.ledger_gmail_connections where user_id = account for update;
  if exists (select 1 from public.ledger_gmail_connections where user_id = account and lower(email) <> lower(p_email)) then
    delete from public.ledger_gmail_processed where user_id = account;
  end if;
  insert into public.ledger_gmail_connections(user_id,email,encrypted_tokens)
  values(account,p_email,p_tokens)
  on conflict(user_id) do update set email=excluded.email, encrypted_tokens=excluded.encrypted_tokens,
    status='connected', enabled=true, next_page_token=null, next_sync_at=now(), last_error=null, lease=null, lease_until=null,
    gmail_watch_expires_at=null, gmail_watch_history_id=null, gmail_watch_error=null,
    gmail_watch_topic=null, gmail_watch_attempted_at=null;
  return true;
end $$;
revoke all on function public.ledger_finish_gmail(text,text,text) from public, anon, authenticated;
grant execute on function public.ledger_finish_gmail(text,text,text) to service_role;
