'use client';

import { useRef, useState } from 'react';
import { Hash, Info, RotateCcw, Sparkles } from 'lucide-react';
import { admissionNumberSettingsSchema, formatAdmissionNumber } from '@school-erp/validation';
import { api, put } from '@/lib/api';
import type { AcademicYear, AdmissionNumberSettings } from '@/lib/api';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import { Alert, Button, Card, PageHeader, SkeletonBlock, Switch, cx, toast } from '@/components/ui';

const PLACEHOLDERS = [
  {
    token: '{SEQ:4}',
    label: 'Running number',
    detail: 'Counts up for every admission. The digit sets the padding: {SEQ:4} → 0001.',
  },
  { token: '{YYYY}', label: 'Academic year', detail: 'Year the session starts, e.g. 2026.' },
  { token: '{YY}', label: 'Short year', detail: 'Last two digits, e.g. 26.' },
  { token: '{CAMPUS}', label: 'Campus code', detail: 'Code of the campus the student joins.' },
] as const;

const EXAMPLES = [
  {
    pattern: '{SEQ:4}',
    perCampus: false,
    yearlyReset: false,
    note: 'One running number for the whole school',
  },
  { pattern: 'ADM/{SEQ:5}', perCampus: false, yearlyReset: false, note: 'Fixed prefix' },
  {
    pattern: '{YYYY}/{SEQ:4}',
    perCampus: false,
    yearlyReset: true,
    note: 'Restarts every academic year',
  },
  {
    pattern: '{CAMPUS}/{YY}/{SEQ:3}',
    perCampus: true,
    yearlyReset: true,
    note: 'Per campus, restarts yearly',
  },
] as const;

function Editor({ initial }: { initial: AdmissionNumberSettings }) {
  const { canEverywhere } = useSession();
  const { campus } = useCampus();
  const years = useApi<AcademicYear[]>(campus ? `/academic-years?campusId=${campus.id}` : null);
  const [saved, setSaved] = useState(initial);
  const [pattern, setPattern] = useState(initial.pattern);
  const [perCampus, setPerCampus] = useState(initial.perCampus);
  const [yearlyReset, setYearlyReset] = useState(initial.yearlyReset);
  const { pending, error, run, setError } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const editable = canEverywhere('settings.manage');

  const dirty =
    pattern !== saved.pattern || perCampus !== saved.perCampus || yearlyReset !== saved.yearlyReset;

  // Same rules the server applies, so problems show while typing.
  const check = admissionNumberSettingsSchema.safeParse({ pattern, perCampus, yearlyReset });
  const localError = check.success ? null : check.error.issues[0]?.message;
  const serverError = error ? (error.fields.pattern ?? error.message) : null;
  const problem = (dirty && localError) || serverError;

  const currentYear = years.data?.find((y) => y.isCurrent) ?? years.data?.at(-1);
  const year = currentYear ? Number(currentYear.startsOn.slice(0, 4)) : new Date().getFullYear();
  const campusCode = campus?.code ?? 'MAIN';
  const ctx = { year, campusCode };
  const canPreview = /\{SEQ:[1-9]\}/.test(pattern);
  const samples = canPreview ? [1, 2, 3].map((i) => formatAdmissionNumber(pattern, i, ctx)) : [];

  const insert = (token: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? pattern.length;
    const end = el?.selectionEnd ?? pattern.length;
    const next = pattern.slice(0, start) + token + pattern.slice(end);
    setPattern(next);
    setError(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    const ok = await run(() =>
      put('/settings/admission-numbers', { pattern: pattern.trim(), perCampus, yearlyReset }),
    );
    if (ok) {
      const fresh = await api<AdmissionNumberSettings>('/settings/admission-numbers').catch(
        () => null,
      );
      setSaved(fresh ?? { ...saved, pattern: pattern.trim(), perCampus, yearlyReset, next: null });
      setPattern(fresh?.pattern ?? pattern.trim());
      toast.success('Admission number settings saved.');
    }
  };

  const reset = () => {
    setPattern(saved.pattern);
    setPerCampus(saved.perCampus);
    setYearlyReset(saved.yearlyReset);
    setError(null);
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-5">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-3">
        <Card
          title="Number format"
          description="Build the pattern every new admission number follows."
        >
          <div className="space-y-5">
            {!editable && (
              <Alert tone="info">Only school-wide administrators can change this setting.</Alert>
            )}

            <div>
              <label htmlFor="pattern" className="text-[13px] font-medium text-slate-700">
                Pattern
                <span className="ml-0.5 text-red-500" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                ref={input}
                id="pattern"
                value={pattern}
                spellCheck={false}
                autoComplete="off"
                disabled={!editable}
                aria-invalid={Boolean(problem) || undefined}
                aria-describedby="pattern-msg"
                onChange={(e) => {
                  setPattern(e.target.value);
                  setError(null);
                }}
                className="ui-control mt-1.5 font-mono tracking-wide"
              />
              <p
                id="pattern-msg"
                className={cx('mt-1.5 text-xs', problem ? 'text-red-600' : 'text-slate-500')}
              >
                {problem || 'Letters, numbers, / - _ and the placeholders below.'}
              </p>
              {editable && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-slate-500">Insert:</span>
                  {PLACEHOLDERS.map((p) => (
                    <button
                      key={p.token}
                      type="button"
                      onClick={() => insert(p.token)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                    >
                      {p.token}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4 border-t border-slate-100 pt-5">
              <Switch
                label="Separate numbering for each campus"
                description={
                  <>
                    Each campus keeps its own counter. Needs{' '}
                    <code className="font-mono">{'{CAMPUS}'}</code> in the pattern so numbers don’t
                    repeat.
                  </>
                }
                checked={perCampus}
                disabled={!editable}
                onChange={(v) => {
                  setPerCampus(v);
                  setError(null);
                }}
              />
              <Switch
                label="Restart numbering every academic year"
                description={
                  <>
                    The counter goes back to 1 each session. Needs{' '}
                    <code className="font-mono">{'{YYYY}'}</code> or{' '}
                    <code className="font-mono">{'{YY}'}</code>.
                  </>
                }
                checked={yearlyReset}
                disabled={!editable}
                onChange={(v) => {
                  setYearlyReset(v);
                  setError(null);
                }}
              />
            </div>
          </div>
          {editable && (
            <div className="-mx-5 mt-5 -mb-5 flex items-center justify-between gap-3 rounded-b-xl border-t border-slate-100 bg-slate-50/60 px-5 py-3">
              <p className="text-xs text-slate-500">
                {dirty ? 'You have unsaved changes.' : 'Numbers already issued never change.'}
              </p>
              <div className="flex gap-2">
                {dirty && (
                  <Button variant="ghost" size="sm" icon={RotateCcw} onClick={reset}>
                    Discard
                  </Button>
                )}
                <Button
                  loading={pending}
                  disabled={!dirty || Boolean(localError)}
                  onClick={() => void save()}
                >
                  Save changes
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card title="Common formats" description="Pick one to start from, then adjust." flush>
          <ul className="divide-y divide-slate-100">
            {EXAMPLES.map((e) => (
              <li key={e.pattern} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm text-ink">{e.pattern}</p>
                  <p className="text-xs text-slate-500">{e.note}</p>
                </div>
                <span className="hidden font-mono text-sm text-slate-600 sm:block">
                  {formatAdmissionNumber(e.pattern, 1, ctx)}
                </span>
                {editable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      e.pattern === pattern &&
                      e.perCampus === perCampus &&
                      e.yearlyReset === yearlyReset
                    }
                    onClick={() => {
                      setPattern(e.pattern);
                      setPerCampus(e.perCampus);
                      setYearlyReset(e.yearlyReset);
                      setError(null);
                    }}
                  >
                    Use
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-20 lg:col-span-2">
        <Card title="Live preview" icon={Sparkles}>
          {canPreview ? (
            <>
              <p className="text-xs text-slate-500">
                {!dirty && saved.next ? 'Next admission number' : 'First numbers with this pattern'}
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tracking-wide break-all text-ink">
                {!dirty && saved.next ? saved.next : samples[0]}
              </p>
              <div className={cx('mt-3 flex flex-wrap gap-1.5', !dirty && saved.next && 'hidden')}>
                {samples.slice(1).map((s) => (
                  <span
                    key={s}
                    className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600"
                  >
                    {s}
                  </span>
                ))}
                <span className="px-1 text-xs text-slate-400">…</span>
              </div>
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                Shown for campus <span className="font-mono">{campusCode}</span> and session year{' '}
                <span className="font-mono">{year}</span>.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Add a running number such as <code className="font-mono">{'{SEQ:4}'}</code> to see a
              preview.
            </p>
          )}
        </Card>

        <Card title="Placeholders" icon={Hash} flush>
          <dl className="divide-y divide-slate-100">
            {PLACEHOLDERS.map((p) => (
              <div key={p.token} className="flex gap-4 px-5 py-3">
                <dt className="w-20 shrink-0 font-mono text-[13px] text-brand-700">{p.token}</dt>
                <dd className="min-w-0 text-[13px]">
                  <span className="font-medium text-ink">{p.label}</span>
                  <span className="block text-slate-500">{p.detail}</span>
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs text-slate-500">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />A number is used only when an
            admission is completed, so there are no gaps.
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function AdmissionNumbersPage() {
  const { data, loading, error } = useApi<AdmissionNumberSettings>('/settings/admission-numbers');
  return (
    <>
      <PageHeader
        title="Admission Number Configuration"
        description="Choose how admission numbers are generated for newly admitted students."
      />
      {loading && !data ? (
        <div className="grid gap-6 lg:grid-cols-5">
          <SkeletonBlock className="h-80 lg:col-span-3" />
          <SkeletonBlock className="h-48 lg:col-span-2" />
        </div>
      ) : error ? (
        <Alert>{error.message}</Alert>
      ) : data ? (
        <Editor initial={data} />
      ) : null}
    </>
  );
}
