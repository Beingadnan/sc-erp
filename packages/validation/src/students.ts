import { z } from 'zod';
import { emailSchema } from './auth.js';
import { isoDateSchema } from './academic.js';
import { paginationQuerySchema } from './common.js';
import { indianPhoneSchema } from './tenancy.js';

/* ---------------------------------- identifiers ---------------------------------- */

// Verhoeff tables (used by UIDAI for the Aadhaar check digit).
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export const verhoeffValid = (digits: string): boolean => {
  let c = 0;
  const rev = digits.split('').reverse();
  for (let i = 0; i < rev.length; i++) c = D[c]![P[i % 8]![Number(rev[i])]!]!;
  return c === 0;
};

const digitsOnly = (v: string) => v.replace(/[\s-]/g, '');

/** 12 digits, does not start with 0 or 1, valid Verhoeff check digit. */
export const aadhaarSchema = z
  .string()
  .trim()
  .transform(digitsOnly)
  .pipe(
    z
      .string()
      .regex(/^[2-9][0-9]{11}$/, 'Aadhaar is 12 digits and does not start with 0 or 1')
      .refine(verhoeffValid, 'This Aadhaar number is not valid (check digit does not match)'),
  );

export const penSchema = z
  .string()
  .trim()
  .transform(digitsOnly)
  .pipe(z.string().regex(/^[0-9]{11}$/, 'PEN is 11 digits'));

export const apaarSchema = z
  .string()
  .trim()
  .transform(digitsOnly)
  .pipe(z.string().regex(/^[0-9]{12}$/, 'APAAR ID is 12 digits'));

/** "XXXX XXXX 1234" */
export const maskAadhaar = (last4: string) => `XXXX XXXX ${last4}`;

/* ----------------------------------- students ----------------------------------- */

export const GENDERS = ['male', 'female', 'other'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const RELATIONSHIPS = [
  'father',
  'mother',
  'guardian',
  'grandparent',
  'sibling',
  'other',
] as const;
export const ACK_CHANNELS = ['in_person', 'web', 'app', 'phone'] as const;

const nullable = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), s.nullable());

const studentFields = {
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60),
  nameLocal: nullable(z.string().trim().max(120)),
  dateOfBirth: isoDateSchema,
  gender: z.enum(GENDERS),
  bloodGroup: nullable(z.enum(BLOOD_GROUPS)),
  address: nullable(z.string().trim().max(400)),
  pen: nullable(penSchema),
  apaarId: nullable(apaarSchema),
  aadhaar: nullable(aadhaarSchema),
  /** School-defined fields; checked against the definitions by the API. */
  customFields: z.record(z.string().max(40), z.unknown()),
};

const birthRule = (v: { dateOfBirth?: string }) => {
  if (!v.dateOfBirth) return true;
  const age = (Date.now() - Date.parse(v.dateOfBirth)) / (365.25 * 86_400_000);
  return age >= 1.5 && age <= 25;
};
const birthMsg = {
  message: 'Check the date of birth (student must be between 1½ and 25 years old)',
  path: ['dateOfBirth'],
};

const guardianLink = {
  relationship: z.enum(RELATIONSHIPS),
  isPrimary: z.boolean().default(false),
  isFeePayer: z.boolean().default(false),
};

export const newGuardianSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone: indianPhoneSchema,
  email: nullable(emailSchema).default(null),
  occupation: nullable(z.string().trim().max(80)).default(null),
});

/** Either link an existing guardian (sibling) or create a new one. */
export const guardianInputSchema = z.union([
  z.object({ guardianId: z.uuid(), ...guardianLink }),
  newGuardianSchema.extend(guardianLink),
]);
export type GuardianInput = z.infer<typeof guardianInputSchema>;

const onePrimary = (gs: Array<{ isPrimary: boolean }>) =>
  gs.filter((g) => g.isPrimary).length === 1;

export const studentAdmitSchema = z
  .object({
    ...studentFields,
    lastName: studentFields.lastName.default(''),
    nameLocal: studentFields.nameLocal.default(null),
    bloodGroup: studentFields.bloodGroup.default(null),
    address: studentFields.address.default(null),
    pen: studentFields.pen.default(null),
    apaarId: studentFields.apaarId.default(null),
    aadhaar: studentFields.aadhaar.default(null),
    customFields: studentFields.customFields.default({}),
    admissionDate: isoDateSchema.optional(),
    sectionId: z.uuid(),
    rollNumber: z.number().int().min(1).max(999).nullable().default(null),
    guardians: z
      .array(guardianInputSchema)
      .min(1, 'Add at least one parent or guardian')
      .max(4)
      .refine(onePrimary, 'Choose exactly one primary contact'),
    /** The primary guardian acknowledged the school's privacy notice. */
    privacyNotice: z.object({
      acknowledged: z.literal(true, 'The parent must acknowledge the privacy notice'),
      version: z.string().trim().min(1).max(40),
      channel: z.enum(ACK_CHANNELS),
    }),
  })
  .refine(birthRule, birthMsg);
export type StudentAdmitInput = z.infer<typeof studentAdmitSchema>;

export const studentUpdateSchema = z
  .object(studentFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine(birthRule, birthMsg);
export type StudentUpdateInput = z.infer<typeof studentUpdateSchema>;

export const STUDENT_STATUSES = ['active', 'withdrawn', 'alumni'] as const;

export const studentListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(60).optional(),
  campusId: z.uuid().optional(),
  academicYearId: z.uuid().optional(),
  gradeLevelId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
  status: z.enum(STUDENT_STATUSES).optional(),
});
export type StudentListQuery = z.infer<typeof studentListQuerySchema>;

/* --------------------------------- guardians ----------------------------------- */

export const guardianUpdateSchema = newGuardianSchema
  .extend({ customFields: z.record(z.string().max(40), z.unknown()) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type GuardianUpdateInput = z.infer<typeof guardianUpdateSchema>;

export const guardianLinkUpdateSchema = z
  .object({
    relationship: z.enum(RELATIONSHIPS),
    isPrimary: z.literal(true),
    isFeePayer: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const guardianLookupQuerySchema = z.object({ phone: indianPhoneSchema });

export const privacyAckSchema = z.object({
  version: z.string().trim().min(1).max(40),
  channel: z.enum(ACK_CHANNELS),
});

/* -------------------------------- enrollments ---------------------------------- */

export const enrollmentUpdateSchema = z
  .object({
    sectionId: z.uuid(),
    rollNumber: z.number().int().min(1).max(999).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type EnrollmentUpdateInput = z.infer<typeof enrollmentUpdateSchema>;

export const renumberSchema = z.object({ order: z.enum(['name', 'admission_number']) });

/* ----------------------------- admission numbers ------------------------------- */

const TOKEN = /\{(SEQ:[1-9]|YYYY|YY|CAMPUS)\}/g;

export const admissionNumberSettingsSchema = z
  .object({
    pattern: z
      .string()
      .trim()
      .min(5)
      .max(40)
      .refine((p) => (p.match(/\{SEQ:[1-9]\}/g) ?? []).length === 1, 'Include {SEQ:n} exactly once')
      .refine(
        (p) => !/[{}]/.test(p.replace(TOKEN, '')),
        'Unknown placeholder; use {SEQ:4}, {YYYY}, {YY} or {CAMPUS}',
      )
      .refine(
        (p) => /^[A-Za-z0-9/_\-{}:]+$/.test(p),
        'Letters, numbers, / - _ and placeholders only',
      ),
    perCampus: z.boolean(),
    yearlyReset: z.boolean(),
  })
  .refine((v) => !v.perCampus || v.pattern.includes('{CAMPUS}'), {
    message: 'Separate campus counters need {CAMPUS} in the pattern, or numbers would repeat',
    path: ['pattern'],
  })
  .refine((v) => !v.yearlyReset || /\{YY(YY)?\}/.test(v.pattern), {
    message: 'Yearly counters need {YYYY} or {YY} in the pattern, or numbers would repeat',
    path: ['pattern'],
  });
export type AdmissionNumberSettingsInput = z.infer<typeof admissionNumberSettingsSchema>;

/** Builds an admission number. `year` is the start year of the academic year. */
export const formatAdmissionNumber = (
  pattern: string,
  seq: number,
  ctx: { year: number; campusCode: string },
): string =>
  pattern.replace(TOKEN, (_m, token: string) => {
    if (token.startsWith('SEQ:')) return String(seq).padStart(Number(token.slice(4)), '0');
    if (token === 'YYYY') return String(ctx.year);
    if (token === 'YY') return String(ctx.year % 100).padStart(2, '0');
    return ctx.campusCode;
  });
