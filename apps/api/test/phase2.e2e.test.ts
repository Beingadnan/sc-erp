import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openAppPool, openOwnerPool, prepareDatabase } from '@school-erp/db/testing';
import {
  Browser,
  ORIGIN,
  mailer,
  registerSchool,
  startApp,
  tokenFromMail,
  totpNow,
  unique,
} from './support.js';
import type { School } from './support.js';

/**
 * Phase 2 security suite. Two independent schools (A and B) throughout.
 * Any failure here is a security defect.
 */
describe('Phase 2: platform foundation (e2e)', () => {
  let app: INestApplication;
  let owner: Pool;
  let A: School;
  let B: School;

  const roleId = async (s: School, key: string): Promise<string> => {
    const res = await s.browser.get('/roles');
    return res.body.find((r: { key: string }) => r.key === key).id;
  };

  const inviteNew = async (s: School, roleKey: string, campusId: string | null = null) => {
    const email = `${unique('staff')}@example.test`;
    const res = await s.browser.post('/members/invite', {
      email,
      fullName: 'New Staff',
      assignments: [{ roleId: await roleId(s, roleKey), campusId }],
    });
    expect(res.status).toBe(201);
    const token = tokenFromMail(mailer(app).lastTo(email, 'invite'));
    const browser = new Browser(app);
    const accepted = await browser.post('/auth/invite/accept', {
      token,
      password: 'staff passphrase 123',
    });
    expect(accepted.status).toBe(201);
    return { email, browser, membershipId: res.body.id as string };
  };

  beforeAll(async () => {
    const pool = await prepareDatabase();
    await pool.end();
    owner = openOwnerPool();
    app = await startApp();
    A = await registerSchool(app, 'A');
    B = await registerSchool(app, 'B');
  });

  afterAll(async () => {
    await app?.close();
    await owner?.end();
  });

  // ------------------------------------------------------------------ registration

  describe('school registration', () => {
    it('creates an isolated tenant with an owner, a campus and system roles', async () => {
      const me = await A.browser.get('/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.tenants).toHaveLength(1);
      expect(me.body.tenants[0]).toMatchObject({ slug: A.slug, membershipStatus: 'active' });
      const roles = await A.browser.get('/roles');
      expect(roles.body.map((r: { key: string }) => r.key)).toEqual(
        expect.arrayContaining([
          'owner',
          'school_admin',
          'principal',
          'teacher',
          'accountant',
          'parent',
        ]),
      );
      const tenant = await A.browser.get('/tenant');
      expect(tenant.body.permissions).toEqual(
        expect.arrayContaining(['settings.manage', 'members.manage', 'roles.manage', 'audit.view']),
      );
    });

    it('rejects a taken school address and a taken email', async () => {
      const b = new Browser(app);
      const base = {
        schoolName: 'Copy School',
        campusName: 'Main',
        board: 'CBSE',
        fullName: 'Someone Else',
        password: 'another long passphrase',
      };
      const slugTaken = await b.post('/auth/register-school', {
        ...base,
        slug: A.slug,
        email: 'x1@example.test',
      });
      expect(slugTaken.status).toBe(409);
      const emailTaken = await b.post('/auth/register-school', {
        ...base,
        slug: unique('c'),
        email: A.email,
      });
      expect(emailTaken.status).toBe(409);
      // The failed attempt with a new email must not leave an orphan user behind.
      const { rows } = await owner.query(`select 1 from users where email = 'x1@example.test'`);
      expect(rows).toHaveLength(0);
    });

    it('validates input without echoing it', async () => {
      const res = await new Browser(app).post('/auth/register-school', {
        slug: 'x',
        password: 'short',
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(res.body)).not.toContain('short');
    });

    it('verifies the email address from the registration email', async () => {
      const token = tokenFromMail(mailer(app).lastTo(A.email, 'verify_email'));
      expect((await new Browser(app).post('/auth/email/verify', { token })).status).toBe(204);
      expect((await A.browser.get('/auth/me')).body.user.emailVerified).toBe(true);
      expect((await new Browser(app).post('/auth/email/verify', { token })).status).toBe(422);
    });
  });

  // ------------------------------------------------------------------ sessions & CSRF

  describe('sessions and request forgery', () => {
    it('requires a session', async () => {
      const res = await new Browser(app).get('/campuses');
      expect(res.status).toBe(401);
    });

    it('blocks state changes without the CSRF token', async () => {
      const res = await A.browser.agent
        .post('/api/v1/campuses')
        .send({ code: 'NOCSRF', name: 'No CSRF', board: 'CBSE' });
      expect(res.status).toBe(403);
      expect(res.body.error.details.reason).toBe('csrf');
      const wrong = await A.browser.agent
        .post('/api/v1/campuses')
        .set('X-CSRF-Token', 'not-the-token')
        .send({ code: 'NOCSRF', name: 'No CSRF', board: 'CBSE' });
      expect(wrong.status).toBe(403);
    });

    it('blocks cross-site origins', async () => {
      const res = await A.browser.agent
        .post('/api/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .send({ email: A.email, password: A.password });
      expect(res.status).toBe(403);
      expect(res.body.error.details.reason).toBe('origin');
    });

    it('sets HttpOnly SameSite session cookies', async () => {
      const b = new Browser(app);
      const res = await b.post('/auth/login', { email: A.email, password: A.password });
      const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      const sid = cookies.find((c) => c.startsWith('sid='))!;
      expect(sid).toMatch(/HttpOnly/i);
      expect(sid).toMatch(/SameSite=Lax/i);
      expect(cookies.find((c) => c.startsWith('csrf='))).not.toMatch(/HttpOnly/i);
    });

    it('lists and revokes sessions; a revoked session stops working', async () => {
      const other = new Browser(app);
      await other.post('/auth/login', { email: A.email, password: A.password });
      expect((await other.get('/auth/me')).status).toBe(200);
      const list = await A.browser.get('/auth/sessions');
      const victim = list.body.find((s: { current: boolean }) => !s.current);
      expect((await A.browser.delete(`/auth/sessions/${victim.id}`)).status).toBe(204);
      // Revoke every other session so the check below is deterministic.
      for (const s of (await A.browser.get('/auth/sessions')).body.filter(
        (x: { current: boolean }) => !x.current,
      )) {
        await A.browser.delete(`/auth/sessions/${s.id}`);
      }
      expect((await other.get('/auth/me')).status).toBe(401);
    });

    it('cannot revoke another user’s session', async () => {
      const bSessions = await B.browser.get('/auth/sessions');
      const res = await A.browser.delete(`/auth/sessions/${bSessions.body[0].id}`);
      expect(res.status).toBe(404);
      expect((await B.browser.get('/auth/me')).status).toBe(200);
    });

    it('logout ends the session', async () => {
      const b = new Browser(app);
      await b.post('/auth/login', { email: B.email, password: B.password });
      expect((await b.post('/auth/logout')).status).toBe(204);
      expect((await b.get('/auth/me')).status).toBe(401);
    });
  });

  // ------------------------------------------------------------------ login protection

  describe('login protection', () => {
    it('gives the same answer for unknown emails and wrong passwords', async () => {
      const unknown = await new Browser(app).post('/auth/login', {
        email: 'nobody@example.test',
        password: 'x',
      });
      const wrong = await new Browser(app).post('/auth/login', {
        email: A.email,
        password: 'wrong password',
      });
      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
    });

    it('locks an account after 5 failed attempts', async () => {
      const victim = await inviteNew(A, 'teacher');
      for (let i = 0; i < 5; i++) {
        await new Browser(app).post('/auth/login', {
          email: victim.email,
          password: 'wrong password',
        });
      }
      const res = await new Browser(app).post('/auth/login', {
        email: victim.email,
        password: 'staff passphrase 123',
      });
      expect(res.status).toBe(401);
      const { rows } = await owner.query(
        `select locked_until > now() as locked from users where email = $1`,
        [victim.email],
      );
      expect(rows[0].locked).toBe(true);
    });
  });

  // ------------------------------------------------------------------ tenant isolation

  describe('tenant isolation through the API', () => {
    it('School A sees only its own campuses, members, roles and audit log', async () => {
      const campuses = await A.browser.get('/campuses');
      expect(campuses.body.map((c: { id: string }) => c.id)).toEqual([A.campusId]);
      const members = await A.browser.get('/members');
      expect(members.body.map((m: { email: string }) => m.email)).not.toContain(B.email);
      const aRoles = (await A.browser.get('/roles')).body.map((r: { id: string }) => r.id);
      const bRoles = (await B.browser.get('/roles')).body.map((r: { id: string }) => r.id);
      expect(aRoles.filter((id: string) => bRoles.includes(id))).toEqual([]);
      const audit = await A.browser.get('/audit-logs?limit=100');
      expect(audit.body.data.every((e: { entityId: string }) => e.entityId !== B.tenantId)).toBe(
        true,
      );
    });

    it('School A cannot change School B records by id (IDOR → 404)', async () => {
      expect((await A.browser.patch(`/campuses/${B.campusId}`, { name: 'Hacked' })).status).toBe(
        404,
      );
      const bOwnerMembership = (await B.browser.get('/members')).body[0].id;
      expect(
        (await A.browser.patch(`/members/${bOwnerMembership}`, { status: 'suspended' })).status,
      ).toBe(404);
      expect(
        (await A.browser.put(`/members/${bOwnerMembership}/roles`, { assignments: [] })).status,
      ).toBe(404);
      const bTeacherRole = await roleId(B, 'teacher');
      expect(
        (
          await A.browser.post('/members/invite', {
            email: `${unique('x')}@example.test`,
            fullName: 'Cross Tenant',
            assignments: [{ roleId: bTeacherRole, campusId: null }],
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await A.browser.post('/members/invite', {
            email: `${unique('x')}@example.test`,
            fullName: 'Cross Campus',
            assignments: [{ roleId: await roleId(A, 'teacher'), campusId: B.campusId }],
          })
        ).status,
      ).toBe(404);
      const campus = await B.browser.get('/campuses');
      expect(campus.body[0].name).toBe('Main Campus');
    });

    it('cannot switch into a school without membership', async () => {
      expect((await A.browser.post('/auth/switch-tenant', { tenantId: B.tenantId })).status).toBe(
        404,
      );
    });

    it('a user in two schools only sees the active school', async () => {
      // B invites A's owner (an existing account) → active immediately.
      const res = await B.browser.post('/members/invite', {
        email: A.email,
        fullName: 'Owner A',
        assignments: [{ roleId: await roleId(B, 'principal'), campusId: null }],
      });
      expect(res.body.status).toBe('active');
      const me = await A.browser.get('/auth/me');
      expect(me.body.tenants.map((t: { id: string }) => t.id).sort()).toEqual(
        [A.tenantId, B.tenantId].sort(),
      );

      expect((await A.browser.post('/auth/switch-tenant', { tenantId: B.tenantId })).status).toBe(
        204,
      );
      try {
        const campuses = await A.browser.get('/campuses');
        expect(campuses.body.map((c: { id: string }) => c.id)).toEqual([B.campusId]);
        // As a principal in B, A's owner is a member there but has no settings.manage → 403.
        expect((await A.browser.patch(`/campuses/${B.campusId}`, { name: 'X' })).status).toBe(403);
        expect(
          (await A.browser.post('/campuses', { code: 'X1', name: 'X', board: 'CBSE' })).status,
        ).toBe(403);
      } finally {
        expect((await A.browser.post('/auth/switch-tenant', { tenantId: A.tenantId })).status).toBe(
          204,
        );
      }
    });
  });

  // ------------------------------------------------------------------ permissions

  describe('roles, permissions and privilege escalation', () => {
    it('a teacher cannot manage people, roles or settings', async () => {
      const teacher = await inviteNew(A, 'teacher');
      expect((await teacher.browser.get('/campuses')).status).toBe(200);
      expect((await teacher.browser.get('/members')).status).toBe(403);
      expect((await teacher.browser.get('/audit-logs')).status).toBe(403);
      expect(
        (await teacher.browser.post('/campuses', { code: 'T1', name: 'T', board: 'CBSE' })).status,
      ).toBe(403);
      expect((await teacher.browser.patch('/tenant', { name: 'Renamed' })).status).toBe(403);
    });

    it('custom roles: a member manager cannot hand out powers they lack', async () => {
      const create = await A.browser.post('/roles', {
        key: unique('people_mgr').replace(/-/g, '_'),
        name: 'People manager',
        permissions: ['members.view', 'members.manage'],
      });
      expect(create.status).toBe(201);
      const manager = await inviteNew(A, create.body.key);

      // Cannot grant the owner role (it holds settings.manage, roles.manage …)
      const escalate = await manager.browser.post('/members/invite', {
        email: `${unique('esc')}@example.test`,
        fullName: 'Escalation',
        assignments: [{ roleId: await roleId(A, 'owner'), campusId: null }],
      });
      expect(escalate.status).toBe(403);
      // Cannot give themselves the owner role
      expect(
        (
          await manager.browser.put(`/members/${manager.membershipId}/roles`, {
            assignments: [{ roleId: await roleId(A, 'owner'), campusId: null }],
          })
        ).status,
      ).toBe(403);
      // Cannot create roles
      expect(
        (await manager.browser.post('/roles', { key: 'sneaky', name: 'Sneaky', permissions: [] }))
          .status,
      ).toBe(403);
      // Cannot suspend the owner
      const ownerMembership = (await A.browser.get('/members')).body.find(
        (m: { email: string }) => m.email === A.email,
      ).id;
      expect(
        (await manager.browser.patch(`/members/${ownerMembership}`, { status: 'suspended' }))
          .status,
      ).toBe(403);
      // Cannot hand out the teacher role either: it includes academic.view (Phase 3) and
      // seeing students of one's sections (Phase 4) and taking attendance (Phase 5), which
      // this role lacks. Once the manager holds those, inviting teachers works.
      const lacking = await manager.browser.post('/members/invite', {
        email: `${unique('no')}@example.test`,
        fullName: 'Blocked Teacher',
        assignments: [{ roleId: await roleId(A, 'teacher'), campusId: A.campusId }],
      });
      expect(lacking.status).toBe(403);
      expect(
        (
          await A.browser.put(`/roles/${create.body.id}/permissions`, {
            permissions: [
              'members.view',
              'members.manage',
              'academic.view',
              'students.view',
              'attendance.correct',
            ],
          })
        ).status,
      ).toBeLessThan(300);
      const ok = await manager.browser.post('/members/invite', {
        email: `${unique('ok')}@example.test`,
        fullName: 'Fine Teacher',
        assignments: [{ roleId: await roleId(A, 'teacher'), campusId: A.campusId }],
      });
      expect(ok.status).toBe(201);
    });

    it('system roles cannot be edited; unknown permissions are rejected', async () => {
      const ownerRole = await roleId(A, 'owner');
      expect(
        (await A.browser.put(`/roles/${ownerRole}/permissions`, { permissions: [] })).status,
      ).toBe(409);
      expect(
        (
          await A.browser.post('/roles', {
            key: 'bad_perm',
            name: 'Bad',
            permissions: ['root.everything'],
          })
        ).status,
      ).toBe(422);
    });

    it('the last owner cannot be removed or suspended', async () => {
      const members = (await A.browser.get('/members')).body;
      const self = members.find((m: { email: string }) => m.email === A.email);
      expect((await A.browser.put(`/members/${self.id}/roles`, { assignments: [] })).status).toBe(
        409,
      );
      expect((await A.browser.patch(`/members/${self.id}`, { status: 'suspended' })).status).toBe(
        409,
      );
    });

    it('suspending a member cuts off access immediately; restoring brings it back', async () => {
      const teacher = await inviteNew(A, 'teacher');
      expect((await teacher.browser.get('/campuses')).status).toBe(200);
      expect(
        (await A.browser.patch(`/members/${teacher.membershipId}`, { status: 'suspended' })).status,
      ).toBe(204);
      const blocked = await teacher.browser.get('/campuses');
      expect(blocked.status).toBe(403);
      expect(
        (await A.browser.patch(`/members/${teacher.membershipId}`, { status: 'active' })).status,
      ).toBe(204);
      expect((await teacher.browser.get('/campuses')).status).toBe(200);
    });

    it('campus-scoped administrators only reach their campus', async () => {
      const second = await A.browser.post('/campuses', {
        code: unique('C').toUpperCase().slice(0, 12),
        name: 'City Campus',
        board: 'RBSE',
      });
      expect(second.status).toBe(201);
      const admin = await inviteNew(A, 'school_admin', second.body.id);
      const visible = (await admin.browser.get('/campuses')).body.map((c: { id: string }) => c.id);
      expect(visible).toEqual([second.body.id]);
      expect(
        (await admin.browser.patch(`/campuses/${second.body.id}`, { name: 'City Campus 2' }))
          .status,
      ).toBe(200);
      expect((await admin.browser.patch(`/campuses/${A.campusId}`, { name: 'Nope' })).status).toBe(
        404,
      );
      expect(
        (await admin.browser.post('/campuses', { code: 'NEW1', name: 'New', board: 'CBSE' }))
          .status,
      ).toBe(403);
    });
  });

  // ------------------------------------------------------------------ audit & outbox

  describe('audit log and outbox', () => {
    it('records changes with masked contact details and pages through them', async () => {
      const page1 = await A.browser.get('/audit-logs?limit=2');
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.nextCursor).toBeTruthy();
      const page2 = await A.browser.get(`/audit-logs?limit=2&cursor=${page1.body.nextCursor}`);
      expect(page2.body.data[0].id).not.toBe(page1.body.data[1].id);
      const all = await A.browser.get('/audit-logs?limit=100&entity=membership');
      const invite = all.body.data.find((e: { action: string }) => e.action === 'member.invited');
      expect(invite.diff.email).toMatch(/^\w\*\*\*@example\.test$/);
      expect(
        (await A.browser.get('/audit-logs?limit=100')).body.data.map(
          (e: { action: string }) => e.action,
        ),
      ).toContain('tenant.provisioned');
    });

    it('the application cannot alter audit history', async () => {
      const appPool = openAppPool();
      try {
        await expect(appPool.query(`delete from audit_logs`)).rejects.toThrow(/permission denied/);
        await expect(appPool.query(`update audit_logs set action = 'x'`)).rejects.toThrow(
          /permission denied/,
        );
      } finally {
        await appPool.end();
      }
    });

    it('writes outbox events in the same transaction and counts them per tenant', async () => {
      const { rows } = await owner.query(
        `select pending_count from outbox_pending_tenants where tenant_ref = $1`,
        [A.tenantId],
      );
      expect(rows[0].pending_count).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------ password reset

  describe('password reset', () => {
    it('does not reveal whether an email exists', async () => {
      const before = mailer(app).sent.length;
      const res = await new Browser(app).post('/auth/password/forgot', {
        email: 'ghost@example.test',
      });
      expect(res.status).toBe(202);
      expect(mailer(app).sent.length).toBe(before);
    });

    it('resets the password, revokes old sessions, and the link works once', async () => {
      const user = await inviteNew(B, 'teacher');
      expect((await user.browser.get('/campuses')).status).toBe(200);
      await new Browser(app).post('/auth/password/forgot', { email: user.email });
      const token = tokenFromMail(mailer(app).lastTo(user.email, 'password_reset'));
      const reset = await new Browser(app).post('/auth/password/reset', {
        token,
        password: 'brand new passphrase',
      });
      expect(reset.status).toBe(204);
      expect((await user.browser.get('/campuses')).status).toBe(401);
      expect(
        (
          await new Browser(app).post('/auth/login', {
            email: user.email,
            password: 'brand new passphrase',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await new Browser(app).post('/auth/password/reset', {
            token,
            password: 'another passphrase 9',
          })
        ).status,
      ).toBe(422);
    });
  });

  // ------------------------------------------------------------------ MFA

  describe('two-step verification', () => {
    it('enrols, challenges at login, accepts a recovery code once, and blocks pending sessions', async () => {
      const user = await inviteNew(A, 'teacher');
      const setup = await user.browser.post('/auth/mfa/setup');
      expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      expect((await user.browser.post('/auth/mfa/enable', { code: '000000' })).status).toBe(422);
      const enable = await user.browser.post('/auth/mfa/enable', {
        code: totpNow(setup.body.secret),
      });
      expect(enable.status).toBe(201);
      const recovery: string[] = enable.body.recoveryCodes;
      expect(recovery).toHaveLength(10);

      const b = new Browser(app);
      const login = await b.post('/auth/login', {
        email: user.email,
        password: 'staff passphrase 123',
      });
      expect(login.body.status).toBe('mfa_required');
      const blocked = await b.get('/campuses');
      expect(blocked.status).toBe(401);
      expect(blocked.body.error.code).toBe('MFA_REQUIRED');
      // The code used during enrolment cannot be replayed.
      expect((await b.post('/auth/mfa/verify', { code: totpNow(setup.body.secret) })).status).toBe(
        401,
      );
      expect(
        (await b.post('/auth/mfa/verify', { code: totpNow(setup.body.secret, 1) })).status,
      ).toBe(200);
      expect((await b.get('/campuses')).status).toBe(200);

      const r1 = new Browser(app);
      await r1.post('/auth/login', { email: user.email, password: 'staff passphrase 123' });
      expect((await r1.post('/auth/mfa/verify', { recoveryCode: recovery[0] })).status).toBe(200);
      const r2 = new Browser(app);
      await r2.post('/auth/login', { email: user.email, password: 'staff passphrase 123' });
      expect((await r2.post('/auth/mfa/verify', { recoveryCode: recovery[0] })).status).toBe(401);
    });

    it('requires MFA for privileged permissions when enforcement is on', async () => {
      const strict = await startApp({ MFA_ENFORCEMENT: 'on' });
      try {
        const b = new Browser(strict);
        await b.post('/auth/login', { email: B.email, password: B.password });
        expect((await b.get('/tenant')).status).toBe(200);
        const res = await b.patch('/tenant', { name: 'Renamed B' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('MFA_SETUP_REQUIRED');
      } finally {
        await strict.close();
      }
    });
  });

  // ------------------------------------------------------------------ platform

  describe('platform administration', () => {
    it('is invisible to school users and works for platform staff', async () => {
      expect((await A.browser.get('/platform/tenants')).status).toBe(404);
      await owner.query(
        `insert into platform_admins (user_id, role)
         select id, 'super_admin' from users where email = $1 on conflict do nothing`,
        [A.email],
      );
      const list = await A.browser.get(`/platform/tenants?search=${B.slug}`);
      expect(list.status).toBe(200);
      expect(list.body.map((t: { id: string }) => t.id)).toEqual([B.tenantId]);

      expect(
        (await A.browser.post(`/platform/tenants/${B.tenantId}/status`, { status: 'suspended' }))
          .status,
      ).toBe(422);
      expect(
        (
          await A.browser.post(`/platform/tenants/${B.tenantId}/status`, {
            status: 'suspended',
            reason: 'Unpaid invoice test',
          })
        ).status,
      ).toBe(204);
      const blocked = await B.browser.get('/campuses');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.details.reason).toBe('tenant_suspended');
      await A.browser.post(`/platform/tenants/${B.tenantId}/status`, {
        status: 'active',
        reason: 'Payment received',
      });
      expect((await B.browser.get('/campuses')).status).toBe(200);
      const audit = await B.browser.get('/audit-logs?limit=100&entity=tenant');
      const actions = audit.body.data.map(
        (e: { action: string; actorType: string }) => `${e.action}:${e.actorType}`,
      );
      expect(actions).toContain('tenant.status_changed:platform');
    });

    it('support staff cannot change tenant status', async () => {
      const support = await registerSchool(app, 'S');
      await owner.query(
        `insert into platform_admins (user_id, role) select id, 'support' from users where email = $1`,
        [support.email],
      );
      expect((await support.browser.get('/platform/tenants')).status).toBe(200);
      expect(
        (
          await support.browser.post(`/platform/tenants/${B.tenantId}/status`, {
            status: 'suspended',
            reason: 'Not allowed',
          })
        ).status,
      ).toBe(404);
    });
  });

  it('keeps the web origin constant used by the tests in the allow-list', () => {
    expect(ORIGIN).toBe('http://localhost:3000');
  });
});
