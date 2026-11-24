import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

// Run through npm so its CLI path is available without shell command building:
// node scripts/upload-production-secrets.mjs --check
// npm run configure:production
// The real upload requires a prior `npx vercel@66.6.0 login` browser approval.
const project = 'prj_ignV7OJ4o5b9g1jydG8B7mGbUgDO';
const team = 'team_bYa60xKUiiqr9GNKYGfTF2nZ';
const names = ['SUPABASE_SECRET_KEY', 'TOKEN_ENCRYPTION_KEY', 'CRON_SECRET'];
const values = parseEnv(await readFile(new URL('../.env.server', import.meta.url), 'utf8'));
const missing = names.filter(name => !values[name]);
if (missing.length) throw new Error(`Missing local variables: ${missing.join(', ')}`);
if (Buffer.from(values.TOKEN_ENCRYPTION_KEY, 'base64').length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes.');
if (values.SUPABASE_SECRET_KEY.startsWith('sb_publishable_')) throw new Error('SUPABASE_SECRET_KEY contains a public key.');

if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ project, team, environment: 'production', configuredVariables: names, secretValuesDisplayed: false }));
} else {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run with: npm run configure:production');
  function vercel(arguments_, input = '') {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [npmCli, 'exec', '--yes', '--package=vercel@66.6.0', '--', 'vercel', ...arguments_], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      // The CLI may return values in metadata. Consume its output without logging it.
      child.stdout.on('data', () => {});
      child.stderr.on('data', () => {});
      child.once('error', () => reject(new Error('Could not start Vercel CLI.')));
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Vercel refused the operation. Check CLI login and project/team access; existing values are not overwritten.')));
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  }
  await vercel(['whoami']);
  for (const name of names) {
    await vercel(['env', 'add', name, '--environment', 'production', '--type', 'secret', '--project', project, '--scope', team, '--yes'], values[name]);
    console.log(`Configured ${name} for production.`);
  }
  console.log('Production secrets configured. A new production deployment is required.');
}
