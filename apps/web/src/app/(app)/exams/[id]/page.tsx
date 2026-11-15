'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { del, post, put } from '@/lib/api';
import type { ExamDetail } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { EXAM_STATUS } from '@/components/exams/labels';
import { Alert, Badge, Button, Card, PageHeader, Skeleton } from '@/components/ui';

type Tab = 'datesheet' | 'marks';

export default function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const exam = useApi<ExamDetail>(`/exams/${id}`);
  const act = useAction();
  const [tab, setTab] = useState<Tab | null>(null);
  const e = exam.data;
  const current: Tab = tab ?? (e && e.status !== 'draft' ? 'marks' : 'datesheet');

  const setStatus = async (status: 'draft' | 'open' | 'published') => {
    if (await act.run(() => post(`/exams/${id}/status`, { status }))) void exam.reload();
  };
  const remove = async () => {
    if (await act.run(() => del(`/exams/${id}`))) window.location.href = '/exams';
  };

  if (exam.error) return <Alert>{exam.error.message}</Alert>;
  if (!e) return <Skeleton rows={8} />;
  const total = e.progress.length;
  const handedIn = e.progress.filter((p) => p.submitted).length;
  const hasPapers = e.classes.some((c) => c.papers.length);

  return (
    <>
      <PageHeader
        title={e.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={EXAM_STATUS[e.status].tone}>{EXAM_STATUS[e.status].label}</Badge>
            {e.startsOn && (
              <span>
                {formatDate(e.startsOn)}
                {e.endsOn ? ` – ${formatDate(e.endsOn)}` : ''}
              </span>
            )}
            {e.status !== 'draft' && total > 0 && (
              <span>
                · Marks handed in {handedIn} of {total}
              </span>
            )}
          </span>
        }
        actions={
          e.canManage && (
            <div className="flex flex-wrap gap-2">
              {e.status === 'draft' && (
                <>
                  <Button variant="ghost" onClick={remove} disabled={act.pending}>
                    Delete
                  </Button>
                  <Button
                    onClick={() => setStatus('open')}
                    loading={act.pending}
                    disabled={!hasPapers}
                  >
                    Start marks entry
                  </Button>
                </>
              )}
              {e.status === 'open' && (
                <Button onClick={() => setStatus('published')} loading={act.pending}>
                  Publish results
                </Button>
              )}
              {e.status === 'published' && (
                <Button variant="secondary" onClick={() => setStatus('open')} loading={act.pending}>
                  Take back results
                </Button>
              )}
            </div>
          )
        }
      />
      {act.error && (
        <div className="mb-4">
          <Alert>{act.error.message}</Alert>
        </div>
      )}
      {e.status === 'open' && e.canManage && handedIn < total && (
        <div className="mb-4">
          <Alert tone="info">
            {total - handedIn} subject{total - handedIn === 1 ? '' : 's'} still to be handed in. You
            can publish anyway; students with missing marks show as incomplete.
          </Alert>
        </div>
      )}
      {e.status === 'published' && (
        <div className="mb-4">
          <Alert tone="success">
            Parents can see the results and download report cards in their app. To correct a mark,
            take the results back first.
          </Alert>
        </div>
      )}

      <div role="tablist" className="mb-4 flex gap-1 border-b border-slate-200">
        {(
          [
            ['datesheet', 'Date sheet'],
            ['marks', 'Marks & results'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={current === k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              current === k
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {current === 'datesheet' ? (
        <div className="flex flex-col gap-4">
          {e.classes.map((c) => (
            <ClassDateSheet
              key={c.id}
              examId={id}
              cls={c}
              editable={e.canManage && e.status !== 'published'}
              onSaved={() => void exam.reload()}
            />
          ))}
        </div>
      ) : (
        <MarksProgress exam={e} />
      )}
    </>
  );
}

type Cls = ExamDetail['classes'][number];
interface Line {
  subjectId: string;
  name: string;
  on: boolean;
  examDate: string;
  startsAt: string;
  maxMarks: string;
  passMarks: string;
}

function ClassDateSheet({
  examId,
  cls,
  editable,
  onSaved,
}: {
  examId: string;
  cls: Cls;
  editable: boolean;
  onSaved: () => void;
}) {
  const fresh = (): Line[] =>
    cls.subjects.map((s) => {
      const p = cls.papers.find((x) => x.subjectId === s.id);
      return {
        subjectId: s.id,
        name: s.name,
        on: !!p,
        examDate: p?.examDate ?? '',
        startsAt: p?.startsAt ?? '',
        maxMarks: String(p?.maxMarks ?? 80),
        passMarks: String(p?.passMarks ?? 27),
      };
    });
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>(fresh);
  const act = useAction();
  const set = (i: number, patch: Partial<Line>) =>
    setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    const ok = await act.run(() =>
      put(`/exams/${examId}/papers`, {
        gradeLevelId: cls.id,
        papers: lines
          .filter((l) => l.on)
          .sort((a, b) => (a.examDate || '9').localeCompare(b.examDate || '9'))
          .map((l) => ({
            subjectId: l.subjectId,
            examDate: l.examDate || null,
            startsAt: l.startsAt || null,
            maxMarks: Number(l.maxMarks),
            passMarks: Number(l.passMarks),
          })),
      }),
    );
    if (ok) {
      setOpen(false);
      onSaved();
    }
  };

  const summary = cls.papers.length
    ? `${cls.papers.length} subject${cls.papers.length === 1 ? '' : 's'}`
    : 'Not in this exam';

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{cls.name}</h3>
          <p className="text-xs text-slate-500">{summary}</p>
        </div>
        {editable && !open && (
          <Button
            variant="secondary"
            onClick={() => {
              setLines(fresh());
              setOpen(true);
            }}
          >
            {cls.papers.length ? 'Edit' : 'Add subjects'}
          </Button>
        )}
      </div>
      {act.error && (
        <div className="mt-3">
          <Alert>{act.error.message}</Alert>
        </div>
      )}
      {open ? (
        <div className="mt-3 overflow-x-auto">
          {!cls.subjects.length && (
            <Alert tone="info">This class has no subjects. Add them in Academics → Classes.</Alert>
          )}
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="p-1.5">Subject</th>
                <th className="p-1.5">Date</th>
                <th className="p-1.5">Time</th>
                <th className="p-1.5">Max marks</th>
                <th className="p-1.5">Pass marks</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.subjectId} className={l.on ? '' : 'opacity-50'}>
                  <td className="p-1.5">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={l.on}
                        onChange={(e) => set(i, { on: e.target.checked })}
                      />
                      {l.name}
                    </label>
                  </td>
                  <td className="p-1.5">
                    <input
                      type="date"
                      aria-label={`${l.name} date`}
                      disabled={!l.on}
                      value={l.examDate}
                      onChange={(e) => set(i, { examDate: e.target.value })}
                      className="h-8 rounded border border-slate-300 px-1.5"
                    />
                  </td>
                  <td className="p-1.5">
                    <input
                      type="time"
                      aria-label={`${l.name} time`}
                      disabled={!l.on}
                      value={l.startsAt}
                      onChange={(e) => set(i, { startsAt: e.target.value })}
                      className="h-8 rounded border border-slate-300 px-1.5"
                    />
                  </td>
                  <td className="p-1.5">
                    <input
                      inputMode="numeric"
                      aria-label={`${l.name} max marks`}
                      disabled={!l.on}
                      value={l.maxMarks}
                      onChange={(e) => {
                        const max = e.target.value.replace(/\D/g, '');
                        // Keep CBSE's 33% pass rule in step unless changed by hand.
                        const auto =
                          String(Math.ceil(Number(l.maxMarks || 0) * 0.33)) === l.passMarks;
                        set(i, {
                          maxMarks: max,
                          ...(auto
                            ? { passMarks: String(Math.ceil(Number(max || 0) * 0.33)) }
                            : {}),
                        });
                      }}
                      className="h-8 w-20 rounded border border-slate-300 px-2"
                    />
                  </td>
                  <td className="p-1.5">
                    <input
                      inputMode="numeric"
                      aria-label={`${l.name} pass marks`}
                      disabled={!l.on}
                      value={l.passMarks}
                      onChange={(e) => set(i, { passMarks: e.target.value.replace(/\D/g, '') })}
                      className="h-8 w-20 rounded border border-slate-300 px-2"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <Button onClick={save} loading={act.pending}>
              Save {cls.name}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        cls.papers.length > 0 && (
          <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {cls.papers.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 border-b border-slate-100 py-1">
                <span>
                  {p.subjectName}
                  <span className="ml-2 text-xs text-slate-500">
                    {p.examDate ? formatDate(p.examDate) : 'date not set'}
                    {p.startsAt ? `, ${p.startsAt}` : ''}
                  </span>
                </span>
                <span className="text-xs text-slate-500">
                  {p.maxMarks} marks (pass {p.passMarks})
                </span>
              </li>
            ))}
          </ul>
        )
      )}
    </Card>
  );
}

function MarksProgress({ exam }: { exam: ExamDetail }) {
  const classes = exam.classes.filter((c) => c.papers.length && c.sections.length);
  if (exam.status === 'draft') {
    return (
      <Alert tone="info">
        Finish the date sheet, then press <b>Start marks entry</b>. Teachers will then see the marks
        they have to enter on their Today page.
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {classes.map((c) => (
        <Card key={c.id} title={c.name}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="p-2">Section</th>
                  {c.papers.map((p) => (
                    <th key={p.id} className="p-2">
                      {p.subjectName}
                    </th>
                  ))}
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {c.sections.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="p-2 font-medium">{s.name}</td>
                    {c.papers.map((p) => {
                      const g = exam.progress.find(
                        (x) => x.paperId === p.id && x.sectionId === s.id,
                      );
                      const done = g?.submitted;
                      const full = g && g.students > 0 && g.entered >= g.students;
                      return (
                        <td key={p.id} className="p-1.5 align-top">
                          <Link
                            href={`/marks/${p.id}/${s.id}`}
                            title={g?.teacher ?? 'No teacher assigned'}
                            className={`block rounded-md px-2 py-1 text-xs ${
                              done
                                ? 'bg-emerald-50 text-emerald-800'
                                : full
                                  ? 'bg-sky-50 text-sky-800'
                                  : g?.entered
                                    ? 'bg-amber-50 text-amber-800'
                                    : 'bg-slate-50 text-slate-500'
                            }`}
                          >
                            <span className="font-medium">
                              {done ? '✓ Handed in' : `${g?.entered ?? 0}/${g?.students ?? 0}`}
                            </span>
                            <span className="block truncate">{g?.teacher ?? 'No teacher'}</span>
                          </Link>
                        </td>
                      );
                    })}
                    <td className="p-2 text-right">
                      <Link
                        href={`/exams/${exam.id}/results/${s.id}`}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        Result →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
