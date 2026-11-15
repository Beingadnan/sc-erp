import { z } from 'zod';
import { isoDateSchema } from './academic.js';

/** A register has three marks only: Present, Absent, Late. */
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Attended value of one record: present/late 1, half day 0.5, absent 0; leave depends on the setting. */
export const attendedValue = (
  status: string,
  leaveCountsAs: 'absent' | 'excluded',
): number | null =>
  status === 'present' || status === 'late'
    ? 1
    : status === 'half_day'
      ? 0.5
      : status === 'leave'
        ? leaveCountsAs === 'excluded'
          ? null
          : 0
        : 0;

/** Percentage over records, ignoring excluded ones; null when nothing counts yet. */
export const attendancePercent = (
  statuses: readonly string[],
  leaveCountsAs: 'absent' | 'excluded',
) => {
  let total = 0;
  let attended = 0;
  for (const s of statuses) {
    const v = attendedValue(s, leaveCountsAs);
    if (v === null) continue;
    total += 1;
    attended += v;
  }
  return total ? Math.round((attended / total) * 1000) / 10 : null;
};

export const attendanceSettingsSchema = z.object({
  mode: z.enum(['daily', 'period']),
  periodsPerDay: z.number().int().min(1).max(12),
  cutoffHours: z.number().int().min(0).max(168),
  lowThreshold: z.number().int().min(1).max(100),
  leaveCountsAs: z.enum(['absent', 'excluded']),
});
export type AttendanceSettingsInput = z.infer<typeof attendanceSettingsSchema>;

export const attendanceSlotSchema = z.object({
  date: isoDateSchema,
  period: z.coerce.number().int().min(0).max(12).default(0),
});

export const markAttendanceSchema = z.object({
  records: z
    .array(
      z.object({
        enrollmentId: z.uuid(),
        status: z.enum(ATTENDANCE_STATUSES),
        remark: z.string().trim().max(200).default(''),
      }),
    )
    .min(1)
    .max(250)
    .refine(
      (r) => new Set(r.map((x) => x.enrollmentId)).size === r.length,
      'A student is listed twice',
    ),
  /** Required when changing a register after the cut-off. */
  reason: z.string().trim().min(3).max(200).optional(),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const leaveCreateSchema = z
  .object({
    studentId: z.uuid(),
    fromDate: isoDateSchema,
    toDate: isoDateSchema,
    reason: z.string().trim().min(3).max(300),
    requestedVia: z.enum(['office', 'phone', 'parent_app']).default('office'),
  })
  .refine((v) => v.toDate >= v.fromDate, {
    message: 'End date must be on or after the start date',
    path: ['toDate'],
  })
  .refine((v) => Date.parse(v.toDate) - Date.parse(v.fromDate) <= 60 * 86_400_000, {
    message: 'Leave can be at most 61 days at a time',
    path: ['toDate'],
  });
export type LeaveCreateInput = z.infer<typeof leaveCreateSchema>;

export const leaveDecisionSchema = z
  .object({
    status: z.enum(['approved', 'rejected', 'cancelled']),
    note: z.string().trim().max(300).default(''),
  })
  .refine((v) => v.status !== 'rejected' || v.note.length >= 3, {
    message: 'Add a short reason',
    path: ['note'],
  });

export const leaveListQuerySchema = z.object({
  campusId: z.uuid(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  sectionId: z.uuid().optional(),
});

export const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-11'),
});

export const lowAttendanceQuerySchema = z.object({
  campusId: z.uuid(),
  academicYearId: z.uuid(),
  threshold: z.coerce.number().int().min(1).max(100).optional(),
  sectionId: z.uuid().optional(),
});

export const todayQuerySchema = z.object({
  campusId: z.uuid(),
  date: isoDateSchema.optional(),
});
