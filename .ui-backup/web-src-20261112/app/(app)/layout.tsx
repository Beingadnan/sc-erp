'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, post } from '@/lib/api';
import type { Me, Tenant } from '@/lib/api';
import { SessionContext } from '@/lib/session';
import type { SessionValue } from '@/lib/session';
import { Button, Skeleton } from '@/components/ui';

interface NavItem {
  href: string;
  label: string;
  /** Shown only with this permission (any scope); a list means any of them. */
  permission?: string | string[];
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  { section: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard' }] },
  {
    section: 'School',
    items: [
      { href: '/settings/school', label: 'School profile' },
      { href: '/settings/campuses', label: 'Campuses' },
      {
        href: '/settings/admission-numbers',
        label: 'Admission numbers',
        permission: 'students.manage',
      },
    ],
  },
  {
    section: 'Academics',
    items: [
      { href: '/academics/years', label: 'Academic years', permission: 'academic.view' },
      { href: '/academics/classes', label: 'Classes & sections', permission: 'academic.view' },
      { href: '/academics/subjects', label: 'Subjects', permission: 'academic.view' },
      { href: '/academics/calendar', label: 'Calendar', permission: 'academic.view' },
      { href: '/academics/grading', label: 'Grading', permission: 'academic.view' },
    ],
  },
  {
    section: 'Students',
    items: [
      {
        href: '/students',
        label: 'Students',
        permission: ['students.view', 'students.view_assigned'],
      },
      { href: '/students/new', label: 'Admit a student', permission: 'students.manage' },
      { href: '/students/promote', label: 'Promote', permission: 'students.promote' },
      { href: '/students/import', label: 'Import', permission: 'students.import' },
    ],
  },
  {
    section: 'Attendance',
    items: [
      {
        href: '/attendance',
        label: 'Today',
        permission: ['attendance.view', 'attendance.mark', 'attendance.correct'],
      },
      {
        href: '/attendance/mark',
        label: 'Take attendance',
        permission: ['attendance.mark', 'attendance.correct'],
      },
      {
        href: '/attendance/register',
        label: 'Monthly register',
        permission: ['attendance.view', 'attendance.mark', 'attendance.correct'],
      },
      {
        href: '/attendance/leave',
        label: 'Leave',
        permission: ['attendance.view', 'attendance.mark', 'attendance.correct'],
      },
      {
        href: '/attendance/low',
        label: 'Low attendance',
        permission: ['attendance.view', 'attendance.mark', 'attendance.correct'],
      },
      {
        href: '/settings/attendance',
        label: 'Settings',
        permission: ['attendance.view', 'attendance.correct'],
      },
    ],
  },
  {
    section: 'Fees',
    items: [
      { href: '/fees/collect', label: 'Fee counter', permission: 'fees.collect' },
      {
        href: '/fees/receipts',
        label: 'Receipts',
        permission: ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'],
      },
      {
        href: '/fees/day-close',
        label: 'Day closing',
        permission: ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'],
      },
      {
        href: '/fees/reports',
        label: 'Reports',
        permission: ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'],
      },
      {
        href: '/fees',
        label: 'Demands',
        permission: ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'],
      },
      {
        href: '/fees/structures',
        label: 'Fee structures',
        permission: ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'],
      },
      {
        href: '/fees/concessions',
        label: 'Concessions',
        permission: ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'],
      },
      {
        href: '/fees/heads',
        label: 'Fee heads',
        permission: ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'],
      },
      {
        href: '/fees/accounts',
        label: 'Accounts',
        permission: ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'],
      },
    ],
  },
  {
    section: 'Admissions',
    items: [
      { href: '/admissions/inquiries', label: 'Inquiries', permission: 'admissions.view' },
      { href: '/admissions/applications', label: 'Applications', permission: 'admissions.view' },
    ],
  },
  {
    section: 'Website',
    items: [{ href: '/website', label: 'Website pages', permission: 'cms.manage' }],
  },
  {
    section: 'People',
    items: [
      { href: '/settings/members', label: 'Staff & access', permission: 'members.view' },
      { href: '/settings/roles', label: 'Roles', permission: 'members.view' },
      { href: '/settings/audit', label: 'Audit log', permission: 'audit.view' },
    ],
  },
  { section: 'Account', items: [{ href: '/account/security', label: 'Security' }] },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Fetch the user and the active school together and commit both at once, so the
  // shell never renders with a user but no school (which looked like "no access").
  const load = useCallback(async () => {
    try {
      const m = await api<Me>('/auth/me');
      let t: Tenant | null = null;
      if (m.activeTenantId) {
        try {
          t = await api<Tenant>('/tenant');
        } catch (e) {
          // Membership/school no longer usable: treat as "no active school".
          // Anything else (network, 5xx) is a load failure, not a lack of access.
          if (!(e instanceof ApiError && (e.status === 403 || e.status === 404))) throw e;
        }
      }
      setMe(m);
      setTenant(t);
      setLoadError(false);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.body.code === 'MFA_REQUIRED')) {
        router.replace('/login');
        return;
      }
      setLoadError(true);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<SessionValue | null>(
    () =>
      me && {
        me,
        tenant,
        can: (p: string, campusId?: string) => {
          if (!tenant?.permissions.includes(p)) return false;
          if (!campusId) return true;
          const scope = tenant.permissionScopes?.[p];
          return scope === null || scope === undefined || scope.includes(campusId);
        },
        canEverywhere: (p: string) =>
          Boolean(tenant?.permissions.includes(p) && tenant.permissionScopes?.[p] === null),
        reload: load,
      },
    [me, tenant, load],
  );

  if (!value && loadError) {
    return (
      <div className="mx-auto max-w-md p-10 text-center" role="alert">
        <p className="text-sm text-slate-700">
          We could not load your account. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!value) {
    return (
      <div className="mx-auto max-w-5xl p-10">
        <Skeleton rows={6} />
      </div>
    );
  }

  const switchTenant = async (id: string) => {
    await post('/auth/switch-tenant', { tenantId: id });
    await load();
    router.push('/dashboard');
  };

  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    router.replace('/login');
  };

  const activeTenants = value.me.tenants.filter((t) => t.membershipStatus === 'active');

  const navLinks = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {NAV.map((group) => {
        const items = group.items.filter(
          (i) =>
            !i.permission ||
            (Array.isArray(i.permission) ? i.permission : [i.permission]).some((p) => value.can(p)),
        );
        if (!items.length) return null;
        return (
          <div key={group.section}>
            <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              {group.section}
            </p>
            <ul className="flex flex-col">
              {items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setNavOpen(false)}
                      className={`block rounded-md px-2 py-1.5 text-sm ${
                        active
                          ? 'bg-brand-50 font-medium text-brand-700'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <SessionContext.Provider value={value}>
      <div className="flex min-h-dvh">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
          <div className="border-b border-slate-200 px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">School</p>
            {activeTenants.length > 1 ? (
              <select
                aria-label="Switch school"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium"
                value={value.me.activeTenantId ?? ''}
                onChange={(e) => void switchTenant(e.target.value)}
              >
                {activeTenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-1 truncate text-sm font-semibold">
                {value.tenant?.name ?? 'No school selected'}
              </p>
            )}
          </div>
          {navLinks}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
            <div className="flex items-center gap-2 md:hidden">
              <Button
                variant="ghost"
                aria-label="Open menu"
                aria-expanded={navOpen}
                onClick={() => setNavOpen((o) => !o)}
              >
                <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
                  <path
                    d="M3 5h14M3 10h14M3 15h14"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </Button>
              <span className="truncate font-semibold">{value.tenant?.name ?? 'School ERP'}</span>
            </div>
            <div className="hidden md:block" />
            <div className="relative">
              <Button
                variant="ghost"
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                  {value.me.user.fullName.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden sm:inline">{value.me.user.fullName}</span>
              </Button>
              {menuOpen && (
                <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  <p className="truncate px-3 py-2 text-xs text-slate-500">{value.me.user.email}</p>
                  <Link
                    href="/account/security"
                    className="block rounded-md px-3 py-2 text-sm hover:bg-slate-100"
                    onClick={() => setMenuOpen(false)}
                  >
                    Security settings
                  </Link>
                  <button
                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-slate-100"
                    onClick={logout}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </header>
          {navOpen && (
            <div className="border-b border-slate-200 bg-white md:hidden">
              {activeTenants.length > 1 && (
                <div className="px-4 pt-3">
                  <select
                    aria-label="Switch school"
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium"
                    value={value.me.activeTenantId ?? ''}
                    onChange={(e) => void switchTenant(e.target.value)}
                  >
                    {activeTenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {navLinks}
            </div>
          )}
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        </div>
      </div>
    </SessionContext.Provider>
  );
}
