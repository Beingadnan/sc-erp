'use client';

import Link from 'next/link';
import { post } from '@/lib/api';
import { useAction } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Card, PageHeader } from '@/components/ui';

export default function DashboardPage() {
  const { me, tenant, can } = useSession();
  const resend = useAction();

  const steps = [
    { done: me.user.emailVerified, label: 'Confirm your email address', href: null },
    { done: me.user.mfaEnabled, label: 'Turn on two-step verification', href: '/account/security' },
    {
      done: false,
      label: 'Review your campuses',
      href: '/settings/campuses',
      show: can('settings.manage'),
    },
    {
      done: false,
      label: 'Invite your staff',
      href: '/settings/members',
      show: can('members.manage'),
    },
  ].filter((s) => s.show !== false);

  return (
    <>
      <PageHeader
        title={`Welcome, ${me.user.fullName.split(' ')[0]}`}
        description={
          tenant ? `${tenant.name} · ${tenant.slug}` : 'You are not part of a school yet.'
        }
      />
      {!me.user.emailVerified && (
        <div className="mb-6">
          <Alert tone="warning">
            Please confirm your email address — we sent you a link.{' '}
            <button
              className="font-medium underline"
              onClick={() => void resend.run(() => post('/auth/email/resend'))}
              disabled={resend.pending}
            >
              Send it again
            </button>
          </Alert>
        </div>
      )}
      {me.mfaEnforced && !me.user.mfaEnabled && (
        <div className="mb-6">
          <Alert tone="info">
            Two-step verification is required before you can change settings, roles or staff access.
          </Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Get started" className="lg:col-span-2">
          <ol className="flex flex-col divide-y divide-slate-100">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-4 py-3">
                <span className={s.done ? 'text-slate-400 line-through' : ''}>{s.label}</span>
                {s.done ? (
                  <Badge tone="green">Done</Badge>
                ) : s.href ? (
                  <Link
                    href={s.href}
                    className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium hover:bg-slate-50"
                  >
                    Open
                  </Link>
                ) : (
                  <Badge tone="amber">Pending</Badge>
                )}
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Coming next">
          <p className="text-sm text-slate-600">
            Admissions, students, attendance and fees will appear here as each module is released.
          </p>
        </Card>
      </div>
    </>
  );
}
