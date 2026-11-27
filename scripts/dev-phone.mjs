// Serves the app to the development build on a phone. The phone cannot reach the
// local email server, so it uses the hosted API unless EXPO_PUBLIC_EMAIL_API_URL is set.
import { spawn } from 'node:child_process';

const env = { ...process.env, EXPO_PUBLIC_EMAIL_API_URL: process.env.EXPO_PUBLIC_EMAIL_API_URL || 'https://ledger-expense-tracker-sekharendus-projects.vercel.app' };
const child = spawn('npx', ['expo', 'start', '--dev-client', '--clear', ...process.argv.slice(2)], { stdio: 'inherit', env, shell: process.platform === 'win32' });
child.on('exit', code => process.exit(code ?? 0));
