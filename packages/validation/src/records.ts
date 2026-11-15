import { z } from 'zod';
import { emailSchema } from './auth.js';
import { isoDateSchema } from './academic.js';
import { BLOOD_GROUPS, RELATIONSHIPS, aadhaarSchema, apaarSchema, penSchema } from './students.js';
import { indianPhoneSchema } from './tenancy.js';

/* ----------------------------------- custom fields ----------------------------------- */

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select'] as const;

export const customFieldCreateSchema = z
  .object({
    entity: z.enum(['student', 'guardian']),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Lowercase letters, numbers and _ ; start with a letter'),
    label: z.string().trim().min(2).max(60),
    fieldType: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    required: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .refine((v) => (v.fieldType === 'select') === v.options.length > 0, {
    message: 'A list field needs options; other types must not have any',
    path: ['options'],
  })
  .refine((v) => new Set(v.options).size === v.options.length, {
    message: 'Options must be different',
    path: ['options'],
  });
export type CustomFieldCreateInput = z.infer<typeof customFieldCreateSchema>;

export const customFieldUpdateSchema = z
  .object({
    label: z.string().trim().min(2).max(60),
    options: z.array(z.string().trim().min(1).max(60)).min(1).max(50),
    required: z.boolean(),
    sortOrder: z.number().int().min(0).max(1000),
    archived: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type CustomFieldUpdateInput = z.infer<typeof customFieldUpdateSchema>;

export interface CustomFieldDef {
  key: string;
  label: string;
  fieldType: (typeof CUSTOM_FIELD_TYPES)[number];
  options: string[];
  required: boolean;
  archived: boolean;
}

/**
 * Checks values against the school's definitions. Unknown keys are refused; empty strings
 * mean "no value". With `partial`, missing required fields are allowed (edits of other
 * fields). Returns cleaned values or field errors keyed by field key.
 */
export const validateCustomValues = (
  defs: readonly CustomFieldDef[],
  input: Record<string, unknown>,
  { partial = false }: { partial?: boolean } = {},
): { values: Record<string, string | number>; errors: Record<string, string> } => {
  const values: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const key of Object.keys(input)) {
    if (!byKey.get(key) || byKey.get(key)!.archived) errors[key] = 'Unknown field';
  }
  for (const d of defs) {
    if (d.archived) continue;
    const raw = input[d.key];
    const empty =
      raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
    if (empty) {
      if (d.required && !(partial && raw === undefined)) errors[d.key] = `${d.label} is required`;
      continue;
    }
    const s = String(raw).trim();
    if (s.length > 200) errors[d.key] = 'Too long';
    else if (d.fieldType === 'number') {
      const n = Number(s);
      if (!Number.isFinite(n)) errors[d.key] = 'Enter a number';
      else values[d.key] = n;
    } else if (d.fieldType === 'date') {
      if (!isoDateSchema.safeParse(s).success) errors[d.key] = 'Enter a date like 2026-04-01';
      else values[d.key] = s;
    } else if (d.fieldType === 'select') {
      if (!d.options.includes(s)) errors[d.key] = `Choose one of: ${d.options.join(', ')}`;
      else values[d.key] = s;
    } else values[d.key] = s;
  }
  return { values, errors };
};

/* ------------------------------ promotion & withdrawal ------------------------------- */

export const PROMOTION_ACTIONS = ['promote', 'retain', 'complete', 'skip'] as const;

export const promotionSchema = z.object({
  fromSectionId: z.uuid(),
  toAcademicYearId: z.uuid(),
  items: z
    .array(
      z
        .object({
          enrollmentId: z.uuid(),
          action: z.enum(PROMOTION_ACTIONS),
          toSectionId: z.uuid().nullable().default(null),
        })
        .refine((i) => !['promote', 'retain'].includes(i.action) || i.toSectionId, {
          message: 'Choose the section for next year',
          path: ['toSectionId'],
        }),
    )
    .min(1)
    .max(250)
    .refine(
      (a) => new Set(a.map((i) => i.enrollmentId)).size === a.length,
      'A student is listed twice',
    ),
});
export type PromotionInput = z.infer<typeof promotionSchema>;

export const withdrawSchema = z.object({
  leftOn: isoDateSchema,
  reason: z.string().trim().min(3).max(200),
  issueTc: z.boolean().default(true),
  conduct: z.string().trim().max(60).default('Good'),
  remarks: z.string().trim().max(300).default(''),
});
export type WithdrawInput = z.infer<typeof withdrawSchema>;

export const tcCancelSchema = z.object({ reason: z.string().trim().min(3).max(200) });

/* -------------------------------------- import -------------------------------------- */

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/** Accepts 2014-06-15, 15-06-2014, 15/06/2014 and 15.06.2014. */
export const flexibleDate = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? v
      : (() => {
          const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
          return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : '';
        })();
    if (!isoDateSchema.safeParse(iso).success) {
      ctx.addIssue({ code: 'custom', message: 'Use a date like 15-06-2014' });
      return z.NEVER;
    }
    return iso;
  });

const genderWords: Record<string, 'male' | 'female' | 'other'> = {
  m: 'male',
  male: 'male',
  boy: 'male',
  b: 'male',
  f: 'female',
  female: 'female',
  girl: 'female',
  g: 'female',
  o: 'other',
  other: 'other',
};

const opt = <T extends z.ZodType>(s: T) =>
  z.preprocess(
    (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v),
    s.nullable(),
  );

const relationship = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(RELATIONSHIPS, `Use one of: ${RELATIONSHIPS.join(', ')}`));

/** One spreadsheet row, after header names are normalised (see IMPORT_COLUMNS). */
export const importRowSchema = z
  .object({
    admission_number: opt(z.string().trim().max(40)),
    first_name: z.string().trim().min(1, 'Required').max(60),
    last_name: opt(z.string().trim().max(60)),
    name_hindi: opt(z.string().trim().max(120)),
    date_of_birth: flexibleDate,
    gender: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v, ctx) => {
        const g = genderWords[v];
        if (!g) {
          ctx.addIssue({ code: 'custom', message: 'Use M, F or Other' });
          return z.NEVER;
        }
        return g;
      }),
    class: z.string().trim().min(1, 'Required').max(40),
    section: z.string().trim().min(1, 'Required').max(20),
    roll_number: opt(z.coerce.number().int().min(1).max(999)),
    admission_date: opt(flexibleDate),
    blood_group: opt(z.string().trim().toUpperCase().pipe(z.enum(BLOOD_GROUPS))),
    address: opt(z.string().trim().max(400)),
    pen: opt(penSchema),
    apaar_id: opt(apaarSchema),
    aadhaar: opt(aadhaarSchema),
    parent_name: z.string().trim().min(2, 'Required').max(100),
    parent_phone: indianPhoneSchema,
    parent_relationship: opt(relationship),
    parent_email: opt(emailSchema),
    second_parent_name: opt(z.string().trim().min(2).max(100)),
    second_parent_phone: opt(indianPhoneSchema),
    second_parent_relationship: opt(relationship),
  })
  .refine((r) => !r.second_parent_name === !r.second_parent_phone, {
    message: 'Give both the name and mobile of the second parent, or neither',
    path: ['second_parent_phone'],
  });
export type ImportRow = z.infer<typeof importRowSchema>;

/** Columns in the template, in order. Custom fields are added as cf_<key>. */
export const IMPORT_COLUMNS = [
  'admission_number',
  'first_name',
  'last_name',
  'name_hindi',
  'date_of_birth',
  'gender',
  'class',
  'section',
  'roll_number',
  'admission_date',
  'blood_group',
  'address',
  'pen',
  'apaar_id',
  'aadhaar',
  'parent_name',
  'parent_phone',
  'parent_relationship',
  'parent_email',
  'second_parent_name',
  'second_parent_phone',
  'second_parent_relationship',
] as const;

/** "Date of Birth" / "DOB" / "date-of-birth" → "date_of_birth". */
const ALIASES: Record<string, string> = {
  dob: 'date_of_birth',
  birth_date: 'date_of_birth',
  name: 'first_name',
  student_name: 'first_name',
  admission_no: 'admission_number',
  adm_no: 'admission_number',
  sr_no: 'admission_number',
  roll_no: 'roll_number',
  father_name: 'parent_name',
  mobile: 'parent_phone',
  phone: 'parent_phone',
  mother_name: 'second_parent_name',
  mother_mobile: 'second_parent_phone',
  aadhar: 'aadhaar',
  aadhaar_number: 'aadhaar',
};
export const normaliseHeader = (h: string): string => {
  const k = h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ALIASES[k] ?? k;
};

export const exportQuerySchema = z.object({
  campusId: z.uuid().optional(),
  academicYearId: z.uuid().optional(),
  gradeLevelId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
  status: z.enum(['active', 'withdrawn', 'alumni']).optional(),
  q: z.string().trim().max(60).optional(),
});

/** Importing creates records for children: the school confirms parents got the notice. */
export const importConfirmSchema = z.object({
  privacyNoticeGiven: z.literal(true, 'Confirm that parents have been given the privacy notice'),
});

export const importPreviewFieldsSchema = z.object({
  campusId: z.uuid(),
  academicYearId: z.uuid(),
});

export const promotionPreviewQuerySchema = z.object({
  fromSectionId: z.uuid(),
  toAcademicYearId: z.uuid(),
});
