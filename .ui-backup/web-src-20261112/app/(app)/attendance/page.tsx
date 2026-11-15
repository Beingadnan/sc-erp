'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AttendanceToday } from '@/lib/api';
import { dateTime, formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { dayReasonLabel, shiftDate } from '@/components/attendance/status';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Skeleton,
  Table,
  Td,
} from '@/components/ui';

export default function AttendanceTodayPage() {
  const { campus, picker } = useCampus();
  const [date, setDate] = useState<string>('');
  const data = useApi<AttendanceToday>(
    campus ? `/attendance/today?campusId=${campus.id}${date ? `&date=${date}` : ''}` : null,
  );
  useEffect(() => {
    if (!date && data.data) setDate(data.data.date);
  }, [data.data, date]);

  const t = data.data;
  const mark = (sectionId: string, period?: number) =>
    `/attendance/mark?sectionId=${sectionId}&date=${t?.date ?? ''}${period ? `&period=${period}` : ''}`;

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Registers for the day across the campus. Class teachers see their own sections."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            {picker}
            <Field
              label="Date"
              type="date"
              value={date}
              max={t?.today}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>
        }
      />
      {data.error && <Alert>{data.error.message}</Alert>}
      {!t ? (
        <Skeleton rows={5} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <button
              className="rounded-md px-2 py-1 hover:bg-slate-100"
              onClick={() => setDate(shiftDate(t.date, -1))}
              aria-label="Previous day"
            >
              ←
            </button>
            <span className="font-medium text-slate-900">{formatDate(t.date)}</span>
            {t.date < t.today && (
              <button
                className="rounded-md px-2 py-1 hover:bg-slate-100"
                onClick={() => setDate(shiftDate(t.date, 1))}
                aria-label="Next day"
              >
                →
              </button>
            )}
            {t.date !== t.today && (
              <button className="text-brand-700 underline" onClick={() => setDate(t.today)}>
                Today
              </button>
            )}
            {!t.day.working && <Badge tone="amber">{dayReasonLabel(t.day)}</Badge>}
          </div>

          {t.day.working && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Registers taken" value={`${t.totals.marked} / ${t.totals.sections}`} />
              <Stat
                label="Present"
                value={t.totals.present + t.totals.late}
                hint={t.totals.late ? `${t.totals.late} late` : undefined}
              />
              <Stat label="Absent" value={t.totals.absent} tone="red" />
              <Stat label="Half day" value={t.totals.halfDay} />
              <Stat label="On leave" value={t.totals.leave} />
            </div>
          )}

          <Card title="Sections">
            {!t.sections.length ? (
              <EmptyState title="No sections to show">
                Sections of the academic year running on this date appear here. Class teachers see
                only their own.
              </EmptyState>
            ) : (
              <Table head={['Class', 'Students', 'Register', 'Present / absent', '']}>
                {t.sections.map((s) => (
                  <tr key={s.sectionId}>
                    <Td>
                      <span className="font-medium">
                        {s.className} – {s.sectionName}
                      </span>
                      {s.isMine && (
                        <span className="ml-2">
                          <Badge tone="blue">My class</Badge>
                        </span>
                      )}
                    </Td>
                    <Td>{s.students}</Td>
                    <Td>
                      {s.marked ? (
                        <span className="text-slate-600">
                          <Badge tone="green">Taken</Badge>{' '}
                          <span className="text-xs">
                            {s.markedBy ?? '—'} · {s.markedAt ? dateTime(s.markedAt) : ''}
                          </span>
                        </span>
                      ) : t.day.working ? (
                        <Badge tone="amber">Not taken</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                      {t.settings.mode === 'period' && s.periodsMarked.length > 0 && (
                        <div className="mt-1 text-xs text-slate-500">
                          Periods: {s.periodsMarked.join(', ')}
                        </div>
                      )}
                    </Td>
                    <Td>
                      {s.counts ? (
                        <span>
                          {s.counts.present + s.counts.late} /{' '}
                          <span className={s.counts.absent ? 'font-semibold text-red-700' : ''}>
                            {s.counts.absent}
                          </span>
                          {s.counts.leave ? (
                            <span className="text-slate-500"> · {s.counts.leave} leave</span>
                          ) : null}
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="text-right">
                      {t.day.working && (
                        <Link
                          className="text-sm font-medium text-brand-700 hover:underline"
                          href={mark(s.sectionId, t.settings.mode === 'period' ? 1 : undefined)}
                        >
                          {s.marked ? 'Open' : 'Take attendance'}
                        </Link>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'red';
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === 'red' && value ? 'text-red-700' : ''}`}>
        {value}
      </p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
