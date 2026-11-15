'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { LowAttendance } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { SectionPicker } from '@/components/students/section-picker';
import type { SectionChoice } from '@/components/students/section-picker';
import { Alert, Card, EmptyState, Field, PageHeader, Skeleton, Table, Td } from '@/components/ui';

export default function LowAttendancePage() {
  const { campus, picker } = useCampus();
  const [choice, setChoice] = useState<SectionChoice>({
    academicYearId: null,
    gradeLevelId: null,
    sectionId: null,
  });
  const onChoice = useCallback((v: SectionChoice) => setChoice(v), []);
  const [threshold, setThreshold] = useState('');
  const [applied, setApplied] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setApplied(threshold), 400);
    return () => clearTimeout(t);
  }, [threshold]);

  const q = new URLSearchParams();
  if (campus) q.set('campusId', campus.id);
  if (choice.academicYearId) q.set('academicYearId', choice.academicYearId);
  if (choice.sectionId) q.set('sectionId', choice.sectionId);
  if (/^\d+$/.test(applied) && Number(applied) >= 1 && Number(applied) <= 100)
    q.set('threshold', applied);
  const data = useApi<LowAttendance>(
    campus && choice.academicYearId ? `/attendance/low?${q}` : null,
  );
  const d = data.data;

  const csv = () => {
    if (!d) return;
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const rows = [
      ['Admission no.', 'Name', 'Class', 'Section', 'Roll', 'Days', 'Absent', 'Percent'],
      ...d.students.map((s) => [
        s.admissionNumber,
        s.name,
        s.className,
        s.sectionName,
        s.rollNumber,
        s.days,
        s.absent,
        s.percent,
      ]),
    ];
    const blob = new Blob(
      [String.fromCharCode(0xfeff) + rows.map((r) => r.map(esc).join(',')).join('\r\n')],
      { type: 'text/csv' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `low-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader
        title="Low attendance"
        description="Students below the attendance threshold for the year so far."
        actions={
          d && d.students.length > 0 ? (
            <button className="text-sm text-brand-700 underline" onClick={csv}>
              Download CSV
            </button>
          ) : null
        }
      />
      <Card className="mb-6">
        <div className="flex flex-col gap-4">
          {picker}
          {campus && (
            <SectionPicker campusId={campus.id} value={choice} onChange={onChoice} allowAll />
          )}
          <Field
            label="Threshold (%)"
            type="number"
            min={1}
            max={100}
            inputMode="numeric"
            value={threshold}
            placeholder={d ? String(d.threshold) : '75'}
            hint="Leave empty to use the campus setting."
            onChange={(e) => setThreshold(e.target.value)}
            className="w-48"
          />
        </div>
      </Card>
      {data.error && <Alert>{data.error.message}</Alert>}
      {data.loading && !d && <Skeleton rows={5} />}
      {d && (
        <Card
          title={`${d.students.length} student${d.students.length === 1 ? '' : 's'} below ${d.threshold}%`}
        >
          {!d.students.length ? (
            <EmptyState title="No one is below the threshold">
              Percentages count registers taken so far this year.
            </EmptyState>
          ) : (
            <Table head={['Student', 'Class', 'Days', 'Absent', 'Attendance']}>
              {d.students.map((s) => (
                <tr key={s.enrollmentId}>
                  <Td>
                    <Link className="font-medium hover:underline" href={`/students/${s.studentId}`}>
                      {s.name}
                    </Link>
                    <div className="text-xs text-slate-500">{s.admissionNumber}</div>
                  </Td>
                  <Td>
                    {s.className} – {s.sectionName}
                    {s.rollNumber ? (
                      <span className="text-slate-500"> · Roll {s.rollNumber}</span>
                    ) : null}
                  </Td>
                  <Td>{s.days}</Td>
                  <Td>{s.absent}</Td>
                  <Td className="font-semibold text-red-700">{s.percent}%</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
