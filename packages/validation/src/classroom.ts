import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 08:30');
const isoDate = z.iso.date();

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const periodSlotsSchema = z.object({
  campusId: z.uuid(),
  slots: z
    .array(
      z
        .object({
          id: z.uuid().optional(),
          label: z.string().trim().min(1).max(30),
          startsAt: hhmm,
          endsAt: hhmm,
          isBreak: z.boolean().default(false),
        })
        .refine((s) => s.endsAt > s.startsAt, {
          message: 'Ends before it starts',
          path: ['endsAt'],
        }),
    )
    .min(1)
    .max(16)
    .refine((list) => list.every((s, i) => i === 0 || s.startsAt >= list[i - 1]!.endsAt), {
      message: 'Periods overlap; keep them in time order',
    }),
});
export type PeriodSlotsInput = z.infer<typeof periodSlotsSchema>;

export const timetableCellSchema = z.object({
  weekday: z.number().int().min(1).max(6),
  slotId: z.uuid(),
  subjectId: z.uuid().nullable(),
  membershipId: z.uuid().nullable().default(null),
});
export type TimetableCellInput = z.infer<typeof timetableCellSchema>;

export const dayQuerySchema = z.object({ date: isoDate.optional() });
export const campusDayQuerySchema = z.object({ campusId: z.uuid(), date: isoDate.optional() });

export const substitutionSchema = z.object({
  onDate: isoDate,
  entryId: z.uuid(),
  substituteMembershipId: z.uuid().nullable(),
  note: z.string().trim().max(200).default(''),
});
export type SubstitutionInput = z.infer<typeof substitutionSchema>;

/** Sent as multipart form fields (optional photo of the board). */
export const homeworkSchema = z.object({
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  title: z.string().trim().min(2).max(200),
  details: z.string().trim().max(4000).default(''),
  dueOn: z.preprocess((v) => (v === '' ? undefined : v), isoDate.optional()),
});
export type HomeworkInput = z.infer<typeof homeworkSchema>;
export const homeworkListQuerySchema = z.object({ sectionId: z.uuid() });

export const noticeSchema = z.object({
  campusId: z.uuid().nullable().default(null),
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(1).max(5000),
  audience: z.enum(['everyone', 'parents', 'staff']).default('everyone'),
  gradeLevelIds: z.array(z.uuid()).max(50).default([]),
  sectionIds: z.array(z.uuid()).max(200).default([]),
  pinned: z.boolean().default(false),
  expiresOn: isoDate.nullable().default(null),
});
export type NoticeInput = z.infer<typeof noticeSchema>;

export const parentLeaveSchema = z
  .object({
    fromDate: isoDate,
    toDate: isoDate,
    reason: z.string().trim().min(3).max(300),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: 'Ends before it starts', path: ['toDate'] });
