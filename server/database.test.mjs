import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { sampleExpenses } from '../src/expenses.ts';
import { parseBillingMessage } from '../src/email/parser.ts';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const sessionA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; grant usage on schema auth to anon,authenticated,service_role;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id));
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session',true))$$;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261123145758_ledger_accounts_and_gmail.sql', import.meta.url), 'utf8'));
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [userA, 'a@example.com', userB, 'b@example.com']);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [sessionA, userA]);
  return db;
}

async function asUser(db, user = userA) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.session',$2,false)", [user, sessionA]);
}

test('PostgreSQL RLS isolates accounts and blocks credentials, forgery and signed-out sessions', async () => {
  const db = await database();
  try {
    const expense = sampleExpenses()[0];
    await asUser(db);
    await db.query('insert into ledger_expenses(user_id,id,payload) values($1,$2,$3)', [userA, expense.id, expense]);
    assert.equal((await db.query('select * from ledger_expenses')).rows.length, 1);
    await assert.rejects(db.query('insert into ledger_expenses(user_id,id,payload) values($1,$2,$3)', [userB, expense.id, expense]), /row-level security/);
    await assert.rejects(db.query('select * from ledger_gmail_connections'), /permission denied/);
    await assert.rejects(db.query('select * from ledger_oauth_attempts'), /permission denied/);
    await assert.rejects(db.query('select ledger_claim_scan($1)', [userA]), /permission denied/);
    const fake = { ...expense, id: 'fake', email: { messageId: 'forged' } };
    await assert.rejects(db.query('insert into ledger_expenses(user_id,id,payload) values($1,$2,$3)', [userA, fake.id, fake]), /row-level security/);
    await db.exec('reset role');
    await db.query('delete from auth.sessions where id=$1', [sessionA]);
    await asUser(db);
    assert.equal((await db.query('select * from ledger_expenses')).rows.length, 0);
    await assert.rejects(db.query('insert into ledger_expenses(user_id,id,payload) values($1,$2,$3)', [userA, 'new', { ...expense, id: 'new' }]), /row-level security/);
    await db.exec('reset role');
    assert.equal((await db.query('select * from ledger_profiles')).rows.length, 2);
  } finally { await db.close(); }
});

test('database sync leases, invoice deduplication and disconnect cancellation are atomic', async () => {
  const db = await database();
  try {
    const expense = parseBillingMessage({ id: 'message', accountKey: 'account', from: 'Vendor <invoice@vendor.test>', subject: 'Invoice', receivedAt: '2026-11-23T12:00:00Z', documents: [{ text: 'Invoice No: INV-123\nTotal: INR 1499' }] }).expenses[0];
    await db.query('insert into ledger_gmail_connections(user_id,email,encrypted_tokens) values($1,$2,$3)', [userA, 'a@example.com', 'ciphertext']);
    const claimed = (await db.query('select * from ledger_claim_scan($1)', [userA])).rows[0];
    assert.ok(claimed.lease);
    assert.equal((await db.query('select * from ledger_claim_scan($1)', [userA])).rows.length, 0);
    const run = (await db.query('insert into ledger_sync_history(user_id) values($1) returning id', [userA])).rows[0].id;
    const save = async (lease, items) => (await db.query('select ledger_commit_scan($1,$2,$3,$4,$5) as result', [userA, lease, run, JSON.stringify(items), JSON.stringify({ scanned: 1, skipped: [] })])).rows[0].result;
    assert.equal((await save(claimed.lease, [expense])).added, 1);
    const next = (await db.query('select * from ledger_claim_scan($1)', [userA])).rows[0];
    assert.equal((await save(next.lease, [expense])).duplicates, 1);
    assert.equal((await db.query('select * from ledger_expenses')).rows.length, 1);
    const pending = (await db.query('select * from ledger_claim_scan($1)', [userA])).rows[0];
    await db.query("update ledger_gmail_connections set enabled=false,status='disconnected' where user_id=$1", [userA]);
    assert.equal((await save(pending.lease, [{ ...expense, id: 'another' }])).cancelled, true);
    assert.equal((await db.query('select * from ledger_expenses')).rows.length, 1);
    assert.equal((await db.query('select * from ledger_claim_scan($1)', [userA])).rows.length, 0);
  } finally { await db.close(); }
});
