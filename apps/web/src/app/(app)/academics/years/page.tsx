'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  CalendarRange,
  ChevronRight,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { del, patch, post } from '@/lib/api';
import type { AcademicYear, Term } from '@/lib/api';
import { formatDate, formatRange, WEEKDAYS } from '@/lib/format';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import {
  ActionMenu,
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SectionTitle,
  Skeleton,
  Td,
  confirmAction,
  cx,
  toast,
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

/** Toggle chip backed by a real checkbox so FormData still works. */
function ChipCheckbox({
  name,
  value,
  defaultChecked,
  children,
}: {
  name: string;
  value: number;
  defaultChecked: boolean;
  children: ReactNode;
}) {
  return (
    <label className="cursor-pointer">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span
        className={cx(
          'inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-[13px] text-slate-700 transition-colors select-none',
          'peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-checked:font-medium peer-checked:text-brand-700',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600',
          'hover:border-slate-400',
        )}
      >
        {children}
      </span>
    </label>
  );
}

function YearModal({
  target,
  campusId,
  campusName,
  suggestion,
  onClose,
  onSaved,
}: {
  target: AcademicYear | 'new' | null;
  campusId: string;
  campusName: string;
  suggestion: { name: string; startsOn: string; endsOn: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pending, error, run, setError } = useAction();
  const f = error?.fields ?? {};
  const year = target && target !== 'new' ? target : undefined;
  const offs = new Set(year?.weeklyOffDays ?? [0]);
  const sats = new Set(year?.saturdayOffWeeks ?? []);
  useEffect(() => {
    if (target) setError(null);
  }, [target, setError]);

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
    if (ok) {
      toast.success(year ? 'Academic year updated.' : 'Academic year added.');
      onSaved();
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      size="lg"
      title={year ? `Edit ${year.name}` : 'Add academic year'}
      description={year ? undefined : campusName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="year-form" loading={pending}>
            {year ? 'Save changes' : 'Add year'}
          </Button>
        </>
      }
    >
      <form
        id="year-form"
        key={year?.id ?? 'new'}
        onSubmit={onSubmitForm(submit)}
        className="space-y-5"
      >
        {error && !Object.keys(f).length && <Alert>{error.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
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
        </div>
        <fieldset>
          <legend className="text-[13px] font-medium text-slate-700">Weekly off days</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => (
              <ChipCheckbox key={d} name="weeklyOffDays" value={i} defaultChecked={offs.has(i)}>
                {d.slice(0, 3)}
              </ChipCheckbox>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-[13px] font-medium text-slate-700">
            Saturdays off each month
          </legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SATURDAYS.map(([n, label]) => (
              <ChipCheckbox key={n} name="saturdayOffWeeks" value={n} defaultChecked={sats.has(n)}>
                {label} Sat
              </ChipCheckbox>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Used to count working days for attendance. Add holidays in the calendar.
          </p>
        </fieldset>
      </form>
    </Modal>
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
      toast.success('Term added.');
      void reload();
    }
  };

  return (
    <div className="bg-slate-50/60 px-5 py-4">
      <SectionTitle
        actions={
          editable &&
          !adding && (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
              Add term
            </Button>
          )
        }
      >
        Terms
      </SectionTitle>
      {loading && !data ? (
        <Skeleton rows={2} />
      ) : error ? (
        <Alert>{error.message}</Alert>
      ) : (
        <div className="space-y-3">
          {remove.error && <Alert>{remove.error.message}</Alert>}
          {data?.length ? (
            <ul className="max-w-2xl divide-y divide-slate-100 overflow-hidden rounded-lg border border-line bg-white">
              {data.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{t.name}</span>
                    <span className="ml-2 text-slate-500">{formatRange(t.startsOn, t.endsOn)}</span>
                  </span>
                  {editable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      aria-label={`Delete ${t.name}`}
                      onClick={async () => {
                        if (
                          !(await confirmAction({
                            title: `Delete ${t.name}?`,
                            confirmLabel: 'Delete term',
                          }))
                        )
                          return;
                        if (await remove.run(() => del(`/terms/${t.id}`)))
                          toast.success(`${t.name} deleted.`);
                        void reload();
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            !adding && (
              <p className="text-sm text-slate-500">
                No terms yet. Terms are used for exams and report cards.
              </p>
            )
          )}
          {editable && adding && (
            <form
              onSubmit={onSubmitForm(submit)}
              className="grid max-w-3xl gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
            >
              {add.error && !Object.keys(f).length && (
                <Alert className="sm:col-span-4">{add.error.message}</Alert>
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
                <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={add.pending}>
                  Add
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_TONE = { planned: 'neutral', active: 'green', closed: 'amber' } as const;
const STATUS_LABEL = { planned: 'Planned', active: 'Active', closed: 'Closed' } as const;

export default function AcademicYearsPage() {
  const { can } = useSession();
  const { campus, picker, loading: campusLoading } = useCampus();
  const manage = campus ? can('academic.manage', campus.id) : false;
  const path = campus ? `/academic-years?campusId=${campus.id}` : null;
  const { data, loading, error, reload } = useApi<AcademicYear[]>(path);
  const [editing, setEditing] = useState<AcademicYear | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const action = useAction();

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    if ((await action.run(fn)) && done) toast.success(done);
    void reload();
  };

  return (
    <>
      <PageHeader
        title="Academic Years"
        description="Each campus runs one current session. Closing a year locks its classes, sections and records."
        actions={
          manage &&
          campus && (
            <Button icon={Plus} onClick={() => setEditing('new')}>
              Add academic year
            </Button>
          )
        }
      />
      {picker && <div className="mb-4 w-64">{picker}</div>}
      {action.error && <Alert className="mb-4">{action.error.message}</Alert>}
      <Card flush>
        {campusLoading || (loading && !data) ? (
          <div className="p-5">
            <Skeleton />
          </div>
        ) : !campus ? (
          <EmptyState icon={CalendarRange} title="No active campus">
            Add a campus first.
          </EmptyState>
        ) : error ? (
          <div className="p-5">
            <Alert>{error.message}</Alert>
          </div>
        ) : !data?.length ? (
          <EmptyState
            icon={CalendarRange}
            title="No academic years yet"
            action={
              manage && (
                <Button icon={Plus} onClick={() => setEditing('new')}>
                  Add academic year
                </Button>
              )
            }
          >
            Add the current session (for most schools, April to March) to start setting up classes.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50/70 text-xs text-slate-500">
                  <th scope="col" className="w-10 py-2.5 pl-5">
                    <span className="sr-only">Expand</span>
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Session
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Dates
                  </th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
                    Weekly off
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2.5 pr-5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
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
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {campus && (
        <YearModal
          target={editing}
          campusId={campus.id}
          campusName={campus.name}
          suggestion={suggestYear(data ?? [])}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
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
  act: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
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
      <tr
        className={cx(
          'cursor-pointer transition-colors hover:bg-slate-50/70',
          open && 'bg-slate-50/70',
        )}
        onClick={onToggle}
      >
        <td className="py-3 pl-5">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} terms for ${y.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
          >
            <ChevronRight
              className={cx('size-4 transition-transform', open && 'rotate-90')}
              aria-hidden
            />
          </button>
        </td>
        <Td>
          <span className="flex items-center gap-2 font-medium text-ink">
            {y.name}
            {y.isCurrent && <Badge tone="blue">Current</Badge>}
          </span>
        </Td>
        <Td className="whitespace-nowrap text-slate-600">
          {formatDate(y.startsOn)} – {formatDate(y.endsOn)}
        </Td>
        <Td className="hidden text-slate-600 md:table-cell">{offs.join(', ') || 'None'}</Td>
        <Td>
          <Badge dot tone={STATUS_TONE[y.status]}>
            {STATUS_LABEL[y.status]}
          </Badge>
        </Td>
        <td className="py-2 pr-5 text-right" onClick={(e) => e.stopPropagation()}>
          {manage && (
            <ActionMenu
              label={`Actions for ${y.name}`}
              items={[
                {
                  label: 'Make current',
                  icon: Star,
                  hidden: y.isCurrent || y.status === 'closed',
                  onClick: () =>
                    void act(
                      () => post(`/academic-years/${y.id}/make-current`),
                      `${y.name} is now current.`,
                    ),
                },
                { label: 'Edit', icon: Pencil, hidden: y.status === 'closed', onClick: onEdit },
                {
                  label: 'Close year',
                  icon: Lock,
                  hidden: y.status !== 'active',
                  onClick: async () => {
                    if (
                      await confirmAction({
                        title: `Close ${y.name}?`,
                        message:
                          'Its classes, sections and records become read-only until it is reopened.',
                        confirmLabel: 'Close year',
                      })
                    )
                      void act(
                        () => post(`/academic-years/${y.id}/status`, { status: 'closed' }),
                        `${y.name} closed.`,
                      );
                  },
                },
                {
                  label: 'Reopen',
                  icon: LockOpen,
                  hidden: y.status !== 'closed',
                  onClick: () =>
                    void act(
                      () => post(`/academic-years/${y.id}/status`, { status: 'active' }),
                      `${y.name} reopened.`,
                    ),
                },
                {
                  label: 'Delete',
                  icon: Trash2,
                  danger: true,
                  hidden: y.status !== 'planned',
                  onClick: async () => {
                    if (
                      await confirmAction({
                        title: `Delete ${y.name}?`,
                        confirmLabel: 'Delete year',
                      })
                    )
                      void act(() => del(`/academic-years/${y.id}`), `${y.name} deleted.`);
                  },
                },
              ]}
            />
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="p-0">
            <Terms year={y} manage={manage} />
          </td>
        </tr>
      )}
    </>
  );
}
