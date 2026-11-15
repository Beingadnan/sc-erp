import { describe, expect, it } from 'vitest';
import {
  aadhaarSchema,
  admissionNumberSettingsSchema,
  formatAdmissionNumber,
  studentAdmitSchema,
  verhoeffValid,
} from './students.js';

/** Appends the Verhoeff check digit to 11 digits (test helper). */
const withCheck = (eleven: string) => {
  for (let d = 0; d <= 9; d++) if (verhoeffValid(eleven + d)) return eleven + d;
  throw new Error('unreachable');
};

describe('student validation', () => {
  it('validates Aadhaar with the Verhoeff check digit', () => {
    const valid = withCheck('23456789012');
    expect(aadhaarSchema.parse(`${valid.slice(0, 4)} ${valid.slice(4, 8)} ${valid.slice(8)}`)).toBe(
      valid,
    );
    const wrong = valid.slice(0, 11) + ((Number(valid[11]) + 1) % 10);
    expect(aadhaarSchema.safeParse(wrong).success).toBe(false);
    expect(aadhaarSchema.safeParse(withCheck('12345678901')).success).toBe(false); // starts with 1
    expect(aadhaarSchema.safeParse('2345').success).toBe(false);
  });

  it('formats admission numbers from the pattern', () => {
    expect(
      formatAdmissionNumber('{CAMPUS}/{YYYY}/{SEQ:4}', 7, { year: 2026, campusCode: 'JPR' }),
    ).toBe('JPR/2026/0007');
    expect(formatAdmissionNumber('ADM{YY}-{SEQ:3}', 1234, { year: 2026, campusCode: 'X' })).toBe(
      'ADM26-1234',
    );
  });

  it('rejects patterns that would repeat numbers', () => {
    const ok = (pattern: string, perCampus = false, yearlyReset = false) =>
      admissionNumberSettingsSchema.safeParse({ pattern, perCampus, yearlyReset }).success;
    expect(ok('{SEQ:4}')).toBe(true);
    expect(ok('{YYYY}-{SEQ:4}', false, true)).toBe(true);
    expect(ok('{SEQ:4}', false, true)).toBe(false);
    expect(ok('{SEQ:4}', true)).toBe(false);
    expect(ok('{CAMPUS}-{SEQ:4}', true)).toBe(true);
    expect(ok('NO-SEQ')).toBe(false);
    expect(ok('{SEQ:4}{SEQ:2}')).toBe(false);
    expect(ok('{NAME}-{SEQ:4}')).toBe(false);
  });

  it('requires one primary guardian and the privacy acknowledgement', () => {
    const base = {
      firstName: 'Aarav',
      dateOfBirth: '2018-06-15',
      gender: 'male',
      sectionId: '01920000-0000-7000-8000-000000000001',
      guardians: [
        { fullName: 'Sunita Sharma', phone: '9829012345', relationship: 'mother', isPrimary: true },
      ],
      privacyNotice: { acknowledged: true, version: '2026-1', channel: 'in_person' },
    };
    const parsed = studentAdmitSchema.parse(base);
    expect(parsed.guardians[0]).toMatchObject({ phone: '+919829012345', isFeePayer: false });
    expect(
      studentAdmitSchema.safeParse({
        ...base,
        guardians: [{ ...base.guardians[0], isPrimary: false }],
      }).success,
    ).toBe(false);
    expect(
      studentAdmitSchema.safeParse({
        ...base,
        privacyNotice: { ...base.privacyNotice, acknowledged: false },
      }).success,
    ).toBe(false);
    expect(studentAdmitSchema.safeParse({ ...base, dateOfBirth: '2026-01-01' }).success).toBe(
      false,
    );
    expect(studentAdmitSchema.parse({ ...base, aadhaar: '', pen: ' ' }).aadhaar).toBeNull();
  });
});
