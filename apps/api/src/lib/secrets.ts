import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Env } from '../env';

/**
 * Secrets the server has to read back later (webhook signing keys, bank connection tokens) are
 * kept encrypted with AES-256-GCM. The key comes from ENCRYPTION_KEY, or is derived from
 * AUTH_SECRET. Sealed values look like "v1.<base64 of iv, tag and ciphertext>".
 */
const keys = new Map<string, Buffer>();

function keyFor(env: Pick<Env, 'ENCRYPTION_KEY' | 'AUTH_SECRET'>) {
  const material = env.ENCRYPTION_KEY ?? env.AUTH_SECRET;
  let key = keys.get(material);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', material, 'expense-tracker', 'sealed-secrets-v1', 32));
    keys.set(material, key);
  }
  return key;
}

export function sealSecret(env: Pick<Env, 'ENCRYPTION_KEY' | 'AUTH_SECRET'>, plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(env), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
}

/** Throws if the value was sealed with another key (e.g. after changing AUTH_SECRET). */
export function openSecret(env: Pick<Env, 'ENCRYPTION_KEY' | 'AUTH_SECRET'>, sealed: string) {
  if (!sealed.startsWith('v1.')) throw new Error('Unknown sealed secret format');
  const raw = Buffer.from(sealed.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', keyFor(env), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
