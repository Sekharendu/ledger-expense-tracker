import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'node:buffer';

// Default/--check: local validation only. --apply: enable the recovery job after
// migration review. --disable: remove that job. --status: read safe metadata.
// Credentials travel only in authenticated HTTPS RPC bodies, never SQL or argv.
const modes = process.argv.slice(2);
if (modes.some(mode => !['--check', '--apply', '--disable', '--status'].includes(mode)) || modes.length > 1) {
  console.error('Use one of: --check, --apply, --disable, --status.');
  process.exit(1);
}
const mode = modes[0] ?? '--check';
try {
  const values = parseEnv(await readFile(new URL('../.env.server', import.meta.url), 'utf8'));
  const projectUrl = 'https://oxwrqvpfwgkffppczixx.supabase.co';
  if (values.SUPABASE_URL !== projectUrl) throw new Error('Unexpected project');
  if (!values.SUPABASE_SECRET_KEY || values.SUPABASE_SECRET_KEY.startsWith('sb_publishable_')) throw new Error('Missing backend credential');
  if (!values.SUPABASE_SECRET_KEY.startsWith('sb_secret_')) {
    const claims = JSON.parse(Buffer.from(values.SUPABASE_SECRET_KEY.split('.')[1] ?? '', 'base64url').toString());
    if (claims.role !== 'service_role') throw new Error('Use a backend service credential');
  }
  if (['--check', '--apply'].includes(mode) && (!values.CRON_SECRET || values.CRON_SECRET.length < 32 || values.CRON_SECRET.length > 1024 || /[\u0000-\u001f\u007f]/.test(values.CRON_SECRET))) throw new Error('Missing cron credential');
  if (mode === '--check') {
    console.log(JSON.stringify({ ready: true, project: 'oxwrqvpfwgkffppczixx', schedule: '*/15 * * * *', remoteChanges: false, secretValuesDisplayed: false }));
  } else {
    const client = createClient(projectUrl, values.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(30_000) }) },
    });
    const { data, error } = mode === '--status'
      ? await client.rpc('ledger_email_schedule_status')
      : await client.rpc('ledger_configure_email_schedule', { p_secret: mode === '--apply' ? values.CRON_SECRET : null, p_enabled: mode === '--apply' });
    if (error || !data || typeof data !== 'object') throw new Error('RPC failed');
    // Whitelist metadata: never print arbitrary provider responses or errors.
    console.log(JSON.stringify({ project: 'oxwrqvpfwgkffppczixx', enabled: data.enabled === true,
      ...(typeof data.configured === 'boolean' ? { configured: data.configured } : {}),
      schedule: data.schedule === '*/15 * * * *' ? data.schedule : null,
      jobId: Number.isSafeInteger(data.jobId) ? data.jobId : null, secretValuesDisplayed: false }));
  }
} catch {
  console.error('Email schedule operation failed. Check .env.server, backend permissions, and the reviewed scheduler migration. No credential values were displayed.');
  process.exitCode = 1;
}
