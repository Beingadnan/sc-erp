'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { put } from '@/lib/api';
import type { SectionResults } from '@/lib/api';
import { useAction, useApi } from '@/lib/use-api';
import { EXAM_STATUS, MARK_SHORT, fmtMarks } from '@/components/exams/labels';
import { Alert, Badge, Button, Card, PageHeader, Skeleton } from '@/components/ui';

export default function SectionResultsPage({
  params,
}: {
  params: Promise<{ id: string; sectionId: string }>;
}) {
  const { id, sectionId } = use(params);
  const res = useApi<SectionResults>(`/exams/${id}/sections/${sectionId}/results`);
  const act = useAction();
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [changed, setChanged] = useState(false);
  const d = res.data;

  useEffect(() => {
    if (d) {
      setRemarks(Object.fromEntries(d.results.map((r) => [r.enrollmentId, r.remark])));
      setChanged(false);
    }
  }, [d]);

  if (res.error) return <Alert>{res.error.message}</Alert>;
  if (!d) return <Skeleton rows={10} />;

  const saveRemarks = async () => {
    const ok = await act.run(() =>
      put(`/exams/${id}/sections/${sectionId}/remarks`, {
        remarks: d.results.map((r) => ({
          enrollmentId: r.enrollmentId,
          remark: remarks[r.enrollmentId] ?? '',
        })),
      }),
    );
    if (ok) setChanged(false);
  };
  const s = d.summary;

  return (
    <>
      <PageHeader
        title={`${d.section.className} ${d.section.name} · ${d.exam.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={EXAM_STATUS[d.exam.status].tone}>{EXAM_STATUS[d.exam.status].label}</Badge>
            <span>
              {s.complete} of {s.students} complete · {s.passed} passed in all subjects
              {s.average !== null ? ` · class average ${s.average}%` : ''}
            </span>
          </span>
        }
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            <Link
              href={`/exams/${id}`}
              className="self-center text-sm text-brand-700 hover:underline"
            >
              ← Exam
            </Link>
          </div>
        }
      />
      {act.error && (
        <div className="mb-4">
          <Alert>{act.error.message}</Alert>
        </div>
      )}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="p-2">Roll</th>
                <th className="p-2">Student</th>
                {d.papers.map((p) => (
                  <th key={p.id} className="p-2 text-right">
                    {p.subjectName}
                    <span className="block font-normal">/{p.maxMarks}</span>
                  </th>
                ))}
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">%</th>
                <th className="p-2">Grade</th>
                <th className="p-2">Rank</th>
                <th className="p-2 print:hidden">Report card</th>
              </tr>
            </thead>
            <tbody>
              {d.results.map((r) => (
                <tr key={r.enrollmentId} className="border-b border-slate-100 align-top">
                  <td className="p-2 text-slate-500 tabular-nums">{r.rollNumber ?? '–'}</td>
                  <td className="p-2">
                    <span className="font-medium">{r.name}</span>
                    {r.failedIn.length > 0 && (
                      <span className="block text-xs text-red-600">
                        Below pass: {r.failedIn.join(', ')}
                      </span>
                    )}
                    {!r.complete && (
                      <span className="block text-xs text-amber-700">Marks missing</span>
                    )}
                    {d.canRemark ? (
                      <input
                        aria-label={`Remark for ${r.name}`}
                        value={remarks[r.enrollmentId] ?? ''}
                        maxLength={400}
                        placeholder="Class teacher's remark"
                        onChange={(e) => {
                          setRemarks((m) => ({ ...m, [r.enrollmentId]: e.target.value }));
                          setChanged(true);
                        }}
                        className="mt-1 h-8 w-full min-w-56 rounded border border-slate-200 px-2 text-xs print:border-0"
                      />
                    ) : (
                      r.remark && (
                        <span className="block text-xs italic text-slate-600">{r.remark}</span>
                      )
                    )}
                  </td>
                  {r.subjects.map((x, i) => (
                    <td
                      key={i}
                      className={`p-2 text-right tabular-nums ${x.passed === false ? 'font-semibold text-red-600' : ''}`}
                    >
                      {x.status === null
                        ? '—'
                        : x.status === 'present'
                          ? fmtMarks(x.marks)
                          : MARK_SHORT[x.status]}
                      {x.grade && (
                        <span className="block text-xs font-normal text-slate-500">{x.grade}</span>
                      )}
                    </td>
                  ))}
                  <td className="p-2 text-right font-medium tabular-nums">
                    {fmtMarks(r.total)}
                    <span className="block text-xs font-normal text-slate-500">/{r.maxTotal}</span>
                  </td>
                  <td className="p-2 text-right tabular-nums">{r.percent?.toFixed(2) ?? '—'}</td>
                  <td className="p-2 font-medium">{r.grade ?? '—'}</td>
                  <td className="p-2 tabular-nums">{r.rank ?? '—'}</td>
                  <td className="p-2 print:hidden">
                    <a
                      href={`/api/v1/exams/${id}/students/${r.studentId}/report-card.pdf`}
                      target="_blank"
                      rel="noopener"
                      className="text-brand-700 hover:underline"
                    >
                      PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.canRemark && (
          <div className="mt-4 flex items-center gap-3 print:hidden">
            <Button onClick={saveRemarks} loading={act.pending} disabled={!changed}>
              Save remarks
            </Button>
            <span className="text-xs text-slate-500">Remarks print on each report card.</span>
          </div>
        )}
      </Card>
    </>
  );
}
