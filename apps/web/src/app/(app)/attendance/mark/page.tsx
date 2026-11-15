'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { put } from '@/lib/api';
import type { AttendanceCorrection, AttendanceRegister, AttendanceStatus } from '@/lib/api';
import { dateTime, formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { SectionPicker } from '@/components/students/section-picker';
import type { SectionChoice } from '@/components/students/section-picker';
import {
  STATUS_META,
  STATUS_ORDER,
  dayReasonLabel,
  localToday,
  shiftDate,
} from '@/components/attendance/status';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
} from '@/components/ui';

type Marks = Record<string, { status: AttendanceStatus; remark: string }>;

export default function MarkAttendancePage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <MarkAttendance />
    </Suspense>
  );
}

function MarkAttendance() {
  const params = useSearchParams();
  const router = useRouter();
  const sectionId = params.get('sectionId');
  const date = params.get('date') || localToday();
  const period = Number(params.get('period') ?? 0) || 0;

  const go = useCallback(
    (next: { sectionId?: string | null; date?: string; period?: number }) => {
      const q = new URLSearchParams();
      const s = next.sectionId === undefined ? sectionId : next.sectionId;
      if (s) q.set('sectionId', s);
      q.set('date', next.date ?? date);
      const p = next.period ?? period;
      if (p) q.set('period', String(p));
      router.replace(`/attendance/mark?${q}`);
    },
    [router, sectionId, date, period],
  );

  if (!sectionId) return <ChooseSection date={date} onPick={(id) => go({ sectionId: id })} />;
  return (
    <Register
      key={`${sectionId}|${date}|${period}`}
      sectionId={sectionId}
      date={date}
      period={period}
      go={go}
    />
  );
}

function ChooseSection({ date, onPick }: { date: string; onPick: (id: string) => void }) {
  const { campus, picker } = useCampus();
  const [choice, setChoice] = useState<SectionChoice>({
    academicYearId: null,
    gradeLevelId: null,
    sectionId: null,
  });
  const onChoice = useCallback((v: SectionChoice) => setChoice(v), []);
  return (
    <>
      <PageHeader
        title="Take attendance"
        description={`Choose a section for ${formatDate(date)}.`}
      />
      <Card>
        <div className="flex flex-col gap-4">
          {picker}
          {campus && <SectionPicker campusId={campus.id} value={choice} onChange={onChoice} />}
          <div>
            <Button
              disabled={!choice.sectionId}
              onClick={() => choice.sectionId && onPick(choice.sectionId)}
            >
              Open register
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}

function Register({
  sectionId,
  date,
  period,
  go,
}: {
  sectionId: string;
  date: string;
  period: number;
  go: (n: { sectionId?: string | null; date?: string; period?: number }) => void;
}) {
  const reg = useApi<AttendanceRegister>(
    `/attendance/sections/${sectionId}/register?date=${date}&period=${period}`,
  );
  const history = useApi<AttendanceCorrection[]>(
    reg.data?.session
      ? `/attendance/sections/${sectionId}/history?date=${date}&period=${period}`
      : null,
  );
  const [marks, setMarks] = useState<Marks>({});
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [remarkFor, setRemarkFor] = useState<string | null>(null);
  const action = useAction();

  useEffect(() => {
    if (!reg.data) return;
    setMarks(
      Object.fromEntries(
        reg.data.students.map((s) => [s.enrollmentId, { status: s.status, remark: s.remark }]),
      ),
    );
  }, [reg.data]);

  // Period mode: the API refuses period 0, so move to period 1 once settings are known.
  useEffect(() => {
    if (reg.error?.status === 422 && period === 0 && /period from 1/.test(reg.error.message))
      go({ period: 1 });
  }, [reg.error, period, go]);

  const r = reg.data;
  const counts = useMemo(() => {
    const c: Record<AttendanceStatus, number> = {
      present: 0,
      absent: 0,
      late: 0,
      half_day: 0,
      leave: 0,
    };
    for (const m of Object.values(marks)) c[m.status] += 1;
    return c;
  }, [marks]);
  const dirty = useMemo(
    () =>
      !!r &&
      (!r.session ||
        r.students.some(
          (s) =>
            marks[s.enrollmentId] &&
            (marks[s.enrollmentId]!.status !== s.status ||
              marks[s.enrollmentId]!.remark !== s.remark),
        )),
    [r, marks],
  );
  const statusChanged =
    !!r &&
    r.students.some((s) => marks[s.enrollmentId] && marks[s.enrollmentId]!.status !== s.status);

  const set = (id: string, status: AttendanceStatus) => {
    setSaved(null);
    setMarks((m) => ({ ...m, [id]: { ...m[id]!, status } }));
  };
  const setAll = (status: AttendanceStatus) => {
    if (!r) return;
    setSaved(null);
    // Students on approved leave keep "leave".
    setMarks(
      Object.fromEntries(
        r.students.map((s) => [
          s.enrollmentId,
          { status: s.onLeave ? 'leave' : status, remark: marks[s.enrollmentId]?.remark ?? '' },
        ]),
      ),
    );
  };

  const save = async () => {
    if (!r) return;
    const res = await action.run(() =>
      put<{ counts: Record<string, number>; corrected: number }>(
        `/attendance/sections/${sectionId}/register?date=${date}&period=${period}`,
        {
          records: r.students.map((s) => ({
            enrollmentId: s.enrollmentId,
            ...marks[s.enrollmentId]!,
          })),
          ...(r.needsReason && statusChanged ? { reason } : {}),
        },
      ),
    );
    if (res) {
      setSaved(
        res.corrected
          ? `Saved. ${res.corrected} correction${res.corrected > 1 ? 's' : ''} recorded.`
          : 'Attendance saved.',
      );
      setReason('');
      await reg.reload();
      await history.reload();
    }
  };

  if (reg.error && !r) {
    return (
      <>
        <PageHeader title="Take attendance" />
        <Alert>{reg.error.message}</Alert>
        <p className="mt-4 text-sm">
          <Link className="text-brand-700 underline" href="/attendance">
            Back to today’s attendance
          </Link>
        </p>
      </>
    );
  }
  if (!r) return <Skeleton rows={8} />;

  const editable = r.canEdit;
  const periods =
    r.settings.mode === 'period'
      ? Array.from({ length: r.settings.periodsPerDay }, (_, i) => i + 1)
      : [];

  return (
    <div className="pb-28">
      <PageHeader
        title={`${r.section.className} – ${r.section.name}`}
        description={`Attendance for ${formatDate(date)}${period ? `, period ${period}` : ''}`}
        actions={
          <Link
            className="text-sm text-brand-700 hover:underline"
            href={`/attendance/register?sectionId=${sectionId}&month=${date.slice(0, 7)}`}
          >
            Monthly register
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            aria-label="Previous day"
            onClick={() => go({ date: shiftDate(date, -1) })}
          >
            ←
          </Button>
          <Field
            label="Date"
            type="date"
            value={date}
            onChange={(e) => e.target.value && go({ date: e.target.value })}
            className="w-44"
          />
          <Button
            variant="secondary"
            aria-label="Next day"
            disabled={date >= localToday()}
            onClick={() => go({ date: shiftDate(date, 1) })}
          >
            →
          </Button>
        </div>
        {periods.length > 0 && (
          <SelectField
            label="Period"
            value={period}
            onChange={(e) => go({ period: Number(e.target.value) })}
            className="w-32"
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                Period {p}
              </option>
            ))}
          </SelectField>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-2">
        {!r.day.working && (
          <Alert tone="warning">{dayReasonLabel(r.day)}: no attendance is taken.</Alert>
        )}
        {r.session && (
          <p className="text-sm text-slate-600">
            Taken by {r.session.markedBy ?? 'someone'} at {dateTime(r.session.markedAt)}
            {r.session.updatedAt !== r.session.markedAt && (
              <> · last changed {dateTime(r.session.updatedAt)}</>
            )}
          </p>
        )}
        {r.day.working && r.locked && (
          <Alert tone={editable ? 'info' : 'warning'}>
            {r.session
              ? 'This register closed for changes at '
              : 'Registers for this date closed at '}
            {dateTime(r.lockedAt)}.{' '}
            {editable
              ? r.session
                ? 'You can still correct it; changed students are recorded with your reason.'
                : 'You can still fill it in late.'
              : 'Ask someone who can correct attendance to change it.'}
          </Alert>
        )}
        {r.day.working && !r.locked && r.session && editable && (
          <p className="text-xs text-slate-500">
            You can change this register freely until {dateTime(r.lockedAt)}.
          </p>
        )}
      </div>

      {r.day.working && (
        <>
          {editable && r.students.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setAll('present')}>
                All present
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAll('absent')}>
                All absent
              </Button>
            </div>
          )}
          {!r.students.length ? (
            <Alert tone="info">No students are enrolled in this section on this date.</Alert>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {r.students.map((s) => {
                const m = marks[s.enrollmentId];
                if (!m) return null;
                return (
                  <li key={s.enrollmentId} className="px-3 py-2.5 sm:px-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="w-8 shrink-0 text-right text-sm tabular-nums text-slate-500">
                        {s.rollNumber ?? '—'}
                      </span>
                      <div className="min-w-[9rem] flex-1">
                        <p className="font-medium">{s.name}</p>
                        <p className="text-xs text-slate-500">
                          {s.admissionNumber}
                          {s.onLeave && (
                            <>
                              {' '}
                              · <span className="text-slate-700">approved leave</span>
                            </>
                          )}
                          {m.remark && <> · {m.remark}</>}
                        </p>
                      </div>
                      <div
                        role="radiogroup"
                        aria-label={`Attendance for ${s.name}`}
                        className="flex gap-1 pl-11 sm:pl-0"
                      >
                        {STATUS_ORDER.map((st) => {
                          const on = m.status === st;
                          return (
                            <button
                              key={st}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              aria-label={STATUS_META[st].label}
                              title={STATUS_META[st].label}
                              disabled={!editable}
                              onClick={() => set(s.enrollmentId, st)}
                              className={`size-10 rounded-lg border text-sm font-semibold transition disabled:cursor-default ${
                                on
                                  ? STATUS_META[st].on
                                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:hover:bg-white'
                              }`}
                            >
                              {STATUS_META[st].short}
                            </button>
                          );
                        })}
                        {editable && (
                          <button
                            type="button"
                            className="ml-1 text-xs text-slate-500 underline"
                            onClick={() =>
                              setRemarkFor(remarkFor === s.enrollmentId ? null : s.enrollmentId)
                            }
                          >
                            Note
                          </button>
                        )}
                      </div>
                    </div>
                    {remarkFor === s.enrollmentId && (
                      <div className="mt-2 pl-11">
                        <Field
                          label="Note (optional)"
                          maxLength={200}
                          value={m.remark}
                          onChange={(e) => {
                            const remark = e.target.value;
                            setMarks((x) => ({
                              ...x,
                              [s.enrollmentId]: { ...x[s.enrollmentId]!, remark },
                            }));
                          }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {history.data && history.data.length > 0 && (
            <Card title="Corrections" className="mt-6">
              <ul className="flex flex-col gap-2 text-sm">
                {history.data.map((h) => (
                  <li key={h.id}>
                    <span className="font-medium">{h.studentName}</span>:{' '}
                    {STATUS_META[h.fromStatus].label} → {STATUS_META[h.toStatus].label} — “
                    {h.reason}”
                    <span className="text-slate-500">
                      {' '}
                      · {h.correctedBy ?? '—'}, {dateTime(h.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {editable && r.students.length > 0 && (
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:left-60">
              <div className="mx-auto flex max-w-5xl flex-col gap-2">
                {action.error && <Alert>{action.error.message}</Alert>}
                {saved && !dirty && <Alert tone="success">{saved}</Alert>}
                {r.needsReason && statusChanged && (
                  <Field
                    label="Reason for the correction"
                    required
                    minLength={3}
                    maxLength={200}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Came late with a note from parent"
                  />
                )}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2 text-sm">
                    {STATUS_ORDER.map((st) => (
                      <Badge key={st} tone={st === 'absent' && counts.absent ? 'red' : 'neutral'}>
                        {STATUS_META[st].label} {counts[st]}
                      </Badge>
                    ))}
                  </div>
                  <Button
                    onClick={save}
                    loading={action.pending}
                    disabled={
                      !dirty || (r.needsReason && statusChanged && reason.trim().length < 3)
                    }
                  >
                    {r.session ? 'Save changes' : 'Save attendance'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
