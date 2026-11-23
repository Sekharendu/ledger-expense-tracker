import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const tokenHash = value => createHash('sha256').update(value).digest('hex');

export async function createVault(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const keyFile = path.join(directory, 'encryption.key');
  let key;
  try { key = await readFile(keyFile); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    key = randomBytes(32);
    await writeFile(keyFile, key, { flag: 'wx', mode: 0o600 });
  }
  if (key.length !== 32) throw new Error('Invalid vault encryption key. Restore the original key.');
  const filename = path.join(directory, 'connections.enc');
  let records = {};
  try {
    const encrypted = await readFile(filename);
    const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12));
    decipher.setAuthTag(encrypted.subarray(12, 28));
    records = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8'));
    if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error('Invalid vault');
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot decrypt saved Gmail connections. Restore the vault and encryption key together.'); }
  let queue = Promise.resolve();
  async function persist(next) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(next)), cipher.final()]);
    const temporary = `${filename}.tmp`;
    await writeFile(temporary, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600 });
    await rename(temporary, filename);
    records = next;
  }
  function mutate(change) {
    const operation = queue.then(() => persist(change({ ...records })));
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    get: hash => records[hash] ? structuredClone(records[hash]) : undefined,
    set: (hash, record) => mutate(next => ({ ...next, [hash]: record })),
    remove: hash => mutate(next => { delete next[hash]; return next; }),
  };
}
