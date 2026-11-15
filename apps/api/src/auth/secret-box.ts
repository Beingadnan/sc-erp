import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for small secrets at rest (MFA seeds).
 * Format: "v1:" + base64(iv[12] | tag[16] | ciphertext).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('SecretBox key must be 32 bytes');
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
  }

  open(sealed: string): string {
    if (!sealed.startsWith('v1:')) throw new Error('Unknown secret format');
    const raw = Buffer.from(sealed.slice(3), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}
