import { z } from 'zod';
import { boardSchema, emailSchema, timezoneSchema } from './auth.js';
import { paginationQuerySchema } from './common.js';

/** Accepts "+91 98290 12345", "9829012345", "09829012345" → "+919829012345". */
export const indianPhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .transform((v) => (/^0?[6-9]\d{9}$/.test(v) ? `+91${v.slice(-10)}` : v))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid phone number'));

export const tenantUpdateSchema = z
  .object({
    name: z.string().trim().min(3).max(150),
    defaultTimezone: timezoneSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const campusFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Up to 20 letters, numbers, - or _'),
  name: z.string().trim().min(2).max(150),
  board: boardSchema,
  udiseCode: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'UDISE code has 11 digits')
    .nullable(),
  address: z.string().trim().max(500).nullable(),
  phone: indianPhoneSchema.nullable(),
  email: emailSchema.nullable(),
  timezone: timezoneSchema,
};

export const campusCreateSchema = z.object({
  code: campusFields.code,
  name: campusFields.name,
  board: campusFields.board,
  udiseCode: campusFields.udiseCode.optional(),
  address: campusFields.address.optional(),
  phone: campusFields.phone.optional(),
  email: campusFields.email.optional(),
  timezone: campusFields.timezone.optional(),
});
export type CampusCreateInput = z.infer<typeof campusCreateSchema>;

export const campusUpdateSchema = z
  .object({ ...campusFields, status: z.enum(['active', 'archived']) })
  .omit({ code: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type CampusUpdateInput = z.infer<typeof campusUpdateSchema>;

export const permissionKeySchema = z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/);

export const roleCreateSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,49}$/, 'Lowercase letters, numbers and _'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(''),
  permissions: z.array(permissionKeySchema).max(500).default([]),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = z
  .object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(300) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const rolePermissionsSchema = z.object({
  permissions: z.array(permissionKeySchema).max(500),
});

export const roleAssignmentSchema = z.object({
  roleId: z.uuid(),
  /** null = all campuses */
  campusId: z.uuid().nullable(),
});
export type RoleAssignmentInput = z.infer<typeof roleAssignmentSchema>;

/** Staff are invited by email or, as most Indian schools work, by mobile number. */
export const inviteMemberSchema = z
  .object({
    email: emailSchema.optional(),
    phone: indianPhoneSchema.optional(),
    fullName: z.string().trim().min(2).max(120),
    designation: z.string().trim().max(80).default(''),
    employeeCode: z.string().trim().max(30).optional(),
    assignments: z.array(roleAssignmentSchema).min(1).max(20),
  })
  .refine((v) => !!v.email !== !!v.phone, {
    message: 'Enter an email or a mobile number',
    path: ['phone'],
  });
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const memberRolesSchema = z.object({
  assignments: z.array(roleAssignmentSchema).max(20),
});

export const memberStatusSchema = z.object({ status: z.enum(['active', 'suspended']) });

export const auditQuerySchema = paginationQuerySchema.extend({
  entity: z
    .string()
    .regex(/^[a-z_]+$/)
    .max(50)
    .optional(),
  actorUserId: z.uuid().optional(),
});

export const platformTenantsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const platformTenantStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().min(5).max(500),
});
