import { z } from 'zod';

export const uuidSchema = z.uuid();

/** Cursor pagination used by every list endpoint (docs/api/conventions.md). */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(512).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Header sent by clients on payment, import and other non-idempotent POSTs. */
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
