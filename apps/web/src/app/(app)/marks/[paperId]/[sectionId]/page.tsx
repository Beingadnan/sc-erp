'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { post, put } from '@/lib/api';
import type { MarkStatus, MarksSheet } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { fmtMarks } from '@/components/exams/labels';
import { Alert, Badge, Button, Card, PageHeader, Skeleton } from '@/components/ui';

interface Draft {
  status: MarkStatus;
  value: string;
}
const STATUS_OPTIONS: Array<[MarkStatus, string]> = [
  ['present', 'Marks'],
  ['absent', 'Absent'],
  ['medical', 'Medical'],
  ['exempt', 'Exempt'],
];

/**
 * The marks register for one subject in one class. Type a mark and press Enter to go to the next
 * student; type "a" for absent. Saves as you go.
 */
export default function MarksSheetPage({
  params,
}: {
  params: Promise<{ paperId: string; sectionId: string }>;
}) {
  const { paperId, sectionId } = use(params);
  const path = `/exams/papers/${paperId}/sections/${sectionId}`;
  const sheet = useApi<MarksSheet>(path);
  const act = useAction();
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const d = sheet.data;

  useEffect(() => {
    if (!d) return;
    setDraft(
      Object.fromEntries(
        d.students.map((s) => [
          s.enrollmentId,
          { status: s.status ?? 'present', value: fmtMarks(s.marks) },
        ]),
      ),
    );
    setDirty(new Set());
  }, [d]);

  if (sheet.error) return <Alert>{sheet.error.message}</Alert>;
  if (!d) return <Skeleton rows={10} />;
  const max = d.paper.maxMarks;

  const problem = (x: Draft | undefined) => {
    if (!x || x.status !== 'present' || x.value === '') return null;
    const v = Number(x.value);
    if (Number.isNaN(v) || v < 0) return 'Not a number';
    if (v > max) return `More than ${max}`;
    if (Math.round(v * 2) !== v * 2) return 'Use whole or half marks';
    return null;
  };
  const edit = (id: string, patch: Partial<Draft>) => {
    setDraft((m) => ({ ...m, [id]: { ...m[id]!, ...patch } }));
    setDirty((s) => new Set(s).add(id));
  };
  const rows = d.students.map((s) => ({ ...s, draft: draft[s.enrollmentId] }));
  const filled = rows.filter(
    (r) => r.draft && (r.draft.status !== 'present' || (r.draft.value !== '' && !problem(r.draft))),
  ).length;
  const bad = rows.some((r) => problem(r.draft));

  const save = async () => {
    if (!dirty.size || bad) return !bad;
    const marks = [...dirty].map((id) => {
      const x = draft[id]!;
      return {
        enrollmentId: id,
        status: x.status,
        marks: x.status === 'present' && x.value !== '' ? Number(x.value) : null,
      };
    });
    const ok = await act.run(() => put(path, { marks }));
    if (ok) {
      setDirty(new Set());
      setSavedAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    }
    return !!ok;
  };
  const handIn = async () => {
    if (!(await save())) return;
    if (await act.run(() => post(`${path}/submit`, {}))) void sheet.reload();
  };
  const reopen = async () => {
    if (await act.run(() => post(`${path}/reopen`, {}))) void sheet.reload();
  };

  const average = (() => {
    const v = rows
      .filter((r) => r.draft?.status === 'present' && r.draft.value !== '' && !problem(r.draft))
      .map((r) => Number(r.draft!.value));
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null;
  })();

  return (
    <>
      <PageHeader
        title={`${d.section.className} ${d.section.name} · ${d.paper.subjectName}`}
        description={`${d.exam.name}${d.paper.examDate ? ` · ${formatDate(d.paper.examDate)}` : ''} · out of ${max}, pass ${d.paper.passMarks}`}
        actions={
          <Link href="/marks" className="text-sm text-brand-700 hover:underline">
            ← All my classes
          </Link>
        }
      />
      {act.error && (
        <div className="mb-4">
          <Alert>{act.error.message}</Alert>
        </div>
      )}
      {d.submission ? (
        <div className="mb-4">
          <Alert tone="success">
            Handed in{d.submission.by ? ` by ${d.submission.by}` : ''}. Marks are locked
            {d.canReopen
              ? '; you can reopen them for corrections.'
              : '. Ask the exam in-charge to reopen them for a correction.'}
          </Alert>
        </div>
      ) : d.exam.status !== 'open' ? (
        <div className="mb-4">
          <Alert tone="info">
            {d.exam.status === 'draft'
              ? 'Marks entry has not started for this exam yet.'
              : 'Results are published; marks are locked.'}
          </Alert>
        </div>
      ) : !d.canEdit ? (
        <div className="mb-4">
          <Alert tone="info">Only the subject teacher can enter these marks.</Alert>
        </div>
      ) : null}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-slate-600">
            {filled} of {rows.length} done{average ? ` · class average ${average}` : ''}
          </span>
          {d.canEdit && (
            <span className="text-xs text-slate-500">
              Enter → next student · type <b>a</b> for absent
              {savedAt && !dirty.size
                ? ` · saved ${savedAt}`
                : dirty.size
                  ? ' · not saved yet'
                  : ''}
            </span>
          )}
        </div>
        <ul className="divide-y divide-slate-100">
          {rows.map((r, i) => {
            const x = r.draft;
            const err = problem(x);
            const fail =
              x?.status === 'present' &&
              x.value !== '' &&
              !err &&
              Number(x.value) < d.paper.passMarks;
            return (
              <li key={r.enrollmentId} className="flex flex-wrap items-center gap-3 py-2">
                <span className="w-8 text-right text-sm text-slate-400 tabular-nums">
                  {r.rollNumber ?? '–'}
                </span>
                <span className="min-w-40 flex-1">
                  <span className="font-medium">{r.name}</span>
                  <span className="block text-xs text-slate-500">{r.admissionNumber}</span>
                </span>
                {d.canEdit ? (
                  <>
                    <select
                      aria-label={`${r.name} status`}
                      value={x?.status ?? 'present'}
                      onChange={(e) => {
                        const status = e.target.value as MarkStatus;
                        edit(r.enrollmentId, {
                          status,
                          value: status === 'present' ? (x?.value ?? '') : '',
                        });
                      }}
                      className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm"
                    >
                      {STATUS_OPTIONS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <input
                      ref={(el) => {
                        inputs.current[i] = el;
                      }}
                      aria-label={`${r.name} marks`}
                      inputMode="decimal"
                      disabled={x?.status !== 'present'}
                      value={x?.status === 'present' ? (x?.value ?? '') : ''}
                      placeholder={x?.status === 'present' ? `/${max}` : '—'}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        if (/^a$/i.test(v)) {
                          edit(r.enrollmentId, { status: 'absent', value: '' });
                          inputs.current[i + 1]?.focus();
                          return;
                        }
                        edit(r.enrollmentId, { value: v.replace(/[^\d.]/g, '') });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'ArrowDown') {
                          e.preventDefault();
                          inputs.current
                            .slice(i + 1)
                            .find((el) => el && !el.disabled)
                            ?.focus();
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          inputs.current
                            .slice(0, i)
                            .reverse()
                            .find((el) => el && !el.disabled)
                            ?.focus();
                        }
                      }}
                      onBlur={() => void save()}
                      className={`h-9 w-24 rounded-lg border px-3 text-right text-sm tabular-nums ${
                        err
                          ? 'border-red-400 bg-red-50'
                          : fail
                            ? 'border-amber-300 text-red-700'
                            : 'border-slate-300'
                      }`}
                    />
                    <span className="w-28 text-xs text-red-600">
                      {err ?? (fail ? 'Below pass' : '')}
                    </span>
                  </>
                ) : (
                  <span className="w-28 text-right text-sm tabular-nums">
                    {r.status && r.status !== 'present' ? (
                      <Badge tone="neutral">
                        {STATUS_OPTIONS.find(([v]) => v === r.status)?.[1]}
                      </Badge>
                    ) : (
                      fmtMarks(r.marks) || '—'
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {(d.canEdit || d.canReopen) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {d.canEdit && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => void save()}
                  loading={act.pending}
                  disabled={!dirty.size || bad}
                >
                  Save
                </Button>
                <Button onClick={handIn} disabled={act.pending || bad || filled < rows.length}>
                  Hand in marks
                </Button>
                {filled < rows.length && (
                  <span className="text-xs text-slate-500">
                    Enter every student (or mark them absent) to hand in.
                  </span>
                )}
              </>
            )}
            {d.canReopen && (
              <Button variant="secondary" onClick={reopen} loading={act.pending}>
                Reopen for correction
              </Button>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
