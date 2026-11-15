'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useState } from 'react';
import type { AttendanceMonth } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { SectionPicker } from '@/components/students/section-picker';
import type { SectionChoice } from '@/components/students/section-picker';
import {
  STATUS_META,
  dayReasonLabel,
  localToday,
  percentTone,
} from '@/components/attendance/status';
import { Alert, Card, Field, PageHeader, SelectField, Skeleton } from '@/components/ui';

export default function MonthlyRegisterPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <MonthlyRegister />
    </Suspense>
  );
}

function MonthlyRegister() {
  const params = useSearchParams();
  const router = useRouter();
  const { campus, picker } = useCampus();
  const [choice, setChoice] = useState<SectionChoice>({
    academicYearId: null,
    gradeLevelId: null,
    sectionId: null,
  });
  const onChoice = useCallback((v: SectionChoice) => setChoice(v), []);
  const sectionId = params.get('sectionId') ?? choice.sectionId;
  const month = params.get('month') ?? localToday().slice(0, 7);
  const period = params.get('period');
  const go = (next: { sectionId?: string; month?: string; period?: string }) => {
    const q = new URLSearchParams();
    const s = next.sectionId ?? sectionId;
    if (s) q.set('sectionId', s);
    q.set('month', next.month ?? month);
    const p = next.period ?? period;
    if (p) q.set('period', p);
    router.replace(`/attendance/register?${q}`);
  };

  const data = useApi<AttendanceMonth>(
    sectionId
      ? `/attendance/sections/${sectionId}/month?month=${month}${period ? `&period=${period}` : ''}`
      : null,
  );
  const m = data.data;

  return (
    <>
      <PageHeader
        title="Monthly register"
        description="Day-by-day attendance of a section, with each student's percentage for the month."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <Field
              label="Month"
              type="month"
              value={month}
              onChange={(e) => e.target.value && go({ month: e.target.value })}
              className="w-44"
            />
            {m?.settings.mode === 'period' && (
              <SelectField
                label="Period"
                value={String(m.period)}
                onChange={(e) => go({ period: e.target.value })}
                className="w-32"
              >
                {Array.from({ length: m.settings.periodsPerDay }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    Period {i + 1}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
        }
      />
      <Card className="mb-6">
        <div className="flex flex-col gap-4">
          {picker}
          {campus && (
            <SectionPicker
              campusId={campus.id}
              value={choice}
              onChange={(v) => {
                onChoice(v);
                if (v.sectionId) go({ sectionId: v.sectionId });
              }}
            />
          )}
        </div>
      </Card>
      {data.error && <Alert>{data.error.message}</Alert>}
      {sectionId && !m && !data.error && <Skeleton rows={8} />}
      {m && (
        <Card
          title={`${m.section.className} – ${m.section.name}`}
          description={`${m.markedDates.length} register${m.markedDates.length === 1 ? '' : 's'} taken this month`}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-medium"
                  >
                    Student
                  </th>
                  {m.days.map((d) => (
                    <th
                      key={d.date}
                      scope="col"
                      title={dayReasonLabel(d)}
                      className={`w-7 px-0.5 py-1 text-center font-medium ${d.working ? '' : 'bg-slate-50 text-slate-300'}`}
                    >
                      {m.markedDates.includes(d.date) ? (
                        <Link
                          className="hover:underline"
                          href={`/attendance/mark?sectionId=${m.section.id}&date=${d.date}${m.period ? `&period=${m.period}` : ''}`}
                        >
                          {Number(d.date.slice(8))}
                        </Link>
                      ) : (
                        Number(d.date.slice(8))
                      )}
                    </th>
                  ))}
                  <th scope="col" className="px-2 text-right font-medium">
                    A
                  </th>
                  <th scope="col" className="px-2 text-right font-medium">
                    %
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {m.students.map((s) => (
                  <tr key={s.enrollmentId}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 whitespace-nowrap bg-white px-2 py-1.5 text-left font-normal"
                    >
                      <span className="mr-1 text-slate-400">{s.rollNumber ?? ''}</span>
                      <Link className="hover:underline" href={`/students/${s.studentId}`}>
                        {s.name}
                      </Link>
                    </th>
                    {m.days.map((d) => {
                      const st = s.days[d.date];
                      return (
                        <td
                          key={d.date}
                          className={`px-0.5 py-1.5 text-center ${d.working ? '' : 'bg-slate-50'} ${st ? STATUS_META[st].cell : 'text-slate-200'}`}
                          title={st ? STATUS_META[st].label : undefined}
                        >
                          {st ? STATUS_META[st].short : d.working ? '·' : ''}
                        </td>
                      );
                    })}
                    <td className="px-2 text-right tabular-nums">{s.absent}</td>
                    <td
                      className={`px-2 text-right tabular-nums ${percentTone(s.percent, m.settings.lowThreshold)}`}
                    >
                      {s.percent === null ? '—' : `${s.percent}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            P present · A absent · L late · ½ half day (counts 0.5) · Lv leave (
            {m.settings.leaveCountsAs === 'excluded' ? 'not counted' : 'counts as absent'}). Grey
            columns are holidays and offs; click a date to open that register.
          </p>
        </Card>
      )}
    </>
  );
}
