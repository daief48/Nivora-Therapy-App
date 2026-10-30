import crypto from 'node:crypto';

export interface Cipher {
  encrypt(plain: string): string;
  decrypt(blob: string): string;
}

// AES-256-GCM envelope: "<keyId>.<iv>.<tag>.<ciphertext>" (base64url). The first configured key encrypts;
// all configured keys can decrypt, which allows key rotation (prepend a new key, keep the old ones).
export function createCipher(keysSpec: string): Cipher {
  const keys = new Map<string, Buffer>();
  let primary = '';
  for (const part of keysSpec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(':');
    if (idx < 1) throw new Error('DATA_ENCRYPTION_KEYS entries must look like id:base64key');
    const id = part.slice(0, idx);
    const key = Buffer.from(part.slice(idx + 1), 'base64');
    if (key.length !== 32) throw new Error(`Encryption key "${id}" must be 32 bytes (base64)`);
    keys.set(id, key);
    primary ||= id;
  }
  if (!primary) throw new Error('No encryption keys configured');
  return {
    encrypt(plain) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', keys.get(primary)!, iv);
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return [primary, iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
    },
    decrypt(blob) {
      const [kid, iv, tag, ct] = blob.split('.');
      const key = keys.get(kid ?? '');
      if (!key || !iv || !tag || ct === undefined) throw new Error('Cannot decrypt: unknown key or malformed data');
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
    },
  };
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
