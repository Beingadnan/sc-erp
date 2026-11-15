import { describe, expect, it } from 'vitest';
import { TenantAccess, buildGrants } from '../src/auth/access.js';
import { SecretBox } from '../src/auth/secret-box.js';
import { base32Decode, base32Encode, hotp, verifyTotp } from '../src/auth/totp.js';
import { FixedWindowLimiter } from '../src/common/rate-limiter.js';
import { redactForAudit } from '../src/tenancy/audit.service.js';
import { describeDay, describeRange, rangesOverlap } from '../src/academic/working-days.js';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B, SHA-1 secret "12345678901234567890".
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches the RFC test vector at T=%i', (t, expected) => {
    expect(hotp(secret, Math.floor(t / 30), 8)).toBe(expected);
  });

  it('round-trips base32 and verifies within one step of drift, without replay', () => {
    const b32 = base32Encode(secret);
    expect(base32Decode(b32).equals(secret)).toBe(true);
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = hotp(secret, step, 6);
    expect(verifyTotp(b32, code, null, now)).toBe(step);
    expect(verifyTotp(b32, code, step, now)).toBeNull();
    expect(verifyTotp(b32, hotp(secret, step - 1, 6), null, now)).toBe(step - 1);
    expect(verifyTotp(b32, hotp(secret, step - 3, 6), null, now)).toBeNull();
    expect(verifyTotp(b32, 'abcdef', null, now)).toBeNull();
  });
});

describe('SecretBox', () => {
  const box = new SecretBox(Buffer.alloc(32, 9).toString('base64'));
  it('encrypts with a fresh IV and detects tampering', () => {
    const a = box.seal('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(box.seal('JBSWY3DPEHPK3PXP'));
    expect(box.open(a)).toBe('JBSWY3DPEHPK3PXP');
    const raw = Buffer.from(a.slice(3), 'base64');
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(() => box.open(`v1:${raw.toString('base64')}`)).toThrow();
  });
  it('rejects the wrong key', () => {
    const other = new SecretBox(Buffer.alloc(32, 1).toString('base64'));
    expect(() => other.open(box.seal('x'))).toThrow();
  });
});

describe('TenantAccess', () => {
  const C1 = '00000000-0000-7000-8000-000000000001';
  const C2 = '00000000-0000-7000-8000-000000000002';
  const rows = [
    {
      membership_id: 'm',
      tenant_status: 'active',
      role_id: 'r1',
      campus_id: C1,
      permission_key: 'members.view',
    },
    {
      membership_id: 'm',
      tenant_status: 'active',
      role_id: 'r1',
      campus_id: C1,
      permission_key: 'settings.manage',
    },
    {
      membership_id: 'm',
      tenant_status: 'active',
      role_id: 'r2',
      campus_id: null,
      permission_key: 'audit.view',
    },
  ];
  const { grants, campusScope } = buildGrants(rows);
  const access = new TenantAccess('t', 'u', 'm', 'req', 's', true, grants, campusScope, null);

  it('scopes permissions to campuses', () => {
    expect(access.has('settings.manage')).toBe(true);
    expect(access.has('settings.manage', C1)).toBe(true);
    expect(access.has('settings.manage', C2)).toBe(false);
    expect(access.hasTenantWide('settings.manage')).toBe(false);
    expect(access.hasTenantWide('audit.view')).toBe(true);
    expect(access.has('roles.manage')).toBe(false);
  });

  it('only grants what it holds, at the scope it holds', () => {
    expect(access.canGrant('settings.manage', C1)).toBe(true);
    expect(access.canGrant('settings.manage', null)).toBe(false);
    expect(access.canGrant('audit.view', null)).toBe(true);
  });

  it('a tenant-wide role makes every campus visible', () => {
    expect(campusScope).toBeNull();
  });
});

describe('audit redaction', () => {
  it('removes secrets and masks contact details at any depth', () => {
    const out = redactForAudit({
      email: 'asha@school.in',
      phone: '+919829012345',
      password: 'p',
      nested: { token: 't', name: 'Visible' },
    });
    expect(out).toEqual({
      email: 'a***@school.in',
      phone: '*********2345',
      password: '[redacted]',
      nested: { token: '[redacted]', name: 'Visible' },
    });
  });

  it('keeps business codes visible but hides auth codes', () => {
    expect(
      redactForAudit({
        code: 'JPR-01',
        campusCode: 'MAIN',
        reset_code: '123456',
        totpCode: '654321',
        mfaSecret: 's',
        recoveryCodes: ['a'],
      }),
    ).toEqual({
      code: 'JPR-01',
      campusCode: 'MAIN',
      reset_code: '[redacted]',
      totpCode: '[redacted]',
      mfaSecret: '[redacted]',
      recoveryCodes: '[redacted]',
    });
  });
});

describe('FixedWindowLimiter', () => {
  it('blocks after the limit and resets after the window', () => {
    const l = new FixedWindowLimiter();
    for (let i = 0; i < 3; i++) l.consume('k', 3, 1000, 0);
    expect(() => l.consume('k', 3, 1000, 10)).toThrow(/Too many/);
    expect(() => l.consume('k', 3, 1000, 1001)).not.toThrow();
  });
});

describe('working days', () => {
  const year = {
    id: 'y',
    name: '2026-27',
    startsOn: '2026-04-01',
    endsOn: '2027-03-31',
    weeklyOffDays: [0],
    saturdayOffWeeks: [2, 4],
  };

  it('applies Sundays, 2nd/4th Saturdays and holidays', () => {
    // 1 Aug 2026 is a Saturday (1st Saturday → working); 8 Aug is the 2nd Saturday.
    expect(describeDay('2026-08-01', [year], [])).toMatchObject({ working: true });
    expect(describeDay('2026-08-08', [year], [])).toMatchObject({ reason: 'saturday_off' });
    expect(describeDay('2026-08-02', [year], [])).toMatchObject({ reason: 'weekly_off' });
    expect(
      describeDay(
        '2026-08-15',
        [year],
        [
          {
            title: 'Independence Day',
            kind: 'holiday',
            startsOn: '2026-08-15',
            endsOn: '2026-08-15',
          },
        ],
      ),
    ).toMatchObject({ reason: 'holiday', title: 'Independence Day' });
    // Events and exams do not close the school.
    expect(
      describeDay(
        '2026-08-14',
        [year],
        [{ title: 'Exam', kind: 'exam', startsOn: '2026-08-14', endsOn: '2026-08-14' }],
      ),
    ).toMatchObject({ working: true });
    expect(describeDay('2026-03-31', [year], [])).toMatchObject({ reason: 'outside_year' });
  });

  it('counts a range and handles a 5th Saturday rule', () => {
    const fifth = { ...year, saturdayOffWeeks: [5] };
    // August 2026 has five Saturdays: 1, 8, 15, 22, 29.
    expect(describeDay('2026-08-29', [fifth], [])).toMatchObject({ reason: 'saturday_off' });
    const r = describeRange('2026-08-01', '2026-08-31', [year], []);
    // 31 days − 5 Sundays − 2 Saturdays.
    expect(r.workingDays).toBe(24);
    expect(r.days).toHaveLength(31);
  });

  it('detects overlapping date ranges', () => {
    expect(rangesOverlap('2026-04-01', '2026-09-30', '2026-09-30', '2027-03-31')).toBe(true);
    expect(rangesOverlap('2026-04-01', '2026-09-29', '2026-09-30', '2027-03-31')).toBe(false);
  });
});

describe('implied permissions when granting', () => {
  it('lets holders of students.view grant students.view_assigned at the same scope', async () => {
    const { TenantAccess } = await import('../src/auth/access.js');
    const make = (grants: Array<[string, Set<string> | null]>) =>
      new TenantAccess('t', 'u', 'm', 'r', 's', false, new Map(grants), null, null);
    const wide = make([['students.view', null]]);
    expect(wide.canGrant('students.view_assigned', null)).toBe(true);
    expect(wide.has('students.view_assigned')).toBe(false); // visibility stays explicit
    const campus = make([['students.view', new Set(['c1'])]]);
    expect(campus.canGrant('students.view_assigned', 'c1')).toBe(true);
    expect(campus.canGrant('students.view_assigned', 'c2')).toBe(false);
    expect(campus.canGrant('students.view_assigned', null)).toBe(false);
    expect(make([]).canGrant('students.view_assigned', null)).toBe(false);
  });
});

describe('validation errors for either/or inputs', () => {
  it('points at the field of the alternative the client meant', async () => {
    const { guardianInputSchema } = await import('@school-erp/validation');
    const { flattenUnions } = await import('../src/common/zod.pipe.js');
    const bad = guardianInputSchema.safeParse({
      fullName: 'Asha',
      phone: '12',
      relationship: 'mother',
    });
    const paths = flattenUnions(bad.error!.issues as never).map((i) => i.path.join('.'));
    expect(paths).toEqual(['phone']);
    const badId = guardianInputSchema.safeParse({ guardianId: 'nope', relationship: 'mother' });
    expect(flattenUnions(badId.error!.issues as never).map((i) => i.path.join('.'))).toEqual([
      'guardianId',
    ]);
  });
});
