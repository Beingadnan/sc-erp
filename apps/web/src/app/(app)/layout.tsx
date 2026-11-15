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
import { MODULES, NAV_GROUPS, locate } from '@/components/shell/nav';
import {
  ChevronDown,
  Heart,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('nav-collapsed') === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => setSetupOpen(false), [pathname]);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('nav-collapsed', c ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !c;
    });

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
        router.replace(pathname.startsWith('/parent') ? '/parent/login' : '/login');
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

  // Parents (no staff permission at all) only ever see the family pages.
  const familyOnly = Boolean(
    tenant?.permissions.length && tenant.permissions.every((p) => p === 'family.portal'),
  );
  const inFamily = pathname === '/parent' || pathname.startsWith('/parent/');
  useEffect(() => {
    if (familyOnly && !inFamily) router.replace('/parent');
  }, [familyOnly, inFamily, router]);

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
    router.replace(inFamily ? '/parent/login' : '/login');
  };

  const activeTenants = value.me.tenants.filter((t) => t.membershipStatus === 'active');

  if (familyOnly && !inFamily) {
    return (
      <div className="mx-auto max-w-5xl p-10">
        <Skeleton rows={6} />
      </div>
    );
  }

  if (inFamily) {
    return (
      <SessionContext.Provider value={value}>
        <div className="flex min-h-dvh flex-col bg-[var(--color-canvas)]">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
            <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-4">
              <Link href="/parent" className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-brand-600 text-sm font-bold text-white">
                  {(value.tenant?.name ?? 'S').slice(0, 1).toUpperCase()}
                </span>
                {activeTenants.length > 1 ? (
                  <select
                    aria-label="Switch school"
                    className="max-w-[60vw] truncate rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-semibold"
                    value={value.me.activeTenantId ?? ''}
                    onClick={(e) => e.preventDefault()}
                    onChange={(e) =>
                      void switchTenant(e.target.value).then(() => router.push('/parent'))
                    }
                  >
                    {activeTenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="block truncate font-semibold">
                    {value.tenant?.name ?? 'School'}
                  </span>
                )}
              </Link>
              <div className="flex items-center gap-1">
                {!familyOnly && (
                  <Link
                    href="/dashboard"
                    className="rounded-md px-2 py-1 text-sm text-brand-700 hover:bg-slate-100"
                  >
                    Staff view
                  </Link>
                )}
                <Button variant="ghost" onClick={logout}>
                  Sign out
                </Button>
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-5">{children}</main>
        </div>
      </SessionContext.Provider>
    );
  }

  const can = (p?: string | string[]) =>
    !p || (Array.isArray(p) ? p : [p]).some((x) => value.can(x));
  const modules = MODULES.map((m) => ({
    ...m,
    pages: m.pages.filter((pg) => can(pg.permission)),
  })).filter((m) => m.pages.length);
  const here = locate(pathname);
  const current = here ? modules.find((m) => m.key === here.module.key) : undefined;
  const daily = current?.pages.filter((p) => !p.setup) ?? [];
  const setup = current?.pages.filter((p) => p.setup) ?? [];

  const findStudent = can(['students.view', 'students.view_assigned']) && !familyOnly;
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    modules: modules.filter((m) => m.group === g.key),
  })).filter((g) => g.modules.length);

  const navList = (compact: boolean) => (
    <nav aria-label="Navigation" className="flex flex-1 flex-col gap-3 overflow-y-auto px-2 py-3">
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-0.5">
          {!compact && groups.length > 1 && (
            <p className="px-2 pb-1 text-xs font-semibold text-slate-500">{g.label}</p>
          )}
          {g.modules.map((m) => {
            const active = current?.key === m.key;
            const first = m.pages.find((p) => !p.setup) ?? m.pages[0]!;
            const Icon = m.icon;
            return (
              <Link
                key={m.key}
                href={first.href}
                title={compact ? m.label : undefined}
                aria-current={active ? 'page' : undefined}
                onClick={() => setNavOpen(false)}
                className={`relative flex h-9 items-center gap-2.5 rounded-[4px] px-2 text-sm transition-colors ${
                  compact ? 'justify-center' : ''
                } ${
                  active
                    ? 'bg-white font-semibold text-slate-900 shadow-[0_0_2px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.14)]'
                    : 'text-slate-700 hover:bg-slate-200/60 hover:text-slate-900'
                }`}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand-600"
                  />
                )}
                <Icon
                  aria-hidden
                  className={`size-5 shrink-0 ${active ? 'text-brand-600' : 'text-slate-600'}`}
                  strokeWidth={active ? 2 : 1.75}
                />
                {!compact && <span className="truncate">{m.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const schoolPicker = () =>
    activeTenants.length > 1 ? (
      <select
        aria-label="Switch school"
        className="ui-control min-w-0 flex-1 truncate font-semibold"
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
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
        {value.tenant?.name ?? 'No school selected'}
      </span>
    );

  const brandMark = (
    <span className="grid size-8 shrink-0 place-items-center rounded-[6px] bg-brand-600 text-sm font-bold text-white">
      {(value.tenant?.name ?? 'S').slice(0, 1).toUpperCase()}
    </span>
  );

  return (
    <SessionContext.Provider value={value}>
      <div className="flex min-h-dvh bg-[var(--color-canvas)]">
        {/* Navigation: 240px, or a 56px rail when collapsed (desktop). */}
        <div className="hidden shrink-0 border-r border-slate-200 bg-slate-50 lg:block">
          <aside
            className={`sticky top-0 flex h-dvh flex-col transition-[width] duration-150 ${
              collapsed ? 'w-14' : 'w-60'
            }`}
          >
            <div
              className={`flex h-12 items-center gap-2 ${collapsed ? 'justify-center' : 'px-3'}`}
            >
              {brandMark}
              {!collapsed && schoolPicker()}
            </div>
            {navList(collapsed)}
            <button
              type="button"
              onClick={toggleCollapsed}
              className={`m-2 flex h-9 items-center gap-2.5 rounded-[4px] px-2 text-sm text-slate-600 hover:bg-slate-200/60 ${
                collapsed ? 'justify-center' : ''
              }`}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              title={collapsed ? 'Expand navigation' : undefined}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden className="size-5" strokeWidth={1.75} />
              ) : (
                <PanelLeftClose aria-hidden className="size-5" strokeWidth={1.75} />
              )}
              {!collapsed && 'Collapse'}
            </button>
          </aside>
        </div>

        {/* Phones and tablets: navigation as an overlay drawer. */}
        {navOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              aria-hidden
              onClick={() => setNavOpen(false)}
            />
            <aside className="animate-slide-in-left relative flex h-full w-72 max-w-[85vw] flex-col bg-slate-50 shadow-xl">
              <div className="flex h-12 items-center gap-2 border-b border-slate-200 px-3">
                {brandMark}
                {schoolPicker()}
                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={() => setNavOpen(false)}
                  className="grid size-8 place-items-center rounded-[4px] text-slate-600 hover:bg-slate-200/60"
                >
                  <X aria-hidden className="size-5" />
                </button>
              </div>
              {navList(false)}
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
            <div className="flex h-12 items-center gap-2 px-3 sm:px-5">
              <button
                type="button"
                className="grid size-9 place-items-center rounded-[4px] text-slate-700 hover:bg-slate-100 lg:hidden"
                aria-label="Open navigation"
                aria-expanded={navOpen}
                onClick={() => setNavOpen(true)}
              >
                <Menu aria-hidden className="size-5" />
              </button>
              <span className="min-w-0 truncate text-base font-semibold text-slate-900">
                <span className="lg:hidden">
                  {current?.label ?? value.tenant?.name ?? 'School'}
                </span>
                <span className="hidden lg:inline">{current?.label ?? ''}</span>
              </span>

              {findStudent && (
                <form
                  role="search"
                  className="mx-auto hidden w-full max-w-md md:block"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const q = new FormData(e.currentTarget).get('q')?.toString().trim();
                    if (q) router.push(`/students?q=${encodeURIComponent(q)}`);
                  }}
                >
                  <label className="relative block">
                    <span className="sr-only">Find a student</span>
                    <Search
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-500"
                    />
                    <input
                      name="q"
                      type="search"
                      placeholder="Find a student by name, admission no. or parent's mobile"
                      className="h-8 w-full rounded-[4px] border border-transparent bg-slate-100 pr-3 pl-8 text-sm outline-none placeholder:text-slate-500 hover:bg-slate-200/60 focus:border-slate-300 focus:bg-white"
                    />
                  </label>
                </form>
              )}

              <div className="relative ml-auto">
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-expanded={menuOpen}
                  aria-label="Account"
                  className="flex h-9 items-center gap-2 rounded-[4px] px-1.5 text-sm text-slate-800 hover:bg-slate-100"
                >
                  <span className="grid size-7 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                    {value.me.user.fullName
                      .split(' ')
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase())
                      .join('')}
                  </span>
                  <span className="hidden max-w-40 truncate sm:inline">
                    {value.me.user.fullName}
                  </span>
                  <ChevronDown aria-hidden className="hidden size-4 text-slate-500 sm:block" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                    <div className="px-2 py-2">
                      <p className="truncate text-sm font-semibold">{value.me.user.fullName}</p>
                      <p className="truncate text-xs text-slate-600">
                        {value.me.user.email ?? value.me.user.loginPhone}
                      </p>
                    </div>
                    <div className="my-1 h-px bg-slate-200" />
                    {can('family.portal') && (
                      <Link
                        href="/parent"
                        className="flex h-8 items-center gap-2 rounded-[4px] px-2 text-sm hover:bg-slate-100"
                        onClick={() => setMenuOpen(false)}
                      >
                        <Heart aria-hidden className="size-4 text-slate-600" /> My children
                      </Link>
                    )}
                    <Link
                      href="/account/security"
                      className="flex h-8 items-center gap-2 rounded-[4px] px-2 text-sm hover:bg-slate-100"
                      onClick={() => setMenuOpen(false)}
                    >
                      <ShieldCheck aria-hidden className="size-4 text-slate-600" /> Password &amp;
                      security
                    </Link>
                    <button
                      type="button"
                      className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-sm hover:bg-slate-100"
                      onClick={logout}
                    >
                      <LogOut aria-hidden className="size-4 text-slate-600" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>

            {current && current.pages.length > 1 && (
              <div
                className="flex items-center gap-1 overflow-x-auto px-3 sm:px-5"
                role="navigation"
                aria-label={current.label}
              >
                {daily.map((p) => {
                  const active = here?.page.href === p.href;
                  return (
                    <Link
                      key={p.href}
                      href={p.href}
                      aria-current={active ? 'page' : undefined}
                      className={`relative shrink-0 px-2.5 py-2.5 text-sm whitespace-nowrap ${
                        active
                          ? 'font-semibold text-slate-900'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {p.label}
                      {active && (
                        <span
                          aria-hidden
                          className="absolute inset-x-2.5 bottom-0 h-[3px] rounded-full bg-brand-600"
                        />
                      )}
                    </Link>
                  );
                })}
                {setup.length > 0 && (
                  <div className="relative ml-auto shrink-0">
                    <button
                      type="button"
                      onClick={() => setSetupOpen((o) => !o)}
                      aria-expanded={setupOpen}
                      className={`relative flex items-center gap-1 px-2.5 py-2.5 text-sm whitespace-nowrap ${
                        setup.some((p) => p.href === here?.page.href)
                          ? 'font-semibold text-slate-900'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Settings2 aria-hidden className="size-4" /> Setup
                      <ChevronDown aria-hidden className="size-3.5" />
                      {setup.some((p) => p.href === here?.page.href) && (
                        <span
                          aria-hidden
                          className="absolute inset-x-2.5 bottom-0 h-[3px] rounded-full bg-brand-600"
                        />
                      )}
                    </button>
                    {setupOpen && (
                      <div className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                        {setup.map((p) => (
                          <Link
                            key={p.href}
                            href={p.href}
                            onClick={() => setSetupOpen(false)}
                            className="flex h-8 items-center rounded-[4px] px-2 text-sm hover:bg-slate-100"
                          >
                            {p.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-5 sm:px-6 sm:py-6">
            {children}
          </main>
        </div>
      </div>
    </SessionContext.Provider>
  );
}
