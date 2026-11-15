import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

const COMMON_PASSWORDS = new Set([
  'password123',
  'password@123',
  'qwerty12345',
  '1234567890',
  'admin@1234',
  'welcome@123',
  'iloveyou123',
  'school@123',
  'india@1234',
]);

/** NIST-style: length over composition rules; block the obvious ones. */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((p) => !/^(.)\1+$/.test(p), 'Do not repeat one character')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'This password is too common');

export const RESERVED_SLUGS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'platform',
  'mail',
  'static',
  'assets',
  'support',
  'help',
  'status',
  'docs',
]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/,
    '3–40 characters: lowercase letters, numbers and hyphens',
  )
  .refine((s) => !RESERVED_SLUGS.has(s), 'This address is reserved');

export const BOARDS = ['CBSE', 'RBSE', 'CISCE', 'STATE_OTHER', 'IB', 'CAMBRIDGE', 'OTHER'] as const;
export const boardSchema = z.enum(BOARDS);
export type Board = z.infer<typeof boardSchema>;

export const timezoneSchema = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

const personName = z.string().trim().min(2).max(120);

export const registerSchoolSchema = z.object({
  schoolName: z.string().trim().min(3).max(150),
  slug: slugSchema,
  campusName: z.string().trim().min(2).max(150),
  board: boardSchema,
  fullName: personName,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterSchoolInput = z.infer<typeof registerSchoolSchema>;

/** Sign in with an email (staff) or a mobile number (parents). */
export const loginSchema = z
  .object({
    email: emailSchema.optional(),
    phone: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s()-]/g, ''))
      .transform((v) => (/^0?[6-9]\d{9}$/.test(v) ? `+91${v.slice(-10)}` : v))
      .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid mobile number'))
      .optional(),
    password: z.string().min(1).max(128),
    /** Which sign-in page was used: staff (/login) or parents (/parent/login). */
    as: z.enum(['staff', 'parent']).optional(),
  })
  .refine((v) => !!v.email !== !!v.phone, {
    message: 'Enter your email or mobile number',
    path: ['email'],
  });
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaVerifySchema = z.union([
  z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') }),
  z.object({
    recoveryCode: z
      .string()
      .trim()
      .regex(/^[a-z0-9]{5}-[a-z0-9]{5}$/i),
  }),
]);
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaEnableSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/),
});

export const tokenSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: tokenSchema, password: passwordSchema });
export const verifyEmailSchema = z.object({ token: tokenSchema });
export const acceptInviteSchema = z.object({ token: tokenSchema, password: passwordSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export const switchTenantSchema = z.object({ tenantId: z.uuid() });
