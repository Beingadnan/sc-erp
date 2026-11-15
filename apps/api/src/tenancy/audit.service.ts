import { Injectable } from '@nestjs/common';
import { schema } from '@school-erp/db';
import type { Transaction } from '@school-erp/db';
import type { TenantAccess } from '../auth/access.js';

// Note: plain `code` is NOT secret (campus/class codes); only auth-style codes are.
const SECRET_KEYS =
  /pass(word)?|token|secret|hash|otp|recovery|mfa|totp|^(verification|reset|auth)_?code$/i;
const MASKED_KEYS = /^(email|phone|mobile)$/i;

const mask = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  if (value.includes('@')) {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return value.length > 4 ? `${'*'.repeat(value.length - 4)}${value.slice(-4)}` : '****';
};

/** Removes secrets and masks contact details before anything is written to the audit log. */
export const redactForAudit = (value: unknown, depth = 0): unknown => {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactForAudit(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(k)) out[k] = '[redacted]';
    else if (MASKED_KEYS.test(k)) out[k] = mask(v);
    else out[k] = redactForAudit(v, depth + 1);
  }
  return out;
};

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  campusId?: string | null;
  diff?: Record<string, unknown>;
}

/**
 * Writes audit entries in the SAME transaction as the change they describe, so a change
 * and its audit record commit or roll back together.
 */
@Injectable()
export class AuditService {
  async record(tx: Transaction, access: TenantAccess, entry: AuditEntry): Promise<void> {
    await tx.insert(schema.auditLogs).values({
      tenantId: access.tenantId,
      actorUserId: access.userId,
      actorType: 'user',
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      campusId: entry.campusId ?? null,
      diff: entry.diff ? (redactForAudit(entry.diff) as Record<string, unknown>) : null,
      requestId: access.requestId,
      ip: access.ip,
    });
  }
}
