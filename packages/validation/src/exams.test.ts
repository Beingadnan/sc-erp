import { describe, expect, it } from 'vitest';
import { examPapersSchema, gradeFor, marksEntrySchema, rankScores } from './exams.js';

const id = '0190f6a8-0000-7000-8000-000000000001';

describe('grading', () => {
  it('uses the CBSE eight-point scale', () => {
    expect(gradeFor(100)).toBe('A1');
    expect(gradeFor(91)).toBe('A1');
    expect(gradeFor(90.995)).toBe('A1');
    expect(gradeFor(90.5)).toBe('A2');
    expect(gradeFor(33)).toBe('D');
    expect(gradeFor(32.99)).toBe('E');
    expect(gradeFor(0)).toBe('E');
  });
  it('ranks ties together', () => {
    expect(rankScores([90, 75, 90, null, 60])).toEqual([1, 3, 1, null, 4]);
  });
});

describe('exam inputs', () => {
  it('refuses pass marks above the maximum and duplicate subjects', () => {
    expect(
      examPapersSchema.safeParse({
        gradeLevelId: id,
        papers: [{ subjectId: id, maxMarks: 20, passMarks: 30 }],
      }).success,
    ).toBe(false);
    expect(
      examPapersSchema.safeParse({
        gradeLevelId: id,
        papers: [
          { subjectId: id, maxMarks: 20, passMarks: 7 },
          { subjectId: id, maxMarks: 80, passMarks: 27 },
        ],
      }).success,
    ).toBe(false);
  });
  it('allows half marks; absent students have no marks', () => {
    expect(marksEntrySchema.safeParse({ marks: [{ enrollmentId: id, marks: 17.5 }] }).success).toBe(
      true,
    );
    expect(marksEntrySchema.safeParse({ marks: [{ enrollmentId: id, marks: 17.3 }] }).success).toBe(
      false,
    );
    expect(
      marksEntrySchema.safeParse({ marks: [{ enrollmentId: id, status: 'absent', marks: 4 }] })
        .success,
    ).toBe(false);
    expect(
      marksEntrySchema.safeParse({ marks: [{ enrollmentId: id, status: 'absent' }] }).success,
    ).toBe(true);
  });
});
