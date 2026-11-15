'use client';

import { useState } from 'react';
import { formatAdmissionNumber } from '@school-erp/validation';
import { put } from '@/lib/api';
import type { AdmissionNumberSettings } from '@/lib/api';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { Alert, Button, Card, Field, PageHeader, Skeleton } from '@/components/ui';

const EXAMPLES = [
  ['{SEQ:4}', '0001, 0002 …'],
  ['ADM/{SEQ:5}', 'ADM/00001'],
  ['{YYYY}/{SEQ:4}', '2026/0001 (with “restart every year”)'],
  ['{CAMPUS}/{YY}/{SEQ:3}', 'JPR/26/001 (with “separate per campus” and “restart every year”)'],
] as const;

function Editor({ initial }: { initial: AdmissionNumberSettings }) {
  const { canEverywhere } = useSession();
  const [pattern, setPattern] = useState(initial.pattern);
  const [perCampus, setPerCampus] = useState(initial.perCampus);
  const [yearlyReset, setYearlyReset] = useState(initial.yearlyReset);
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useAction();
  const editable = canEverywhere('settings.manage');
  const preview = /\{SEQ:[1-9]\}/.test(pattern)
    ? formatAdmissionNumber(pattern, 1, { year: new Date().getFullYear(), campusCode: 'JPR' })
    : '';

  return (
    <Card>
      <div className="space-y-4">
        {!editable && <Alert tone="info">Only school-wide administrators can change this.</Alert>}
        {error && <Alert>{error.fields.pattern ?? error.message}</Alert>}
        {saved && <Alert tone="success">Saved. New admissions use this pattern.</Alert>}
        <Field
          label="Pattern"
          value={pattern}
          onChange={(e) => {
            setPattern(e.target.value);
            setSaved(false);
          }}
          disabled={!editable}
          hint={preview ? `First number would look like: ${preview}` : undefined}
          className="max-w-md"
        />
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={perCampus}
              disabled={!editable}
              onChange={(e) => setPerCampus(e.target.checked)}
            />
            Separate numbering for each campus (needs {'{CAMPUS}'})
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={yearlyReset}
              disabled={!editable}
              onChange={(e) => setYearlyReset(e.target.checked)}
            />
            Restart numbering every academic year (needs {'{YYYY}'} or {'{YY}'})
          </label>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium">Placeholders</p>
          <p className="text-slate-600">
            {'{SEQ:4}'} running number with 4 digits · {'{YYYY}'} / {'{YY}'} year the academic
            session starts · {'{CAMPUS}'} campus code
          </p>
          <ul className="mt-2 space-y-0.5 text-slate-600">
            {EXAMPLES.map(([p, e]) => (
              <li key={p}>
                <code className="text-xs">{p}</code> → {e}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">
          Numbers already given are never changed. Admission numbers have no gaps: a number is used
          only when an admission is completed.
        </p>
        {editable && (
          <Button
            loading={pending}
            onClick={async () => {
              setSaved(false);
              const ok = await run(() =>
                put('/settings/admission-numbers', { pattern, perCampus, yearlyReset }),
              );
              if (ok) setSaved(true);
            }}
          >
            Save
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function AdmissionNumbersPage() {
  const { data, loading, error } = useApi<AdmissionNumberSettings>('/settings/admission-numbers');
  return (
    <>
      <PageHeader title="Admission numbers" description="How new admission numbers are formed." />
      {loading && !data ? (
        <Skeleton />
      ) : error ? (
        <Alert>{error.message}</Alert>
      ) : data ? (
        <Editor initial={data} />
      ) : null}
    </>
  );
}
