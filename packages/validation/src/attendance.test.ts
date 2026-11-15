import { describe, expect, it } from 'vitest';
import { attendancePercent, leaveCreateSchema, markAttendanceSchema } from './attendance.js';

describe('attendance rules', () => {
  it('computes percentages with half days and leave rules', () => {
    const s = ['present', 'late', 'half_day', 'absent', 'leave'];
    expect(attendancePercent(s, 'excluded')).toBe(62.5); // 2.5 / 4
    expect(attendancePercent(s, 'absent')).toBe(50); // 2.5 / 5
    expect(attendancePercent(['leave'], 'excluded')).toBeNull();
    expect(attendancePercent([], 'absent')).toBeNull();
  });

  it('validates registers and leave', () => {
    const id = '01920000-0000-7000-8000-000000000001';
    expect(
      markAttendanceSchema.safeParse({
        records: [
          { enrollmentId: id, status: 'present' },
          { enrollmentId: id, status: 'absent' },
        ],
      }).success,
    ).toBe(false);
    expect(
      markAttendanceSchema.safeParse({ records: [{ enrollmentId: id, status: 'sick' }] }).success,
    ).toBe(false);
    expect(
      leaveCreateSchema.safeParse({
        studentId: id,
        fromDate: '2026-11-10',
        toDate: '2026-11-09',
        reason: 'Fever',
      }).success,
    ).toBe(false);
    expect(
      leaveCreateSchema.parse({
        studentId: id,
        fromDate: '2026-11-10',
        toDate: '2026-11-12',
        reason: 'Fever',
      }).requestedVia,
    ).toBe('office');
  });
});
