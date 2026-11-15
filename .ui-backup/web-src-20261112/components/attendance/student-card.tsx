'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { StudentAttendanceSummary } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { percentTone } from './status';
import { Badge, Card, SelectField, Skeleton } from '@/components/ui';

const monthName = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });

/** Attendance for the student's chosen year; hidden for people without attendance rights. */
export function AttendanceCard({ studentId }: { studentId: string }) {
  const { can } = useSession();
  const allowed = ['attendance.view', 'attendance.mark', 'attendance.correct'].some((p) => can(p));
  const [year, setYear] = useState('');
  const data = useApi<StudentAttendanceSummary>(
    allowed ? `/attendance/students/${studentId}${year ? `?academicYearId=${year}` : ''}` : null,
  );
  if (!allowed || data.error?.status === 404) return null;
  const d = data.data;
  return (
    <Card
      title="Attendance"
      actions={
        d && d.years.length > 1 ? (
          <SelectField
            label="Year"
            value={year || d.enrollment.academicYearId}
            onChange={(e) => setYear(e.target.value)}
            className="w-32"
          >
            {d.years.map((y) => (
              <option key={y.academicYearId} value={y.academicYearId}>
                {y.yearName}
              </option>
            ))}
          </SelectField>
        ) : null
      }
    >
      {!d ? (
        <Skeleton rows={2} />
      ) : !d.totals.days ? (
        <p className="text-sm text-slate-500">No registers taken yet in {d.enrollment.yearName}.</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex items-baseline gap-3">
            <span
              className={`text-3xl font-semibold ${percentTone(d.totals.percent, d.settings.lowThreshold)}`}
            >
              {d.totals.percent ?? '—'}%
            </span>
            {d.low && <Badge tone="red">Below {d.settings.lowThreshold}%</Badge>}
          </div>
          <p className="text-slate-600">
            {d.totals.days} day{d.totals.days === 1 ? '' : 's'} · {d.totals.absent} absent ·{' '}
            {d.totals.late} late · {d.totals.halfDays} half · {d.totals.leave} leave
          </p>
          <div className="flex flex-wrap gap-1.5">
            {d.months.map((m) => (
              <span
                key={m.month}
                className="rounded-md bg-slate-50 px-2 py-1 text-xs"
                title={`${m.days} days, ${m.absent} absent`}
              >
                {monthName(m.month)}{' '}
                <span className={percentTone(m.percent, d.settings.lowThreshold)}>
                  {m.percent ?? '—'}%
                </span>
              </span>
            ))}
          </div>
          {d.recentAbsences.length > 0 && (
            <p className="text-slate-600">
              Recent absences:{' '}
              {d.recentAbsences
                .slice(0, 5)
                .map((a) => formatDate(a.date))
                .join(', ')}
            </p>
          )}
          {d.leaves.length > 0 && (
            <p className="text-slate-600">
              Leave:{' '}
              {d.leaves.filter((l) => l.status === 'approved').reduce((n, l) => n + l.days, 0)} days
              approved
              {d.leaves.some((l) => l.status === 'pending') && ' · some pending'}
            </p>
          )}
          <Link
            className="text-brand-700 hover:underline"
            href={`/attendance/register?sectionId=${d.enrollment.sectionId}`}
          >
            Monthly register for {d.enrollment.className} – {d.enrollment.sectionName}
          </Link>
        </div>
      )}
    </Card>
  );
}
