'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { post } from '@/lib/api';
import type { AcademicYear, PromotionPreview } from '@/lib/api';
import { fullName } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import { SectionPicker } from '@/components/students/section-picker';
import type { SectionChoice } from '@/components/students/section-picker';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SelectField,
  Skeleton,
  Table,
  Td,
  confirmAction,
} from '@/components/ui';

type Action = 'promote' | 'retain' | 'complete' | 'skip';
interface Plan {
  action: Action;
  toSectionId: string;
}

const ACTION_LABEL: Record<Action, string> = {
  promote: 'Promote',
  retain: 'Keep in same class',
  complete: 'Completed school (alumni)',
  skip: 'Decide later',
};

export default function PromotePage() {
  const { can } = useSession();
  const { campus, picker } = useCampus();
  const [choice, setChoice] = useState<SectionChoice>({
    academicYearId: null,
    gradeLevelId: null,
    sectionId: null,
  });
  const onChoice = useCallback((v: SectionChoice) => setChoice(v), []);
  const years = useApi<AcademicYear[]>(campus ? `/academic-years?campusId=${campus.id}` : null);
  const fromYear = years.data?.find((y) => y.id === choice.academicYearId);
  const laterYears = (years.data ?? []).filter(
    (y) => fromYear && y.startsOn > fromYear.startsOn && y.status !== 'closed',
  );
  const [targetYearId, setTargetYearId] = useState('');
  useEffect(() => setTargetYearId(laterYears[0]?.id ?? ''), [fromYear?.id, years.data]);

  const preview = useApi<PromotionPreview>(
    choice.sectionId && targetYearId
      ? `/promotions/preview?fromSectionId=${choice.sectionId}&toAcademicYearId=${targetYearId}`
      : null,
  );
  const [plan, setPlan] = useState<Record<string, Plan>>({});
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const action = useAction();

  const next = useMemo(
    () => preview.data?.sections.filter((s) => s.isNextClass) ?? [],
    [preview.data],
  );
  const same = useMemo(
    () => preview.data?.sections.filter((s) => s.isSameClass) ?? [],
    [preview.data],
  );

  useEffect(() => {
    if (!preview.data) return;
    setResult(null);
    setPlan(
      Object.fromEntries(
        preview.data.students.map((st) => [
          st.enrollmentId,
          st.alreadyInTarget
            ? { action: 'skip' as Action, toSectionId: '' }
            : preview.data!.highestClass
              ? { action: 'complete' as Action, toSectionId: '' }
              : { action: 'promote' as Action, toSectionId: next[0]?.id ?? '' },
        ]),
      ),
    );
  }, [preview.data, next]);

  if (campus && !can('students.promote', campus.id)) {
    return (
      <>
        <PageHeader title="Promote students" />
        <Alert>You do not have permission to promote students.</Alert>
      </>
    );
  }

  const setAll = (a: Action) =>
    setPlan((p) =>
      Object.fromEntries(
        Object.entries(p).map(([k]) => [
          k,
          {
            action: a,
            toSectionId:
              a === 'promote' ? (next[0]?.id ?? '') : a === 'retain' ? (same[0]?.id ?? '') : '',
          },
        ]),
      ),
    );

  const counts = Object.values(plan).reduce<Record<string, number>>(
    (acc, p) => ({ ...acc, [p.action]: (acc[p.action] ?? 0) + 1 }),
    {},
  );

  return (
    <>
      <PageHeader
        title="Promote students"
        description="Move a section's students into next year's classes. Do this once the new academic year and its sections exist."
      />
      <Card className="mb-4">
        <div className="space-y-4">
          {picker}
          {campus && <SectionPicker campusId={campus.id} value={choice} onChange={onChoice} />}
          {fromYear && (
            <SelectField
              label="Move into academic year"
              value={targetYearId}
              onChange={(e) => setTargetYearId(e.target.value)}
              className="w-60"
            >
              {!laterYears.length && <option value="">Create next year first</option>}
              {laterYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </SelectField>
          )}
        </div>
      </Card>

      {result && (
        <div className="mb-4">
          <Alert tone="success">
            Done: {result.promoted} promoted, {result.retained} kept in the same class,{' '}
            {result.completed} completed school, {result.skipped} left for later.
          </Alert>
        </div>
      )}
      {action.error && (
        <div className="mb-4">
          <Alert>{action.error.message}</Alert>
        </div>
      )}

      {!choice.sectionId || !targetYearId ? null : preview.loading && !preview.data ? (
        <Skeleton rows={6} />
      ) : preview.error ? (
        <Alert>{preview.error.message}</Alert>
      ) : !preview.data?.students.length ? (
        <Card>
          <EmptyState title="No current students in this section" />
        </Card>
      ) : (
        <Card
          title={`${preview.data.from.label} (${preview.data.from.yearName}) → ${preview.data.target.name}`}
          actions={
            <div className="flex flex-wrap gap-1">
              {!preview.data.highestClass && (
                <Button variant="ghost" size="sm" onClick={() => setAll('promote')}>
                  Promote all
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setAll('complete')}>
                All completed school
              </Button>
            </div>
          }
        >
          {!preview.data.sections.length && (
            <div className="mb-4">
              <Alert tone="warning">
                {preview.data.target.name} has no sections yet. Add them on Classes &amp; sections.
              </Alert>
            </div>
          )}
          <Table head={['Roll', 'Student', 'Next year', 'Section']}>
            {preview.data.students.map((st) => {
              const p = plan[st.enrollmentId];
              if (!p) return null;
              const options =
                p.action === 'retain'
                  ? same
                  : p.action === 'promote'
                    ? preview.data!.sections.filter((x) => !x.isSameClass)
                    : [];
              return (
                <tr key={st.enrollmentId}>
                  <Td>{st.rollNumber ?? '—'}</Td>
                  <Td>
                    <span className="font-medium">{fullName(st)}</span>
                    <span className="block text-xs text-slate-500">{st.admissionNumber}</span>
                    {st.alreadyInTarget && (
                      <span className="block text-xs text-amber-700">Already in next year</span>
                    )}
                  </Td>
                  <Td>
                    <select
                      aria-label={`Next year for ${fullName(st)}`}
                      value={p.action}
                      disabled={st.alreadyInTarget}
                      onChange={(e) => {
                        const a = e.target.value as Action;
                        setPlan((pl) => ({
                          ...pl,
                          [st.enrollmentId]: {
                            action: a,
                            toSectionId:
                              a === 'promote'
                                ? (next[0]?.id ?? '')
                                : a === 'retain'
                                  ? (same[0]?.id ?? '')
                                  : '',
                          },
                        }));
                      }}
                      className="ui-control h-8 w-auto min-w-36"
                    >
                      {(Object.keys(ACTION_LABEL) as Action[]).map((a) => (
                        <option key={a} value={a}>
                          {ACTION_LABEL[a]}
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td>
                    {options.length > 0 && (
                      <select
                        aria-label={`Section for ${fullName(st)}`}
                        value={p.toSectionId}
                        onChange={(e) =>
                          setPlan((pl) => ({
                            ...pl,
                            [st.enrollmentId]: { ...p, toSectionId: e.target.value },
                          }))
                        }
                        className="ui-control h-8 w-auto min-w-36"
                      >
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.className} {o.name}
                            {o.capacity ? ` (${o.enrolled}/${o.capacity})` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              loading={action.pending}
              onClick={async () => {
                const items = Object.entries(plan)
                  .filter(([, p]) => p.action !== 'skip')
                  .map(([enrollmentId, p]) => ({
                    enrollmentId,
                    action: p.action,
                    toSectionId: p.toSectionId || null,
                  }));
                if (!items.length) return;
                if (
                  !(await confirmAction({
                    title: `Apply to ${items.length} students?`,
                    message: 'Their current enrollment will be closed.',
                    confirmLabel: 'Apply',
                    tone: 'primary',
                  }))
                )
                  return;
                const r = await action.run(() =>
                  post<Record<string, number>>('/promotions', {
                    fromSectionId: choice.sectionId,
                    toAcademicYearId: targetYearId,
                    items,
                  }),
                );
                if (r) {
                  setResult({ ...r, skipped: (r.skipped ?? 0) + (counts.skip ?? 0) });
                  void preview.reload();
                }
              }}
            >
              Apply
            </Button>
            <span className="text-sm text-slate-500">
              {Object.entries(counts)
                .map(([k, n]) => `${n} ${ACTION_LABEL[k as Action].toLowerCase()}`)
                .join(' · ')}
            </span>
          </div>
        </Card>
      )}
    </>
  );
}
