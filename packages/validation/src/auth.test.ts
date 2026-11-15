import { describe, expect, it } from 'vitest';
import { emailSchema, passwordSchema, registerSchoolSchema, slugSchema } from './auth.js';
import { indianPhoneSchema } from './tenancy.js';

describe('auth validation', () => {
  it('normalises email', () => {
    expect(emailSchema.parse('  Principal@School.IN ')).toBe('principal@school.in');
  });

  it('rejects weak passwords', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('aaaaaaaaaaaa').success).toBe(false);
    expect(passwordSchema.safeParse('Password123').success).toBe(false);
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(true);
  });

  it('validates school addresses', () => {
    expect(slugSchema.parse('DPS-Jaipur')).toBe('dps-jaipur');
    expect(slugSchema.safeParse('ab').success).toBe(false);
    expect(slugSchema.safeParse('-bad-').success).toBe(false);
    expect(slugSchema.safeParse('admin').success).toBe(false);
  });

  it('accepts a complete registration', () => {
    const r = registerSchoolSchema.safeParse({
      schoolName: 'Sunrise Public School',
      slug: 'sunrise-jaipur',
      campusName: 'Main Campus',
      board: 'RBSE',
      fullName: 'Asha Sharma',
      email: 'asha@sunrise.edu.in',
      password: 'a long enough passphrase',
    });
    expect(r.success).toBe(true);
  });

  it('normalises Indian phone numbers', () => {
    expect(indianPhoneSchema.parse('98290 12345')).toBe('+919829012345');
    expect(indianPhoneSchema.parse('09829012345')).toBe('+919829012345');
    expect(indianPhoneSchema.parse('+91 98290-12345')).toBe('+919829012345');
    expect(indianPhoneSchema.safeParse('12345').success).toBe(false);
  });
});
