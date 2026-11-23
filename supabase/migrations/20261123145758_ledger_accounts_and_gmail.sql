create schema if not exists ledger_private;
revoke all on schema ledger_private from public, anon, authenticated;
grant usage on schema ledger_private to authenticated;

-- Internal session lookup: revoke access immediately after Supabase sign-out,
-- including for a JWT whose signature/expiry are otherwise still valid.
create function ledger_private.session_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from auth.sessions where id = nullif(auth.jwt()->>'session_id','')::uuid and user_id = (select auth.uid())
  );
$$;
revoke all on function ledger_private.session_active() from public, anon;
grant execute on function ledger_private.session_active() to authenticated;

create table public.ledger_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.ledger_profiles enable row level security;
create policy profiles_read_own on public.ledger_profiles for select to authenticated using (id = (select auth.uid()) and (select ledger_private.session_active()));
grant select on public.ledger_profiles to authenticated;
grant all on public.ledger_profiles to service_role;
revoke all on public.ledger_profiles from anon;

create function ledger_private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ledger_profiles(id, email, name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
revoke all on function ledger_private.create_profile() from public, anon, authenticated;
create trigger ledger_profile_on_signup after insert or update of email on auth.users
for each row execute function ledger_private.create_profile();

create table public.ledger_expenses (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 500),
  payload jsonb not null,
  dedupe_key text generated always as (
    case when payload ? 'email' then
      coalesce(payload#>>'{email,invoiceKey}', id) || ':' || (payload->>'kind') || ':' || (payload#>>'{email,originalAmount}')
    else id end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, dedupe_key),
  check (payload ?& array['id','merchant','amount','date','category','status','kind','source','note']),
  check (payload->>'id' = id),
  check (jsonb_typeof(payload->'amount') = 'number' and (payload->>'amount')::numeric > 0 and (payload->>'amount')::numeric <= 9007199254740991 and trunc((payload->>'amount')::numeric) = (payload->>'amount')::numeric),
  check (payload->>'status' in ('paid','unpaid','review')),
  check (payload->>'kind' in ('expense','refund')),
  check (not (payload->>'kind' = 'refund' and payload->>'status' = 'unpaid')),
  check (payload->>'category' in ('Shopping','Food','Transport','Utilities','Software','Other')),
  check (length(trim(payload->>'merchant')) between 1 and 150),
  check ((payload->>'date')::date is not null)
);
alter table public.ledger_expenses enable row level security;
create policy expenses_read_own on public.ledger_expenses for select to authenticated using (user_id = (select auth.uid()) and (select ledger_private.session_active()));
create policy expenses_add_own on public.ledger_expenses for insert to authenticated with check (user_id = (select auth.uid()) and (select ledger_private.session_active()) and not (payload ? 'email'));
create policy expenses_edit_own on public.ledger_expenses for update to authenticated using (user_id = (select auth.uid()) and (select ledger_private.session_active())) with check (user_id = (select auth.uid()) and (select ledger_private.session_active()));
create policy expenses_delete_own on public.ledger_expenses for delete to authenticated using (user_id = (select auth.uid()) and (select ledger_private.session_active()));
grant select, insert, update, delete on public.ledger_expenses to authenticated;
grant all on public.ledger_expenses to service_role;
revoke all on public.ledger_expenses from anon;
create index expenses_user_date_idx on public.ledger_expenses (user_id, (payload->>'date') desc);

create function ledger_private.protect_expense_evidence() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if old.payload ? 'email' then new.payload = jsonb_set(new.payload, '{email}', old.payload->'email');
    else new.payload = new.payload - 'email'; end if;
  end if;
  new.updated_at = now();
  return new;
end $$;
revoke all on function ledger_private.protect_expense_evidence() from public, anon, authenticated;
create trigger ledger_preserve_evidence before update on public.ledger_expenses
for each row execute function ledger_private.protect_expense_evidence();

create table public.ledger_gmail_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  encrypted_tokens text,
  status text not null default 'connected' check (status in ('connected','reconnect_required','revoke_pending','disconnected')),
  enabled boolean not null default true,
  next_page_token text,
  next_sync_at timestamptz default now(),
  last_sync_at timestamptz,
  last_error text,
  lease uuid,
  lease_until timestamptz,
  connected_at timestamptz not null default now()
);
alter table public.ledger_gmail_connections enable row level security;
revoke all on public.ledger_gmail_connections from public, anon, authenticated;
grant all on public.ledger_gmail_connections to service_role;
create index gmail_due_idx on public.ledger_gmail_connections(next_sync_at) where enabled;

create table public.ledger_oauth_attempts (
  token_hash text primary key,
  state_hash text unique not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  encrypted_proof text not null,
  status text not null default 'pending' check (status in ('pending','exchanging','complete','error','cancelled')),
  error text,
  expires_at timestamptz not null
);
alter table public.ledger_oauth_attempts enable row level security;
revoke all on public.ledger_oauth_attempts from public, anon, authenticated;
grant all on public.ledger_oauth_attempts to service_role;
create index oauth_attempts_user_idx on public.ledger_oauth_attempts(user_id);
create index oauth_attempts_expiry_idx on public.ledger_oauth_attempts(expires_at);

create table public.ledger_sync_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'running' check (status in ('running','complete','error','cancelled')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  scanned integer not null default 0,
  added integer not null default 0,
  duplicates integer not null default 0,
  error text,
  skipped jsonb not null default '[]'::jsonb
);
alter table public.ledger_sync_history enable row level security;
create policy sync_history_read_own on public.ledger_sync_history for select to authenticated using (user_id = (select auth.uid()) and (select ledger_private.session_active()));
grant select on public.ledger_sync_history to authenticated;
revoke all on public.ledger_sync_history from anon;
grant all on public.ledger_sync_history to service_role;
create index sync_history_user_idx on public.ledger_sync_history(user_id, started_at desc);

create function public.ledger_claim_scan(p_user uuid) returns setof public.ledger_gmail_connections
language sql security invoker set search_path = '' as $$
  update public.ledger_gmail_connections set lease = gen_random_uuid(), lease_until = now() + interval '5 minutes'
  where user_id = p_user and enabled and status = 'connected' and (lease_until is null or lease_until < now())
  returning *;
$$;
revoke all on function public.ledger_claim_scan(uuid) from public, anon, authenticated;
grant execute on function public.ledger_claim_scan(uuid) to service_role;

create function public.ledger_finish_gmail(p_hash text, p_email text, p_tokens text) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare account uuid;
begin
  update public.ledger_oauth_attempts set status = 'complete', encrypted_proof = ''
    where token_hash = p_hash and status = 'exchanging' and expires_at > now() returning user_id into account;
  if account is null then return false; end if;
  insert into public.ledger_gmail_connections(user_id,email,encrypted_tokens)
  values(account,p_email,p_tokens)
  on conflict(user_id) do update set email=excluded.email, encrypted_tokens=excluded.encrypted_tokens,
    status='connected', enabled=true, next_page_token=null, next_sync_at=now(), last_error=null, lease=null, lease_until=null;
  return true;
end $$;
revoke all on function public.ledger_finish_gmail(text,text,text) from public, anon, authenticated;
grant execute on function public.ledger_finish_gmail(text,text,text) to service_role;

create function public.ledger_commit_scan(p_user uuid, p_lease uuid, p_run uuid, p_expenses jsonb, p_result jsonb) returns jsonb
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
  v_scanned := coalesce((p_result->>'scanned')::integer, 0);
  update public.ledger_gmail_connections set lease = null, lease_until = null, last_sync_at = now(), last_error = null,
    next_page_token = p_result->>'nextPageToken', next_sync_at = now() + interval '15 minutes' where user_id = p_user;
  update public.ledger_sync_history set status = 'complete', completed_at = now(), scanned = v_scanned,
    added = inserted, duplicates = jsonb_array_length(p_expenses) - inserted, skipped = coalesce(p_result->'skipped', '[]'::jsonb)
    where id = p_run and user_id = p_user;
  return jsonb_build_object('added', inserted, 'duplicates', jsonb_array_length(p_expenses) - inserted);
end $$;
revoke all on function public.ledger_commit_scan(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ledger_commit_scan(uuid, uuid, uuid, jsonb, jsonb) to service_role;

-- Server-only lookup for authenticated Gmail API calls. Never grant this RPC to clients.
create function public.ledger_session_active(p_user uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.sessions where id = p_session and user_id = p_user);
$$;
revoke all on function public.ledger_session_active(uuid,uuid) from public, anon, authenticated;
grant execute on function public.ledger_session_active(uuid,uuid) to service_role;
