'use client';

import Link from 'next/link';
import { useState } from 'react';
import { post } from '@/lib/api';
import type { FeedNotice, MarksToEnter, MyDay } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

const nowHHMM = () =>
  new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

/** A teacher's day: their periods (and covers) in order, with the current one highlighted. */
export function MyPeriodsToday() {
  const day = useApi<MyDay>('/timetable/mine');
  const periods = day.data?.periods ?? [];
  if (!periods.length) return null;
  const now = nowHHMM();
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold">
        My periods today
      </h2>
      <ul className="divide-y divide-slate-200">
        {periods.map((p) => {
          const live = p.startsAt <= now && now < p.endsAt;
          const done = p.endsAt <= now;
          return (
            <li
              key={`${p.entryId}:${p.isCover}`}
              className={`flex items-center gap-4 px-4 py-2.5 text-sm ${live ? 'bg-brand-50' : ''} ${done ? 'text-slate-500' : ''}`}
            >
              <span className="w-24 shrink-0 tabular-nums">
                {p.startsAt}–{p.endsAt}
              </span>
              <span className="min-w-0 flex-1">
                <Link href={`/my-classes/${p.sectionId}`} className="font-medium hover:underline">
                  {p.className} {p.sectionName}
                </Link>{' '}
                · {p.subjectName}
                {p.isCover && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                    Cover for {p.absentTeacher ?? 'a teacher'}
                  </span>
                )}
                {p.coveredBy && (
                  <span className="ml-2 text-xs text-slate-500">({p.coveredBy} is covering)</span>
                )}
              </span>
              {live && <span className="text-xs font-medium text-brand-700">Now</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Notices from the office for staff. */
export function StaffNotices() {
  const feed = useApi<{ items: FeedNotice[] }>('/notices/feed');
  const [open, setOpen] = useState<string | null>(null);
  const items = feed.data?.items ?? [];
  if (!items.length) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-4 py-3 text-base font-semibold">Notices</h2>
      <NoticeList
        items={items.slice(0, 5)}
        open={open}
        onOpen={(id) => {
          setOpen(open === id ? null : id);
          void post(`/notices/${id}/read`, {}).catch(() => undefined);
        }}
      />
    </section>
  );
}

export function NoticeList({
  items,
  open,
  onOpen,
}: {
  items: FeedNotice[];
  open: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-slate-200">
      {items.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onOpen(n.id)}
            aria-expanded={open === n.id}
            className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left text-sm"
          >
            <span className="min-w-0">
              <span className="font-medium">
                {n.pinned && <span aria-label="Pinned">📌 </span>}
                {n.title}
              </span>
              {open !== n.id && <span className="block truncate text-slate-500">{n.body}</span>}
            </span>
            <span className="shrink-0 text-xs text-slate-400">
              {formatDate(n.publishedAt.slice(0, 10))}
            </span>
          </button>
          {open === n.id && (
            <p className="whitespace-pre-line px-4 pb-3 text-sm text-slate-700">{n.body}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Subject teacher: marks still to enter or hand in for open exams. */
export function MarksToDo() {
  const mine = useApi<{ items: MarksToEnter[] }>('/exams/marks/mine');
  const todo = (mine.data?.items ?? []).filter((i) => !i.submitted);
  if (!todo.length) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-semibold">Marks to enter</h2>
        <Link href="/marks" className="text-sm text-brand-700 hover:underline">
          All →
        </Link>
      </div>
      <ul className="divide-y divide-slate-200">
        {todo.slice(0, 6).map((i) => (
          <li key={`${i.paperId}:${i.sectionId}`}>
            <Link
              href={`/marks/${i.paperId}/${i.sectionId}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-slate-50"
            >
              <span>
                <span className="font-medium">
                  {i.className} {i.sectionName} · {i.subjectName}
                </span>
                <span className="ml-2 text-xs text-slate-500">{i.examName}</span>
              </span>
              <span className="text-xs text-slate-600">
                {i.entered >= i.students && i.students
                  ? 'Ready to hand in'
                  : `${i.entered}/${i.students}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
