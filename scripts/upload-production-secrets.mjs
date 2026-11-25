import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';

// Run through npm so its CLI path is available without shell command building:
// node scripts/upload-production-secrets.mjs --check
// npm run configure:production
// npm run configure:gmail -- --check
// npm run configure:gmail
// The real upload requires a prior `npx vercel@66.6.0 login` browser approval.
const project = 'prj_ignV7OJ4o5b9g1jydG8B7mGbUgDO';
const team = 'team_bYa60xKUiiqr9GNKYGfTF2nZ';
const gmail = process.argv.includes('--gmail');
const names = gmail ? ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'] : ['SUPABASE_SECRET_KEY', 'TOKEN_ENCRYPTION_KEY', 'CRON_SECRET'];
const values = parseEnv(await readFile(new URL('../.env.server', import.meta.url), 'utf8'));
const gmailCallback = 'https://ledger-expense-tracker-sekharendus-projects.vercel.app/api/oauth/google/callback';
if (gmail) values.GOOGLE_REDIRECT_URI ||= gmailCallback;
const missing = names.filter(name => !values[name]);
if (missing.length) {
  console.log(JSON.stringify({ ready: false, missingVariables: missing, secretValuesDisplayed: false }));
  process.exit(1);
}
if (gmail) {
  if (!values.GOOGLE_CLIENT_ID.endsWith('.apps.googleusercontent.com')) throw new Error('Use the Google Web application OAuth client ID.');
  if (values.GOOGLE_REDIRECT_URI !== gmailCallback) throw new Error('The Gmail production callback must match GMAIL_SETUP.md exactly.');
} else {
  if (Buffer.from(values.TOKEN_ENCRYPTION_KEY, 'base64').length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes.');
  if (values.SUPABASE_SECRET_KEY.startsWith('sb_publishable_')) throw new Error('SUPABASE_SECRET_KEY contains a public key.');
}

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
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Vercel refused the operation. Check CLI login and project/team access.')));
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    });
  }
  await vercel(['whoami']);
  for (const name of names) {
    const type = gmail && name !== 'GOOGLE_CLIENT_SECRET' ? 'config' : 'secret';
    await vercel(['env', 'add', name, '--environment', 'production', '--type', type, '--project', project, '--scope', team, '--yes', ...(gmail ? ['--force'] : [])], values[name]);
    console.log(`Configured ${name} for production.`);
  }
  console.log('Production secrets configured. A new production deployment is required.');
}
