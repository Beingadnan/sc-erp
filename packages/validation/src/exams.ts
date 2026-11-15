import { z } from 'zod';

const isoDate = z.iso.date();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 10:00');

export const EXAM_STATUSES = ['draft', 'open', 'published'] as const;
export const MARK_STATUSES = ['present', 'absent', 'medical', 'exempt'] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

export const examCreateSchema = z
  .object({
    campusId: z.uuid(),
    name: z.string().trim().min(2).max(60),
    termId: z.uuid().nullable().default(null),
    startsOn: isoDate.nullable().default(null),
    endsOn: isoDate.nullable().default(null),
  })
  .refine((e) => !e.startsOn || !e.endsOn || e.endsOn >= e.startsOn, {
    message: 'Ends before it starts',
    path: ['endsOn'],
  });
export type ExamCreateInput = z.infer<typeof examCreateSchema>;

export const examUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    termId: z.uuid().nullable().optional(),
    startsOn: isoDate.nullable().optional(),
    endsOn: isoDate.nullable().optional(),
  })
  .refine((e) => !e.startsOn || !e.endsOn || e.endsOn >= e.startsOn, {
    message: 'Ends before it starts',
    path: ['endsOn'],
  });
export type ExamUpdateInput = z.infer<typeof examUpdateSchema>;

export const examStatusSchema = z.object({ status: z.enum(EXAM_STATUSES) });

/** The whole date sheet for one class in an exam; subjects left out are removed. */
export const examPapersSchema = z.object({
  gradeLevelId: z.uuid(),
  papers: z
    .array(
      z
        .object({
          subjectId: z.uuid(),
          examDate: isoDate.nullable().default(null),
          startsAt: hhmm.nullable().default(null),
          maxMarks: z.number().int().min(1).max(1000),
          passMarks: z.number().int().min(0).max(1000),
        })
        .refine((p) => p.passMarks <= p.maxMarks, {
          message: 'Pass marks are more than the maximum',
          path: ['passMarks'],
        }),
    )
    .max(30)
    .refine(
      (ps) => new Set(ps.map((p) => p.subjectId)).size === ps.length,
      'A subject is listed twice',
    ),
});
export type ExamPapersInput = z.infer<typeof examPapersSchema>;

export const marksEntrySchema = z.object({
  marks: z
    .array(
      z
        .object({
          enrollmentId: z.uuid(),
          status: z.enum(MARK_STATUSES).default('present'),
          /** Leave null to clear a student's marks while entering. */
          marks: z.number().min(0).max(1000).multipleOf(0.5).nullable().default(null),
        })
        .refine((m) => m.status === 'present' || m.marks === null, {
          message: 'An absent student has no marks',
          path: ['marks'],
        }),
    )
    .max(200),
});
export type MarksEntryInput = z.infer<typeof marksEntrySchema>;

export const examRemarkSchema = z.object({
  remarks: z
    .array(z.object({ enrollmentId: z.uuid(), remark: z.string().trim().max(400) }))
    .max(200),
});

/* ------------------------------------------ grading ------------------------------------------ */

export interface GradeBand {
  label: string;
  minPercent: number;
  maxPercent: number;
  remark?: string;
}

/** CBSE eight-point scale (used when a class has no scale of its own). */
export const CBSE_BANDS: GradeBand[] = [
  { label: 'A1', minPercent: 91, maxPercent: 100, remark: 'Outstanding' },
  { label: 'A2', minPercent: 81, maxPercent: 90.99, remark: 'Excellent' },
  { label: 'B1', minPercent: 71, maxPercent: 80.99, remark: 'Very good' },
  { label: 'B2', minPercent: 61, maxPercent: 70.99, remark: 'Good' },
  { label: 'C1', minPercent: 51, maxPercent: 60.99, remark: 'Above average' },
  { label: 'C2', minPercent: 41, maxPercent: 50.99, remark: 'Average' },
  { label: 'D', minPercent: 33, maxPercent: 40.99, remark: 'Pass' },
  { label: 'E', minPercent: 0, maxPercent: 32.99, remark: 'Needs improvement' },
];

/** Grade for a percentage; percentages are rounded to 2 places before matching bands. */
export function gradeFor(percent: number, bands: GradeBand[] = CBSE_BANDS): string {
  const p = Math.round(percent * 100) / 100;
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  return (
    sorted.find((b) => p >= b.minPercent && p <= b.maxPercent)?.label ??
    sorted.find((b) => p >= b.minPercent)?.label ??
    sorted.at(-1)?.label ??
    ''
  );
}

/** Rank with ties sharing a place: 1, 2, 2, 4. Items without a score get null. */
export function rankScores(scores: Array<number | null>): Array<number | null> {
  return scores.map((s) =>
    s === null ? null : 1 + scores.filter((o) => o !== null && o > s).length,
  );
}
