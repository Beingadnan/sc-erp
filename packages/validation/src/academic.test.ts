import { describe, expect, it } from 'vitest';
import {
  academicYearCreateSchema,
  calendarEventCreateSchema,
  calendarQuerySchema,
  classSubjectsSchema,
  gradingScaleCreateSchema,
  isoDateSchema,
  sectionCreateSchema,
} from './academic.js';

const campusId = '01920000-0000-7000-8000-000000000001';

describe('academic validation', () => {
  it('accepts real dates only', () => {
    expect(isoDateSchema.safeParse('2026-04-01').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(isoDateSchema.safeParse('01/04/2026').success).toBe(false);
  });

  it('requires a year to end after it starts and defaults Sunday off', () => {
    expect(
      academicYearCreateSchema.safeParse({
        campusId,
        name: '2026-27',
        startsOn: '2027-03-31',
        endsOn: '2026-04-01',
      }).success,
    ).toBe(false);
    const ok = academicYearCreateSchema.parse({
      campusId,
      name: '2026-27',
      startsOn: '2026-04-01',
      endsOn: '2027-03-31',
    });
    expect(ok.weeklyOffDays).toEqual([0]);
    expect(ok.saturdayOffWeeks).toEqual([]);
  });

  it('rejects overlapping or duplicate grade bands', () => {
    const overlap = gradingScaleCreateSchema.safeParse({
      name: 'Test',
      bands: [
        { label: 'A', minPercent: 50, maxPercent: 100 },
        { label: 'B', minPercent: 0, maxPercent: 50 },
      ],
    });
    expect(overlap.error?.issues[0]?.message).toBe('Grades B and A overlap');
    const dup = gradingScaleCreateSchema.safeParse({
      name: 'Test',
      bands: [
        { label: 'A', minPercent: 51, maxPercent: 100 },
        { label: 'a', minPercent: 0, maxPercent: 50 },
      ],
    });
    expect(dup.success).toBe(false);
    expect(
      gradingScaleCreateSchema.safeParse({
        name: 'Test',
        bands: [
          { label: 'A', minPercent: 50.01, maxPercent: 100 },
          { label: 'B', minPercent: 0, maxPercent: 50 },
        ],
      }).success,
    ).toBe(true);
  });

  it('makes single-day calendar entries end on the start date', () => {
    const e = calendarEventCreateSchema.parse({
      campusId: null,
      title: 'Diwali',
      kind: 'holiday',
      startsOn: '2026-11-08',
    });
    expect(e.endsOn).toBe('2026-11-08');
    expect(e.description).toBe('');
  });

  it('caps calendar queries at 400 days', () => {
    expect(
      calendarQuerySchema.safeParse({ campusId, from: '2026-04-01', to: '2027-03-31' }).success,
    ).toBe(true);
    expect(
      calendarQuerySchema.safeParse({ campusId, from: '2026-04-01', to: '2027-12-31' }).success,
    ).toBe(false);
  });

  it('validates sections and class subject lists', () => {
    expect(
      sectionCreateSchema.safeParse({
        academicYearId: campusId,
        gradeLevelId: campusId,
        name: 'A',
        capacity: 0,
      }).success,
    ).toBe(false);
    expect(
      sectionCreateSchema.safeParse({
        academicYearId: campusId,
        gradeLevelId: campusId,
        name: 'गुलाब',
      }).success,
    ).toBe(true);
    expect(
      classSubjectsSchema.safeParse({
        subjects: [{ subjectId: campusId }, { subjectId: campusId }],
      }).success,
    ).toBe(false);
  });
});
