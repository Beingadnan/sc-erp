import { z } from 'zod';
import { boardSchema } from './auth.js';

/** ISO calendar date (YYYY-MM-DD) that actually exists. */
export const isoDateSchema = z.iso.date('Use a date like 2026-04-01');

const nonEmpty = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .partial()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const dateRange = <T extends { startsOn?: string; endsOn?: string }>(v: T) =>
  !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn;
const dateRangeMsg = { message: 'End date must be on or after the start date', path: ['endsOn'] };

/* ---------------------------------- academic years ---------------------------------- */

const weekdaySchema = z.number().int().min(0).max(6);
const yearFields = {
  name: z
    .string()
    .trim()
    .min(4)
    .max(30)
    .regex(/^[\w\s/-]+$/, 'Letters, numbers, spaces, / and - only'),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  weeklyOffDays: z.array(weekdaySchema).max(7),
  saturdayOffWeeks: z.array(z.number().int().min(1).max(5)).max(5),
};

export const academicYearCreateSchema = z
  .object({
    campusId: z.uuid(),
    name: yearFields.name,
    startsOn: yearFields.startsOn,
    endsOn: yearFields.endsOn,
    weeklyOffDays: yearFields.weeklyOffDays.default([0]),
    saturdayOffWeeks: yearFields.saturdayOffWeeks.default([]),
  })
  .refine((v) => v.endsOn > v.startsOn, dateRangeMsg);
export type AcademicYearCreateInput = z.infer<typeof academicYearCreateSchema>;

export const academicYearUpdateSchema = nonEmpty(yearFields).refine(dateRange, dateRangeMsg);
export type AcademicYearUpdateInput = z.infer<typeof academicYearUpdateSchema>;

export const academicYearStatusSchema = z.object({ status: z.enum(['active', 'closed']) });

const termFields = {
  name: z.string().trim().min(2).max(40),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
};
export const termCreateSchema = z.object(termFields).refine(dateRange, dateRangeMsg);
export type TermCreateInput = z.infer<typeof termCreateSchema>;
export const termUpdateSchema = nonEmpty(termFields).refine(dateRange, dateRangeMsg);
export type TermUpdateInput = z.infer<typeof termUpdateSchema>;

/* --------------------------------- classes & sections -------------------------------- */

export const STAGES = [
  'pre_primary',
  'primary',
  'middle',
  'secondary',
  'senior_secondary',
] as const;
export const stageSchema = z.enum(STAGES);

const shortCode = (max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      new RegExp(`^[A-Z0-9][A-Z0-9_-]{0,${max - 1}}$`),
      `Up to ${max} letters, numbers, - or _`,
    );

const gradeLevelFields = {
  name: z.string().trim().min(1).max(40),
  stage: stageSchema,
  sortOrder: z.number().int().min(0).max(1000),
  gradingScaleId: z.uuid().nullable(),
  status: z.enum(['active', 'archived']),
};
export const gradeLevelCreateSchema = z.object({
  campusId: z.uuid(),
  code: shortCode(10),
  name: gradeLevelFields.name,
  stage: gradeLevelFields.stage,
  sortOrder: gradeLevelFields.sortOrder.default(0),
  gradingScaleId: gradeLevelFields.gradingScaleId.default(null),
});
export type GradeLevelCreateInput = z.infer<typeof gradeLevelCreateSchema>;
export const gradeLevelUpdateSchema = nonEmpty(gradeLevelFields);
export type GradeLevelUpdateInput = z.infer<typeof gradeLevelUpdateSchema>;

const sectionFields = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[\p{L}\p{M}\p{N} -]+$/u, 'Letters, numbers, spaces and - only'),
  capacity: z.number().int().min(1).max(200).nullable(),
  room: z.string().trim().max(40).nullable(),
  classTeacherMembershipId: z.uuid().nullable(),
};
export const sectionCreateSchema = z.object({
  academicYearId: z.uuid(),
  gradeLevelId: z.uuid(),
  name: sectionFields.name,
  capacity: sectionFields.capacity.default(null),
  room: sectionFields.room.default(null),
  classTeacherMembershipId: sectionFields.classTeacherMembershipId.default(null),
});
export type SectionCreateInput = z.infer<typeof sectionCreateSchema>;
export const sectionUpdateSchema = nonEmpty(sectionFields);
export type SectionUpdateInput = z.infer<typeof sectionUpdateSchema>;

export const sectionListQuerySchema = z.object({
  academicYearId: z.uuid(),
  gradeLevelId: z.uuid().optional(),
});

export const campusQuerySchema = z.object({ campusId: z.uuid() });

/* -------------------------------------- subjects ------------------------------------- */

const subjectFields = {
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['scholastic', 'co_scholastic']),
  status: z.enum(['active', 'archived']),
};
export const subjectCreateSchema = z.object({
  code: shortCode(15),
  name: subjectFields.name,
  kind: subjectFields.kind.default('scholastic'),
});
export type SubjectCreateInput = z.infer<typeof subjectCreateSchema>;
export const subjectUpdateSchema = nonEmpty(subjectFields);
export type SubjectUpdateInput = z.infer<typeof subjectUpdateSchema>;

/** Replaces the full subject list of a class. */
export const classSubjectsSchema = z.object({
  subjects: z
    .array(z.object({ subjectId: z.uuid(), isOptional: z.boolean().default(false) }))
    .max(40)
    .refine(
      (a) => new Set(a.map((s) => s.subjectId)).size === a.length,
      'A subject is listed twice',
    ),
});
export type ClassSubjectsInput = z.infer<typeof classSubjectsSchema>;

/* -------------------------------------- calendar ------------------------------------- */

const maxLength = (v: { startsOn?: string; endsOn?: string }) =>
  !v.startsOn || !v.endsOn || Date.parse(v.endsOn) - Date.parse(v.startsOn) <= 120 * 86_400_000;
const maxLengthMsg = { message: 'A calendar entry can span at most 120 days', path: ['endsOn'] };

export const CALENDAR_KINDS = ['holiday', 'vacation', 'event', 'exam'] as const;
const calendarFields = {
  campusId: z.uuid().nullable(),
  title: z.string().trim().min(2).max(120),
  kind: z.enum(CALENDAR_KINDS),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  description: z.string().trim().max(500),
};
export const calendarEventCreateSchema = z
  .object({
    ...calendarFields,
    endsOn: calendarFields.endsOn.optional(),
    description: calendarFields.description.default(''),
  })
  .transform((v) => ({ ...v, endsOn: v.endsOn ?? v.startsOn }))
  .refine((v) => v.endsOn >= v.startsOn, dateRangeMsg)
  .refine(maxLength, maxLengthMsg);
export type CalendarEventCreateInput = z.infer<typeof calendarEventCreateSchema>;
export const calendarEventUpdateSchema = nonEmpty(calendarFields)
  .refine(dateRange, dateRangeMsg)
  .refine(maxLength, maxLengthMsg);
export type CalendarEventUpdateInput = z.infer<typeof calendarEventUpdateSchema>;

export const calendarQuerySchema = z
  .object({ campusId: z.uuid(), from: isoDateSchema, to: isoDateSchema })
  .refine((v) => v.to >= v.from, { message: '"to" must be on or after "from"', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 400 * 86_400_000, {
    message: 'Ask for at most 400 days at a time',
    path: ['to'],
  });

/* --------------------------------------- grading ------------------------------------- */

const percent = z.number().min(0).max(100).multipleOf(0.01);
export const gradingBandSchema = z
  .object({
    label: z.string().trim().min(1).max(10),
    minPercent: percent,
    maxPercent: percent,
    gradePoint: z.number().min(0).max(99).multipleOf(0.01).nullable().default(null),
    remark: z.string().trim().max(60).default(''),
  })
  .refine((b) => b.minPercent <= b.maxPercent, {
    message: 'Minimum must not exceed maximum',
    path: ['minPercent'],
  });

const bandsSchema = z
  .array(gradingBandSchema)
  .min(1)
  .max(20)
  .superRefine((bands, ctx) => {
    if (new Set(bands.map((b) => b.label.toUpperCase())).size !== bands.length) {
      ctx.addIssue({ code: 'custom', message: 'Each grade label must be unique' });
    }
    const sorted = [...bands].sort((a, b) => a.minPercent - b.minPercent);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.minPercent <= sorted[i - 1]!.maxPercent) {
        ctx.addIssue({
          code: 'custom',
          message: `Grades ${sorted[i - 1]!.label} and ${sorted[i]!.label} overlap`,
        });
      }
    }
  });

export const gradingScaleCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(''),
  bands: bandsSchema,
});
export type GradingScaleCreateInput = z.infer<typeof gradingScaleCreateSchema>;
export const gradingScaleUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300),
    bands: bandsSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type GradingScaleUpdateInput = z.infer<typeof gradingScaleUpdateSchema>;

/* -------------------------------------- templates ------------------------------------ */

export const structureTemplateSchema = z.object({
  campusId: z.uuid(),
  board: boardSchema,
  includePrePrimary: z.boolean().default(true),
  highestClass: z.number().int().min(1).max(12).default(12),
});
export type StructureTemplateInput = z.infer<typeof structureTemplateSchema>;
