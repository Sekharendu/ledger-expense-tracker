import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { sampleExpenses } from '../src/expenses.ts';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const source = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id));
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;`);
  await db.exec(await source('20261123145758_ledger_accounts_and_gmail.sql'));
  await db.exec(await source('20261125124156_ledger_automatic_email_tracking.sql'));
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [userA, 'a@example.test', userB, 'b@example.test']);
  return db;
}

test('processed Gmail IDs, expenses and cursor commit atomically, respect cancellation, and stay private', async () => {
  const db = await database();
  try {
    await db.query('insert into ledger_gmail_connections(user_id,email,encrypted_tokens) values($1,$2,$3)', [userA, 'a@example.test', 'encrypted']);
    const lease = async () => (await db.query('select * from ledger_claim_scan($1)', [userA])).rows[0].lease;
    const run = (await db.query('insert into ledger_sync_history(user_id) values($1) returning id', [userA])).rows[0].id;
    const save = async (claim, expenses, result) => (await db.query('select ledger_commit_scan($1,$2,$3,$4,$5) as result', [userA, claim, run, JSON.stringify(expenses), JSON.stringify(result)])).rows[0].result;
    const expense = sampleExpenses()[0];
    const claim = await lease();
    await db.exec('set role service_role');
    assert.equal((await save(claim, [expense], { processedMessageIds: ['message-1', 'skipped-2', 'message-1'], nextPageToken: 'continuation', hasMore: true })).added, 1);
    assert.equal((await db.query('select count(*)::int as n from ledger_gmail_processed')).rows[0].n, 2);
    const connection = (await db.query('select * from ledger_gmail_connections')).rows[0];
    assert.equal(connection.next_page_token, 'continuation');
    assert.ok(new Date(connection.next_sync_at).getTime() <= Date.now() + 1000);
    await db.exec('reset role');
    const revisionClaim = await lease();
    await save(revisionClaim, [], { processedMessageIds: ['message-1', 'message-1'], processorVersion: 'payment-v2', nextPageToken: 'continuation', hasMore: true });
    assert.equal((await db.query("select parser_version from ledger_gmail_processed where message_id='message-1'")).rows[0].parser_version, 'payment-v2');
    assert.equal((await db.query('select count(*)::int as n from ledger_expenses')).rows[0].n, 1);
    const nextClaim = await lease();
    await assert.rejects(save(nextClaim, [{ ...expense, id: 'rollback-expense' }], { processedMessageIds: [null], nextPageToken: 'bad-cursor' }), /not-null/);
    assert.equal((await db.query("select count(*)::int as n from ledger_expenses where id='rollback-expense'")).rows[0].n, 0);
    assert.equal((await db.query('select next_page_token,lease from ledger_gmail_connections')).rows[0].lease, nextClaim);
    await db.query("update ledger_gmail_connections set enabled=false,status='disconnected' where user_id=$1", [userA]);
    assert.equal((await save(nextClaim, [{ ...expense, id: 'cancelled' }], { processedMessageIds: ['cancelled-id'], nextPageToken: 'cancelled-cursor' })).cancelled, true);
    assert.equal((await db.query("select count(*)::int as n from ledger_gmail_processed where message_id='cancelled-id'")).rows[0].n, 0);
    assert.equal((await db.query('select next_page_token from ledger_gmail_connections')).rows[0].next_page_token, 'continuation');
    await db.query('insert into ledger_gmail_processed(user_id,message_id) values($1,$2)', [userB, 'message-1']);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from ledger_gmail_processed'), /permission denied/);
      await assert.rejects(db.query('select gmail_watch_topic,gmail_watch_expires_at from ledger_gmail_connections'), /permission denied/);
      await assert.rejects(db.query('select ledger_commit_scan($1,$2,$3,$4,$5)', [userA, nextClaim, run, '[]', '{}']), /permission denied/);
      await db.exec('reset role');
    }
    await db.query('delete from auth.users where id=$1', [userA]);
    assert.deepEqual((await db.query('select user_id,message_id from ledger_gmail_processed')).rows, [{ user_id: userB, message_id: 'message-1' }]);
  } finally { await db.close(); }
});

test('reconnecting resets stale watch state and a changed mailbox discards only its old processed cache', async () => {
  const db = await database();
  try {
    await db.query(`insert into ledger_gmail_connections(user_id,email,encrypted_tokens,gmail_watch_topic,gmail_watch_history_id,gmail_watch_expires_at,gmail_watch_attempted_at,gmail_watch_error)
      values($1,$2,'encrypted','old-topic','old-history',now(),now(),'safe old error')`, [userA, 'a@example.test']);
    await db.query('insert into ledger_gmail_processed(user_id,message_id) values($1,$2),($3,$2)', [userA, 'same-id', userB]);
    for (const [index, email] of ['A@example.test', 'new-mailbox@example.test'].entries()) {
      const token = `attempt-${index}`;
      await db.query("insert into ledger_oauth_attempts(token_hash,state_hash,user_id,encrypted_proof,status,expires_at) values($1,$1,$2,'encrypted-proof','exchanging',now()+interval '10 minutes')", [token, userA]);
      await db.exec('set role service_role');
      assert.equal((await db.query('select ledger_finish_gmail($1,$2,$3) as complete', [token, email, 'new-encrypted'])).rows[0].complete, true);
      const watch = (await db.query('select gmail_watch_topic,gmail_watch_history_id,gmail_watch_expires_at,gmail_watch_attempted_at,gmail_watch_error from ledger_gmail_connections where user_id=$1', [userA])).rows[0];
      assert.ok(Object.values(watch).every(value => value === null));
      assert.equal((await db.query('select count(*)::int as n from ledger_gmail_processed where user_id=$1', [userA])).rows[0].n, index === 0 ? 1 : 0);
      assert.equal((await db.query('select count(*)::int as n from ledger_gmail_processed where user_id=$1', [userB])).rows[0].n, 1);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});

// PGlite has no hosted cron/net/Vault extensions. These narrow stand-ins exercise
// our SQL permissions, transaction behavior, fixed target and secret-free job text;
// actual encryption and asynchronous networking require hosted verification.
async function scheduler(db) {
  await db.exec(`create schema vault; create schema net; create schema cron;
    create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, decrypted_secret text);
    create view vault.decrypted_secrets as select * from vault.secrets;
    create function vault.create_secret(secret text,name text,description text) returns uuid language sql as $$
      insert into vault.secrets(name,decrypted_secret) values($2,$1) returning id;
    $$;
    create function vault.update_secret(secret_id uuid,new_secret text) returns void language sql as $$
      update vault.secrets set decrypted_secret=$2 where id=$1;
    $$;
    create table cron.job(jobid bigint generated always as identity primary key, jobname text unique,schedule text,command text,active boolean default true);
    create function cron.schedule(jobname text,schedule text,command text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command) values($1,$2,$3)
      on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command,active=true returning jobid;
    $$;
    create function cron.unschedule(job_id bigint) returns boolean language sql as $$
      with removed as (delete from cron.job where jobid=$1 returning *) select exists(select 1 from removed);
    $$;
    create table net.requests(id bigint generated always as identity,url text,headers jsonb,timeout_milliseconds int);
    create function net.http_get(url text,headers jsonb,timeout_milliseconds int) returns bigint language sql as $$
      insert into net.requests(url,headers,timeout_milliseconds) values($1,$2,$3) returning id;
    $$;`);
  const migration = (await source('20261125124210_ledger_email_recovery_schedule.sql')).replace(/^create extension[^;]*;\s*$/gm, '');
  await db.exec(migration);
}

test('recovery configuration is service-only, idempotent, fixed-target and never embeds its credential in cron SQL', async () => {
  const db = await database();
  try {
    await scheduler(db);
    assert.equal((await db.query('select count(*)::int as n from cron.job')).rows[0].n, 0, 'migration does not activate a job');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select public.ledger_configure_email_schedule($1,true)', ['x'.repeat(40)]), /permission denied/);
      await assert.rejects(db.query('select public.ledger_email_schedule_status()'), /permission denied/);
      await assert.rejects(db.query('select ledger_private.configure_email_schedule($1,true)', ['x'.repeat(40)]), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await assert.rejects(db.query('select ledger_private.invoke_email_recovery()'), /permission denied/);
    await assert.rejects(db.query('select * from vault.decrypted_secrets'), /permission denied/);
    await assert.rejects(db.query('select public.ledger_configure_email_schedule($1,true)', ['short']), /configuration failed/);
    const configure = async token => (await db.query('select public.ledger_configure_email_schedule($1,true) as result', [token])).rows[0].result;
    const first = await configure('test-only-credential-'.repeat(3));
    const second = await configure('rotated-test-credential-'.repeat(3));
    assert.equal(first.jobId, second.jobId);
    assert.equal(second.schedule, '*/15 * * * *');
    const status = (await db.query('select public.ledger_email_schedule_status() as result')).rows[0].result;
    assert.deepEqual(status, { enabled: true, configured: true, schedule: '*/15 * * * *', jobId: first.jobId });
    await db.exec('reset role');
    assert.equal((await db.query('select command from cron.job')).rows[0].command, 'select ledger_private.invoke_email_recovery();');
    assert.equal((await db.query('select count(*)::int as n from vault.secrets')).rows[0].n, 1);
    await db.query('select ledger_private.invoke_email_recovery()');
    const request = (await db.query('select * from net.requests')).rows[0];
    assert.equal(request.url, 'https://ledger-expense-tracker-sekharendus-projects.vercel.app/api/cron');
    assert.equal(request.timeout_milliseconds, 240000);
    assert.equal(request.headers.Authorization, `Bearer ${'rotated-test-credential-'.repeat(3)}`);
    await db.exec('set role service_role');
    await db.query('select public.ledger_configure_email_schedule(null,false)');
    assert.equal((await db.query('select public.ledger_email_schedule_status() as result')).rows[0].result.enabled, false);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as n from cron.job')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from vault.secrets')).rows[0].n, 1, 'disabling retains encrypted credential for later reuse');
  } finally { await db.close(); }
});
