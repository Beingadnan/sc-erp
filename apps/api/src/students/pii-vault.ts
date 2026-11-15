import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { API_CONFIG } from '../config/api-config.js';
import type { ApiConfig } from '../config/api-config.js';

/**
 * Encryption for identity numbers (Aadhaar).
 *
 * Two keys are derived (HKDF-SHA256) from the server's master key, so no new secret needs
 * configuring and neither key is the MFA key itself:
 *  - an AES-256-GCM key; the ciphertext is bound to tenant + record + field (AAD), so a
 *    sealed value copied to another student or school fails to decrypt;
 *  - an HMAC key for the duplicate-detection index, mixed with the tenant id, so the same
 *    Aadhaar gives unrelated index values in different schools.
 *
 * Format: "p1:" + base64(iv[12] | tag[16] | ciphertext).
 */
@Injectable()
export class PiiVault {
  private readonly encKey: Buffer;
  private readonly indexKey: Buffer;

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    const master = Buffer.from(config.MFA_ENCRYPTION_KEY, 'base64');
    const derive = (info: string) =>
      Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
    this.encKey = derive('school-erp:pii:encryption:v1');
    this.indexKey = derive('school-erp:pii:index:v1');
  }

  private aad(tenantId: string, recordId: string, field: string) {
    return Buffer.from(`${tenantId}|${recordId}|${field}`);
  }

  seal(value: string, tenantId: string, recordId: string, field: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    cipher.setAAD(this.aad(tenantId, recordId, field));
    const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `p1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
  }

  open(sealed: string, tenantId: string, recordId: string, field: string): string {
    if (!sealed.startsWith('p1:')) throw new Error('Unknown sealed format');
    const raw = Buffer.from(sealed.slice(3), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, raw.subarray(0, 12));
    decipher.setAAD(this.aad(tenantId, recordId, field));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }

  /** Deterministic per-tenant index for uniqueness checks; not reversible. */
  index(value: string, tenantId: string, field: string): string {
    return createHmac('sha256', this.indexKey)
      .update(`${tenantId}|${field}|${value}`)
      .digest('base64url');
  }
}
