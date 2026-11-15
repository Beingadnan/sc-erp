import { z } from 'zod';
import { tokenSchema } from './auth.js';

/** Parents' passwords: shorter than staff's (no privileges), still not trivial. */
export const parentPasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .refine((p) => !/^(.)\1+$/.test(p), 'Do not repeat one character')
  .refine(
    (p) => !/^(0123456789|12345678|password|abcdefgh)/i.test(p),
    'Choose a less common password',
  );

export const portalInviteSchema = z.object({
  guardianId: z.uuid(),
  purpose: z.enum(['activate', 'reset']).default('activate'),
});
export type PortalInviteInput = z.infer<typeof portalInviteSchema>;

export const portalPeekSchema = z.object({ token: tokenSchema });

/** New account or reset: `password` is the new password. Existing account: its current password. */
export const portalAcceptSchema = z.object({
  token: tokenSchema,
  password: z.string().min(1).max(128),
});

export const familyPayLinkSchema = z.object({
  amount: z.number().int().min(100).max(10_000_000_000).optional(),
});

export const familyMonthQuerySchema = z.object({
  academicYearId: z.uuid().optional(),
});
