-- Hosted Supabase extensions; deliberately separate from the portable core schema.
-- Applying this migration does NOT schedule a job or install a credential.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Runs as the postgres-owned cron job, never as an application user. No URL argument
-- prevents the stored bearer credential from being sent to another host.
create function ledger_private.invoke_email_recovery() returns bigint
language plpgsql security invoker set search_path = '' as $$
declare bearer text;
begin
  select decrypted_secret into bearer from vault.decrypted_secrets where name = 'ledger_email_cron_secret';
  if bearer is null then return null; end if;
  return net.http_get(
    url := 'https://ledger-expense-tracker-sekharendus-projects.vercel.app/api/cron',
    headers := jsonb_build_object('Authorization', 'Bearer ' || bearer),
    timeout_milliseconds := 240000
  );
end $$;
revoke all on function ledger_private.invoke_email_recovery() from public, anon, authenticated, service_role;

-- Elevation is needed only for Vault and cron ownership. Public wrappers below are
-- SECURITY INVOKER; execute is granted solely to the backend service_role.
create function ledger_private.configure_email_schedule(p_secret text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare secret_id uuid; job_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('ledger-email-recovery-config', 0));
  if p_enabled is null then raise exception 'Specify whether the recovery schedule is enabled'; end if;
  if p_enabled then
    if p_secret is null or length(p_secret) < 32 or length(p_secret) > 1024 or p_secret ~ '[[:cntrl:]]' then
      raise exception 'A valid dedicated cron credential is required';
    end if;
    select id into secret_id from vault.secrets where name = 'ledger_email_cron_secret';
    if secret_id is null then
      perform vault.create_secret(p_secret, 'ledger_email_cron_secret', 'Dedicated Ledger recovery endpoint credential');
    else
      perform vault.update_secret(secret_id, p_secret);
    end if;
    job_id := cron.schedule('ledger-email-recovery', '*/15 * * * *', 'select ledger_private.invoke_email_recovery();');
  else
    select jobid into job_id from cron.job where jobname = 'ledger-email-recovery';
    if job_id is not null then perform cron.unschedule(job_id); end if;
  end if;
  return jsonb_build_object('enabled', p_enabled, 'schedule', '*/15 * * * *', 'jobId', job_id);
exception when others then
  -- Do not copy provider exception messages, SQL arguments, or the credential out.
  raise exception 'Email recovery schedule configuration failed';
end $$;
revoke all on function ledger_private.configure_email_schedule(text,boolean) from public, anon, authenticated;
grant usage on schema ledger_private to service_role;
grant execute on function ledger_private.configure_email_schedule(text,boolean) to service_role;

create function public.ledger_configure_email_schedule(p_secret text, p_enabled boolean default true) returns jsonb
language sql security invoker set search_path = '' as $$
  select ledger_private.configure_email_schedule(p_secret, p_enabled);
$$;
revoke all on function public.ledger_configure_email_schedule(text,boolean) from public, anon, authenticated;
grant execute on function public.ledger_configure_email_schedule(text,boolean) to service_role;

create function ledger_private.email_schedule_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'configured', exists(select 1 from vault.secrets where name = 'ledger_email_cron_secret'),
    'enabled', coalesce((select active from cron.job where jobname = 'ledger-email-recovery'), false),
    'schedule', (select schedule from cron.job where jobname = 'ledger-email-recovery'),
    'jobId', (select jobid from cron.job where jobname = 'ledger-email-recovery')
  );
$$;
revoke all on function ledger_private.email_schedule_status() from public, anon, authenticated;
grant execute on function ledger_private.email_schedule_status() to service_role;
create function public.ledger_email_schedule_status() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select ledger_private.email_schedule_status();
$$;
revoke all on function public.ledger_email_schedule_status() from public, anon, authenticated;
grant execute on function public.ledger_email_schedule_status() to service_role;

-- Vault encrypts this dedicated credential at rest. pg_net temporarily places the
-- decrypted header in its request queue, readable by direct database-login roles.
-- Do not expose the net/vault schemas, grant database logins to app users, or put a
-- Supabase service key in this job. Never select/log queued headers for diagnostics.
