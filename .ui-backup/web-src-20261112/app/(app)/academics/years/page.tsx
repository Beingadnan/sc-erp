'use client';

import { useState } from 'react';
import { del, patch, post } from '@/lib/api';
import type { AcademicYear, Term } from '@/lib/api';
import { formatDate, formatRange, WEEKDAYS } from '@/lib/format';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Skeleton,
  Table,
  Td,
} from '@/components/ui';

const SATURDAYS = [
  [1, '1st'],
  [2, '2nd'],
  [3, '3rd'],
  [4, '4th'],
  [5, '5th'],
] as const;

/** Suggests the next April–March year after the latest one. */
const suggestYear = (years: AcademicYear[]) => {
  const last = years.at(-1);
  const start = last ? Number(last.endsOn.slice(0, 4)) : new Date().getFullYear();
  return {
    name: `${start}-${String((start + 1) % 100).padStart(2, '0')}`,
    startsOn: `${start}-04-01`,
    endsOn: `${start + 1}-03-31`,
  };
};

function YearForm({
  campusId,
  year,
  suggestion,
  onDone,
}: {
  campusId: string;
  year?: AcademicYear;
  suggestion: { name: string; startsOn: string; endsOn: string };
  onDone: () => void;
}) {
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const offs = new Set(year?.weeklyOffDays ?? [0]);
  const sats = new Set(year?.saturdayOffWeeks ?? []);

  const submit = async (form: FormData) => {
    const body = {
      name: form.get('name'),
      startsOn: form.get('startsOn'),
      endsOn: form.get('endsOn'),
      weeklyOffDays: form.getAll('weeklyOffDays').map(Number),
      saturdayOffWeeks: form.getAll('saturdayOffWeeks').map(Number),
    };
    const ok = await run(() =>
      year
        ? patch(`/academic-years/${year.id}`, body)
        : post('/academic-years', { ...body, campusId }),
    );
    if (ok) onDone();
  };

  return (
    <form onSubmit={onSubmitForm(submit)} className="grid gap-4 sm:grid-cols-3">
      {error && (
        <div className="sm:col-span-3">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field
        label="Name"
        name="name"
        defaultValue={year?.name ?? suggestion.name}
        hint="e.g. 2026-27"
        error={f.name}
        required
      />
      <Field
        label="Starts on"
        name="startsOn"
        type="date"
        defaultValue={year?.startsOn ?? suggestion.startsOn}
        error={f.startsOn}
        required
      />
      <Field
        label="Ends on"
        name="endsOn"
        type="date"
        defaultValue={year?.endsOn ?? suggestion.endsOn}
        error={f.endsOn}
        required
      />
      <fieldset className="sm:col-span-3">
        <legend className="text-sm font-medium text-slate-800">Weekly off</legend>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {WEEKDAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="weeklyOffDays" value={i} defaultChecked={offs.has(i)} />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="sm:col-span-3">
        <legend className="text-sm font-medium text-slate-800">Saturdays off each month</legend>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {SATURDAYS.map(([n, label]) => (
            <label key={n} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="saturdayOffWeeks"
                value={n}
                defaultChecked={sats.has(n)}
              />
              {label} Saturday
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Used to count working days for attendance. Add holidays in the calendar.
        </p>
      </fieldset>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" loading={pending}>
          {year ? 'Save year' : 'Add year'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Terms({ year, manage }: { year: AcademicYear; manage: boolean }) {
  const { data, loading, error, reload } = useApi<Term[]>(`/academic-years/${year.id}/terms`);
  const add = useAction();
  const remove = useAction();
  const [adding, setAdding] = useState(false);
  const editable = manage && year.status !== 'closed';
  const f = add.error?.fields ?? {};

  const submit = async (form: FormData) => {
    const ok = await add.run(() =>
      post(`/academic-years/${year.id}/terms`, {
        name: form.get('name'),
        startsOn: form.get('startsOn'),
        endsOn: form.get('endsOn'),
      }),
    );
    if (ok) {
      setAdding(false);
      void reload();
    }
  };

  if (loading && !data) return <Skeleton rows={2} />;
  if (error) return <Alert>{error.message}</Alert>;

  return (
    <div className="space-y-3">
      {remove.error && <Alert>{remove.error.message}</Alert>}
      {data?.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {data.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{t.name}</span>
                <span className="ml-2 text-slate-500">{formatRange(t.startsOn, t.endsOn)}</span>
              </span>
              {editable && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(`Delete ${t.name}?`)) return;
                    await remove.run(() => del(`/terms/${t.id}`));
                    void reload();
                  }}
                >
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">
          No terms yet. Terms are used for exams and report cards.
        </p>
      )}
      {editable &&
        (adding ? (
          <form onSubmit={onSubmitForm(submit)} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            {add.error && !Object.keys(f).length && (
              <div className="sm:col-span-4">
                <Alert>{add.error.message}</Alert>
              </div>
            )}
            <Field
              label="Term name"
              name="name"
              defaultValue={`Term ${(data?.length ?? 0) + 1}`}
              error={f.name}
              required
            />
            <Field
              label="Starts on"
              name="startsOn"
              type="date"
              min={year.startsOn}
              max={year.endsOn}
              error={f.startsOn}
              required
            />
            <Field
              label="Ends on"
              name="endsOn"
              type="date"
              min={year.startsOn}
              max={year.endsOn}
              error={f.endsOn}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" loading={add.pending}>
                Add
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add term
          </Button>
        ))}
    </div>
  );
}

const statusTone = { planned: 'neutral', active: 'green', closed: 'amber' } as const;

export default function AcademicYearsPage() {
  const { can } = useSession();
  const { campus, picker, loading: campusLoading } = useCampus();
  const manage = campus ? can('academic.manage', campus.id) : false;
  const path = campus ? `/academic-years?campusId=${campus.id}` : null;
  const { data, loading, error, reload } = useApi<AcademicYear[]>(path);
  const [editing, setEditing] = useState<AcademicYear | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const action = useAction();

  const done = () => {
    setEditing(null);
    void reload();
  };
  const act = async (fn: () => Promise<unknown>) => {
    await action.run(fn);
    void reload();
  };

  return (
    <>
      <PageHeader
        title="Academic years"
        description="Each campus runs one current year. Closing a year locks its classes, sections and records."
        actions={
          manage &&
          campus &&
          !editing && <Button onClick={() => setEditing('new')}>Add academic year</Button>
        }
      />
      {picker && <div className="mb-4">{picker}</div>}
      {campus && editing && (
        <Card
          title={editing === 'new' ? `New academic year · ${campus.name}` : `Edit ${editing.name}`}
          className="mb-6"
        >
          <YearForm
            campusId={campus.id}
            year={editing === 'new' ? undefined : editing}
            suggestion={suggestYear(data ?? [])}
            onDone={done}
          />
        </Card>
      )}
      {action.error && (
        <div className="mb-4">
          <Alert>{action.error.message}</Alert>
        </div>
      )}
      <Card>
        {campusLoading || (loading && !data) ? (
          <Skeleton />
        ) : !campus ? (
          <EmptyState title="No active campus" />
        ) : error ? (
          <Alert>{error.message}</Alert>
        ) : !data?.length ? (
          <EmptyState title="No academic years yet">
            Add the current session (for most schools, April to March) to start setting up classes.
          </EmptyState>
        ) : (
          <Table head={['Year', 'Dates', 'Weekly off', 'Status', '']}>
            {data.map((y) => (
              <YearRow
                key={y.id}
                year={y}
                manage={manage}
                open={open === y.id}
                onToggle={() => setOpen(open === y.id ? null : y.id)}
                onEdit={() => setEditing(y)}
                act={act}
              />
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function YearRow({
  year: y,
  manage,
  open,
  onToggle,
  onEdit,
  act,
}: {
  year: AcademicYear;
  manage: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const offs = [
    ...y.weeklyOffDays.map((d) => WEEKDAYS[d]!.slice(0, 3)),
    ...(y.saturdayOffWeeks.length
      ? [
          `${y.saturdayOffWeeks.map((n) => `${n}${['st', 'nd', 'rd', 'th', 'th'][n - 1]}`).join(' & ')} Sat`,
        ]
      : []),
  ];
  return (
    <>
      <tr>
        <Td>
          <button onClick={onToggle} className="text-left" aria-expanded={open}>
            <span className="font-medium text-brand-700 hover:underline">{y.name}</span>
            {y.isCurrent && (
              <span className="ml-2">
                <Badge tone="blue">Current</Badge>
              </span>
            )}
          </button>
        </Td>
        <Td>
          {formatDate(y.startsOn)} – {formatDate(y.endsOn)}
        </Td>
        <Td>{offs.join(', ') || 'None'}</Td>
        <Td>
          <Badge tone={statusTone[y.status]}>{y.status}</Badge>
        </Td>
        <Td className="text-right">
          {manage && (
            <div className="flex flex-wrap justify-end gap-1">
              {!y.isCurrent && y.status !== 'closed' && (
                <Button
                  variant="ghost"
                  onClick={() => act(() => post(`/academic-years/${y.id}/make-current`))}
                >
                  Make current
                </Button>
              )}
              {y.status !== 'closed' && (
                <Button variant="ghost" onClick={onEdit}>
                  Edit
                </Button>
              )}
              {y.status === 'active' && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (
                      confirm(
                        `Close ${y.name}? Its classes, sections and records become read-only until it is reopened.`,
                      )
                    )
                      void act(() => post(`/academic-years/${y.id}/status`, { status: 'closed' }));
                  }}
                >
                  Close year
                </Button>
              )}
              {y.status === 'closed' && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    act(() => post(`/academic-years/${y.id}/status`, { status: 'active' }))
                  }
                >
                  Reopen
                </Button>
              )}
              {y.status === 'planned' && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Delete ${y.name}?`))
                      void act(() => del(`/academic-years/${y.id}`));
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          )}
        </Td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="bg-slate-50 px-4 py-4">
            <h3 className="mb-2 text-sm font-semibold">Terms</h3>
            <Terms year={y} manage={manage} />
          </td>
        </tr>
      )}
    </>
  );
}
