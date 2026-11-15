'use client';

import Link from 'next/link';
import { useState } from 'react';
import { post } from '@/lib/api';
import type { FeedNotice } from '@/lib/api';
import { NoticeList } from '@/components/classroom/today';
import type { FamilyChild } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useApi } from '@/lib/use-api';
import { inr } from '@/components/fees/money';
import { Alert, Badge, Skeleton } from '@/components/ui';
import { Award, BookOpen, CalendarCheck, ChevronRight, IndianRupee, Megaphone } from 'lucide-react';
import { ATTENDANCE_LABEL, ATTENDANCE_TONE } from '@/components/family/labels';

export default function FamilyHome() {
  const { me } = useSession();
  const home = useApi<{ school: string; children: FamilyChild[] }>('/family');
  const notices = useApi<{ items: FeedNotice[] }>('/family/notices');
  const [open, setOpen] = useState<string | null>(null);

  const kids = home.data?.children ?? [];
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl leading-8 font-semibold">
          Namaste, {me.user.fullName.split(' ')[0]}
        </h1>
        <p className="text-sm text-slate-600">{home.data?.school}</p>
      </div>
      {home.error && <Alert>{home.error.message}</Alert>}

      {!home.data ? (
        <Skeleton rows={4} />
      ) : !kids.length ? (
        <Alert tone="info">
          No children are linked to your account at this school. Please contact the school office.
        </Alert>
      ) : (
        kids.map((c) => {
          const base = `/parent/child/${c.id}`;
          return (
            <section
              key={c.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
              <Link href={base} className="flex items-center gap-3 p-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-50 text-base font-semibold text-brand-700">
                  {(c.firstName[0] ?? '') + (c.lastName?.[0] ?? '')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg leading-6 font-semibold">
                    {c.firstName} {c.lastName}
                  </span>
                  <span className="block text-sm text-slate-600">
                    {c.className ? `${c.className} ${c.sectionName ?? ''}` : 'Not in a class'} ·
                    Adm. {c.admissionNumber}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-5 text-slate-500" />
              </Link>
              <div className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200">
                <div className="bg-white px-4 py-3">
                  <div className="text-xs text-slate-600">Today</div>
                  {c.todayAttendance ? (
                    <Badge dot tone={ATTENDANCE_TONE[c.todayAttendance] ?? 'neutral'}>
                      {ATTENDANCE_LABEL[c.todayAttendance] ?? c.todayAttendance}
                    </Badge>
                  ) : (
                    <span className="text-sm text-slate-700">Not marked yet</span>
                  )}
                </div>
                <Link href={`${base}?tab=fees`} className="bg-white px-4 py-3">
                  <div className="text-xs text-slate-600">Fees due now</div>
                  <div
                    className={`text-lg leading-6 font-semibold tabular-nums ${c.due > 0 ? 'text-[#b10e1c]' : 'text-[#0e700e]'}`}
                  >
                    {c.due > 0 ? inr(c.due) : 'Nothing due'}
                  </div>
                </Link>
              </div>
              <nav
                aria-label={`${c.firstName}'s pages`}
                className="grid grid-cols-4 border-t border-slate-200"
              >
                {(
                  [
                    ['homework', 'Homework', BookOpen],
                    ['attendance', 'Attendance', CalendarCheck],
                    ['results', 'Results', Award],
                    ['fees', 'Fees', IndianRupee],
                  ] as const
                ).map(([tab, label, Icon]) => (
                  <Link
                    key={tab}
                    href={`${base}?tab=${tab}`}
                    className="flex flex-col items-center gap-1 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Icon aria-hidden className="size-5 text-brand-600" />
                    {label}
                  </Link>
                ))}
              </nav>
            </section>
          );
        })
      )}

      {!!notices.data?.items.length && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <h2 className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-base font-semibold">
            <Megaphone aria-hidden className="size-4 text-slate-600" /> From the school
          </h2>
          <NoticeList
            items={notices.data.items}
            open={open}
            onOpen={(id) => {
              setOpen(open === id ? null : id);
              void post(`/notices/${id}/read`, {}).catch(() => undefined);
            }}
          />
        </section>
      )}
    </div>
  );
}
