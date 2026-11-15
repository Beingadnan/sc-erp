'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { post } from '@/lib/api';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import { inr } from '@/components/fees/money';
import { Alert, buttonStyles } from '@/components/ui';
import type { LucideIcon } from 'lucide-react';
import {
  BadgeIndianRupee,
  CalendarCheck,
  CalendarOff,
  ClipboardList,
  FileSpreadsheet,
  IndianRupee,
  Megaphone,
  Receipt,
  Search,
  UserMinus,
  UserPlus,
  UserRoundX,
  Users,
  Wallet,
} from 'lucide-react';
import type { MyClass } from '@/lib/api';
import { MyClassesList } from '@/components/teaching/my-classes';
import { MarksToDo, MyPeriodsToday, StaffNotices } from '@/components/classroom/today';

interface TodayAttendance {
  date: string;
  day: { working: boolean; reason: string; title?: string } | null;
  totals: {
    sections: number;
    marked: number;
    students: number;
    present: number;
    absent: number;
    late: number;
    leave: number;
  };
  sections: Array<{
    sectionId: string;
    className: string;
    sectionName: string;
    students: number;
    isMine: boolean;
    marked: boolean;
    counts: { present: number; absent: number } | null;
  }>;
}

const ATT = ['attendance.view', 'attendance.mark', 'attendance.correct'];
const FEES = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'];

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** A shortcut: icon, label and a one-line hint. The first one for a role is the primary task. */
function Action({
  href,
  label,
  hint,
  icon: Icon,
  primary,
}: {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-xl border p-3.5 transition-colors ${
        primary
          ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-lg ${
          primary ? 'bg-white/15 text-white' : 'bg-brand-50 text-brand-600'
        }`}
      >
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        <span className={`block truncate text-xs ${primary ? 'text-white/85' : 'text-slate-600'}`}>
          {hint}
        </span>
      </span>
    </Link>
  );
}

/** A number the person should know today. */
function Stat({
  label,
  value,
  sub,
  href,
  tone,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href: string;
  tone?: 'good' | 'warn' | 'bad';
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <span className="flex items-center gap-2 text-sm text-slate-600">
        <Icon aria-hidden className="size-4" />
        {label}
      </span>
      <span
        className={`text-[28px] leading-9 font-semibold tabular-nums ${
          tone === 'bad'
            ? 'text-[#b10e1c]'
            : tone === 'warn'
              ? 'text-[#bc4b09]'
              : tone === 'good'
                ? 'text-[#0e700e]'
                : 'text-slate-900'
        }`}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-slate-600">{sub}</span>}
    </Link>
  );
}

/** One thing waiting for this person, with the button that deals with it. */
function Todo({
  icon: Icon,
  title,
  detail,
  href,
  action,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string;
  href: string;
  action: string;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#fff9f5] text-[#bc4b09]">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        {detail && <span className="block truncate text-xs text-slate-600">{detail}</span>}
      </span>
      <Link href={href} className={buttonStyles('secondary', 'sm')}>
        {action}
      </Link>
    </li>
  );
}

export default function TodayPage() {
  const { me, tenant, can } = useSession();
  const { campus } = useCampus();
  const resend = useAction();
  const c = campus?.id;
  const anyOf = (ps: string[]) => ps.some((p) => can(p, c));
  const d = today();

  const att = useApi<TodayAttendance>(c && anyOf(ATT) ? `/attendance/today?campusId=${c}` : null);
  const proofs = useApi<{ pending: number }>(
    c && anyOf(FEES) ? `/fees/payment-proofs?campusId=${c}&status=pending` : null,
  );
  const refunds = useApi<{ items: unknown[] }>(
    c && can('fees.cancel_receipt', c) ? `/fees/refunds?campusId=${c}&status=requested` : null,
  );
  const collection = useApi<{ total: number; receipts: unknown[] }>(
    c && anyOf(['fees.view', 'fees.configure'])
      ? `/fees/reports/collection?campusId=${c}&from=${d}&to=${d}`
      : null,
  );
  const dues = useApi<{ totals: { outstanding: number; overdue: number; defaulters: number } }>(
    c && anyOf(['fees.view', 'fees.configure']) ? `/fees/reports/outstanding?campusId=${c}` : null,
  );
  const leave = useApi<{ items: unknown[] } | unknown[]>(
    c && anyOf(['attendance.mark', 'attendance.correct'])
      ? `/attendance/leave?campusId=${c}&status=pending`
      : null,
  );
  const teaching = useApi<{ sections: MyClass[] }>('/teaching/mine');
  const myDay = useApi<{ total: number }>(
    c && can('fees.collect', c) ? `/fees/day-close?campusId=${c}` : null,
  );

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLabel = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const working = att.data?.day ? att.data.day.working : true;
  const mine = att.data?.sections.filter((s) => s.isMine) ?? [];
  // Someone with no register of their own (e.g. a subject teacher) gets no attendance tiles.
  const hasRegisters = !!att.data?.sections.length;
  const toMark = working
    ? (mine.length ? mine : (att.data?.sections ?? [])).filter((s) => !s.marked)
    : [];
  const canMark = anyOf(['attendance.mark', 'attendance.correct']);
  const isTeacher = !!teaching.data?.sections.length;
  const office = anyOf(['students.manage', 'fees.view', 'fees.configure', 'academic.manage']);
  const leaveCount = Array.isArray(leave.data)
    ? leave.data.length
    : (leave.data?.items.length ?? 0);
  const totals = att.data?.totals;
  const presentPct =
    totals && totals.students && totals.marked
      ? Math.round(
          ((totals.present + totals.late) /
            Math.max(1, totals.present + totals.late + totals.absent + totals.leave)) *
            100,
        )
      : null;

  // What to show as the first (blue) shortcut for this person.
  const primary =
    canMark && hasRegisters && toMark.length
      ? 'attendance'
      : can('fees.collect', c)
        ? 'fees'
        : null;

  const todos = [
    canMark &&
      toMark.length > 0 && {
        icon: CalendarCheck,
        title: `Attendance not taken in ${toMark.length} class${toMark.length > 1 ? 'es' : ''}`,
        detail: toMark
          .slice(0, 6)
          .map((s) => `${s.className} ${s.sectionName}`)
          .join(', '),
        href:
          toMark.length === 1
            ? `/attendance/mark?sectionId=${toMark[0]!.sectionId}`
            : '/attendance/mark',
        action: 'Take attendance',
      },
    leaveCount > 0 && {
      icon: CalendarOff,
      title: `${leaveCount} leave request${leaveCount > 1 ? 's' : ''} from parents`,
      detail: 'Approve or decline',
      href: '/attendance/leave',
      action: 'Review',
    },
    (proofs.data?.pending ?? 0) > 0 && {
      icon: Receipt,
      title: `${proofs.data!.pending} online payment${proofs.data!.pending > 1 ? 's' : ''} to check`,
      detail: 'Parents uploaded payment screenshots',
      href: '/fees/proofs',
      action: 'Check',
    },
    (refunds.data?.items.length ?? 0) > 0 && {
      icon: Wallet,
      title: `${refunds.data!.items.length} refund${refunds.data!.items.length > 1 ? 's' : ''} to approve`,
      href: '/fees/refunds',
      action: 'Review',
    },
  ].filter(Boolean) as Array<Parameters<typeof Todo>[0]>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl leading-8 font-semibold">
          {greet}, {me.user.fullName.split(' ')[0]}
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          {dateLabel}
          {tenant ? ` · ${tenant.name}` : ''}
          {att.data?.day && !att.data.day.working
            ? ` · ${att.data.day.reason === 'weekend' ? 'Weekly off' : 'Holiday'}${att.data.day.title ? `: ${att.data.day.title}` : ''}`
            : ''}
        </p>
      </div>

      {!me.user.emailVerified && me.user.email && (
        <Alert tone="warning">
          Please confirm your email address — we sent you a link.{' '}
          <button
            className="font-semibold underline"
            onClick={() => void resend.run(() => post('/auth/email/resend'))}
            disabled={resend.pending}
          >
            Send it again
          </button>
        </Alert>
      )}
      {me.mfaEnforced && !me.user.mfaEnabled && (
        <Alert tone="info">
          Turn on two-step verification in{' '}
          <Link className="font-semibold underline" href="/account/security">
            Password &amp; security
          </Link>{' '}
          before changing settings or staff access.
        </Alert>
      )}

      {/* School at a glance (office roles). */}
      {office && (totals || collection.data || dues.data) && (
        <section aria-label="Today at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {totals && hasRegisters && (
            <Stat
              icon={CalendarCheck}
              label="Attendance today"
              href="/attendance"
              value={!working ? '—' : presentPct === null ? 'Not taken' : `${presentPct}%`}
              tone={
                presentPct === null
                  ? undefined
                  : presentPct >= 90
                    ? 'good'
                    : presentPct >= 75
                      ? 'warn'
                      : 'bad'
              }
              sub={
                !working
                  ? 'No school today'
                  : `${totals.marked} of ${totals.sections} classes marked · ${totals.absent} absent`
              }
            />
          )}
          {collection.data && (
            <Stat
              icon={IndianRupee}
              label="Fees collected today"
              href="/fees/reports"
              value={inr(collection.data.total)}
              sub={`${collection.data.receipts.length} receipt${collection.data.receipts.length === 1 ? '' : 's'}`}
            />
          )}
          {dues.data && (
            <Stat
              icon={BadgeIndianRupee}
              label="Overdue fees"
              href="/fees/reports"
              value={inr(dues.data.totals.overdue)}
              tone={dues.data.totals.overdue ? 'bad' : 'good'}
              sub={`${dues.data.totals.defaulters} student${dues.data.totals.defaulters === 1 ? '' : 's'} behind · ${inr(dues.data.totals.outstanding)} still to come`}
            />
          )}
          {totals && hasRegisters && (
            <Stat
              icon={UserRoundX}
              label="Absent students"
              href="/attendance"
              value={working ? totals.absent : '—'}
              tone={totals.absent ? 'warn' : undefined}
              sub={working ? `${totals.leave} on leave · ${totals.late} late` : 'No school today'}
            />
          )}
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {todos.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white">
              <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold">
                Needs attention
              </h2>
              <ul className="divide-y divide-slate-200">
                {todos.map((t) => (
                  <Todo key={t.title} {...t} />
                ))}
              </ul>
            </section>
          )}

          <MarksToDo />
          <MyPeriodsToday />

          {isTeacher && (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">My classes</h2>
              <MyClassesList items={teaching.data!.sections} />
            </section>
          )}

          {!todos.length && !isTeacher && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <span className="grid size-8 place-items-center rounded-full bg-[#f1faf1] text-[#0e700e]">
                <CalendarCheck aria-hidden className="size-4" />
              </span>
              Nothing waiting for you right now.
            </div>
          )}

          <StaffNotices />
        </div>

        <aside className="flex flex-col gap-3" aria-label="Shortcuts">
          <h2 className="text-base font-semibold">Shortcuts</h2>
          {canMark && hasRegisters && (
            <Action
              href="/attendance/mark"
              icon={CalendarCheck}
              label="Take attendance"
              hint={
                !working
                  ? 'No school today'
                  : toMark.length
                    ? `${toMark.length} class${toMark.length > 1 ? 'es' : ''} left today`
                    : 'All done today'
              }
              primary={primary === 'attendance'}
            />
          )}
          {can('fees.collect', c) && (
            <Action
              href="/fees/collect"
              icon={IndianRupee}
              label="Fee counter"
              hint={
                myDay.data
                  ? `You collected ${inr(myDay.data.total)} today`
                  : 'Collect fees, print receipt'
              }
              primary={primary === 'fees'}
            />
          )}
          {can('fees.collect', c) && (
            <Action
              href="/fees/day-close"
              icon={Wallet}
              label="Close the day"
              hint="Count cash and hand over"
            />
          )}
          {anyOf(['fees.view', 'fees.configure']) && (
            <Action
              href="/fees/reports"
              icon={BadgeIndianRupee}
              label="Dues & reports"
              hint="Who has not paid, collection by day"
            />
          )}
          {anyOf(['students.view', 'students.view_assigned']) && (
            <Action
              href="/students"
              icon={Search}
              label="Find a student"
              hint="Name, admission no. or phone"
            />
          )}
          {can('students.manage', c) && (
            <Action
              href="/students/new"
              icon={UserPlus}
              label="Admit a student"
              hint="New admission"
            />
          )}
          {can('admissions.manage', c) && (
            <Action
              href="/admissions/inquiries"
              icon={Users}
              label="New inquiry"
              hint="Walk-in or phone call"
            />
          )}
          {can('timetable.manage', c) && (
            <Action
              href="/academics/substitutions"
              icon={UserMinus}
              label="Teacher absent?"
              hint="Arrange substitutes"
            />
          )}
          {can('notices.manage', c) && (
            <Action
              href="/notices"
              icon={Megaphone}
              label="Send a notice"
              hint="Circular to parents or staff"
            />
          )}
          {anyOf(['exams.manage']) && (
            <Action
              href="/exams"
              icon={ClipboardList}
              label="Exams"
              hint="Date sheet, marks, results"
            />
          )}
          {can('academic.manage', c) && (
            <Action
              href="/settings/import"
              icon={FileSpreadsheet}
              label="Import old data"
              hint="Classes, staff, balances from Excel"
            />
          )}
        </aside>
      </div>
    </div>
  );
}
