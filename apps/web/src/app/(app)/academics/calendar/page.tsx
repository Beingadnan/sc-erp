'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { del, patch, post } from '@/lib/api';
import type { CalendarEntry, CalendarKind, WorkingDays } from '@/lib/api';
import { blank, formatRange } from '@/lib/format';
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
  SelectField,
  Skeleton,
  confirmAction,
} from '@/components/ui';

const KINDS: Record<CalendarKind, { label: string; tone: 'red' | 'amber' | 'blue' | 'neutral' }> = {
  holiday: { label: 'Holiday', tone: 'red' },
  vacation: { label: 'Vacation', tone: 'amber' },
  exam: { label: 'Exam', tone: 'blue' },
  event: { label: 'Event', tone: 'neutral' },
};

const pad = (n: number) => String(n).padStart(2, '0');
const monthBounds = (y: number, m: number) => ({
  from: `${y}-${pad(m + 1)}-01`,
  to: `${y}-${pad(m + 1)}-${pad(new Date(Date.UTC(y, m + 1, 0)).getUTCDate())}`,
});
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function EntryForm({
  campusId,
  campusName,
  entry,
  defaultDate,
  allowAllCampuses,
  onDone,
}: {
  campusId: string;
  campusName: string;
  entry?: CalendarEntry;
  defaultDate: string;
  allowAllCampuses: boolean;
  onDone: () => void;
}) {
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const submit = async (form: FormData) => {
    const body = {
      title: form.get('title'),
      kind: form.get('kind'),
      startsOn: form.get('startsOn'),
      endsOn: blank(form.get('endsOn')) ?? form.get('startsOn'),
      description: String(form.get('description') ?? ''),
      campusId: form.get('scope') === 'all' ? null : campusId,
    };
    const ok = await run(() =>
      entry ? patch(`/calendar/${entry.id}`, body) : post('/calendar', body),
    );
    if (ok) onDone();
  };
  return (
    <form onSubmit={onSubmitForm(submit)} className="grid gap-4 sm:grid-cols-3">
      {error && !Object.keys(f).length && (
        <div className="sm:col-span-3">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field
        label="Title"
        name="title"
        defaultValue={entry?.title}
        error={f.title}
        required
        className="sm:col-span-2"
      />
      <SelectField label="Type" name="kind" defaultValue={entry?.kind ?? 'holiday'}>
        {Object.entries(KINDS).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </SelectField>
      <Field
        label="From"
        name="startsOn"
        type="date"
        defaultValue={entry?.startsOn ?? defaultDate}
        error={f.startsOn}
        required
      />
      <Field
        label="To"
        name="endsOn"
        type="date"
        defaultValue={entry?.endsOn ?? ''}
        hint="Leave empty for a single day"
        error={f.endsOn}
      />
      <SelectField
        label="Applies to"
        name="scope"
        defaultValue={entry ? (entry.campusId === null ? 'all' : 'campus') : 'campus'}
      >
        <option value="campus">{campusName}</option>
        {allowAllCampuses && <option value="all">All campuses</option>}
      </SelectField>
      <Field
        label="Notes"
        name="description"
        defaultValue={entry?.description ?? ''}
        error={f.description}
        className="sm:col-span-3"
      />
      <p className="text-xs text-slate-500 sm:col-span-3">
        Holidays and vacations are non-working days for attendance. Exams and events are for
        information.
      </p>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" loading={pending}>
          {entry ? 'Save' : 'Add to calendar'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function CalendarPage() {
  const { can, canEverywhere } = useSession();
  const { campus, picker, loading: campusLoading } = useCampus();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const { from, to } = monthBounds(ym.y, ym.m);
  const q = campus ? `campusId=${campus.id}&from=${from}&to=${to}` : null;
  const entries = useApi<CalendarEntry[]>(q && `/calendar?${q}`);
  const days = useApi<WorkingDays>(q && `/calendar/working-days?${q}`);
  const [editing, setEditing] = useState<CalendarEntry | 'new' | null>(null);
  const remove = useAction();
  const manageCampus = campus ? can('calendar.manage', campus.id) : false;
  const manageAll = canEverywhere('calendar.manage');
  const canEdit = (e: CalendarEntry) => (e.campusId === null ? manageAll : manageCampus);

  const monthLabel = new Date(Date.UTC(ym.y, ym.m, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const shift = (d: number) =>
    setYm(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 }));

  const reload = () => {
    setEditing(null);
    void entries.reload();
    void days.reload();
  };

  const grid = useMemo(() => {
    if (!days.data) return [];
    const lead = new Date(`${from}T00:00:00Z`).getUTCDay();
    return [...Array<null>(lead).fill(null), ...days.data.days];
  }, [days.data, from]);

  const outsideYear = days.data?.days.every((d) => d.reason === 'outside_year');

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Holidays, vacations, exams and events. Working days are counted from the academic year's weekly offs and holidays."
        actions={
          (manageCampus || manageAll) &&
          campus &&
          !editing && (
            <Button onClick={() => setEditing('new')} icon={Plus}>
              Add entry
            </Button>
          )
        }
      />
      {picker && <div className="mb-4">{picker}</div>}
      {campus && editing && (
        <Card
          title={editing === 'new' ? 'New calendar entry' : `Edit ${editing.title}`}
          className="mb-6"
        >
          <EntryForm
            campusId={campus.id}
            campusName={campus.name}
            entry={editing === 'new' ? undefined : editing}
            defaultDate={from}
            allowAllCampuses={manageAll}
            onDone={reload}
          />
        </Card>
      )}
      {remove.error && (
        <div className="mb-4">
          <Alert>{remove.error.message}</Alert>
        </div>
      )}
      {campusLoading ? (
        <Card>
          <Skeleton />
        </Card>
      ) : !campus ? (
        <Card>
          <EmptyState title="No active campus" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <Card
            title={monthLabel}
            description={
              days.data
                ? outsideYear
                  ? 'No academic year covers this month.'
                  : `${days.data.workingDays} working days`
                : undefined
            }
            actions={
              <div className="flex gap-1">
                <Button variant="secondary" aria-label="Previous month" onClick={() => shift(-1)}>
                  ←
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}
                >
                  Today
                </Button>
                <Button variant="secondary" aria-label="Next month" onClick={() => shift(1)}>
                  →
                </Button>
              </div>
            }
          >
            {days.loading && !days.data ? (
              <Skeleton rows={5} />
            ) : days.error ? (
              <Alert>{days.error.message}</Alert>
            ) : (
              <div className="grid grid-cols-7 gap-1 text-center text-xs">
                {WEEK.map((d) => (
                  <div key={d} className="pb-1 font-medium text-slate-500">
                    {d}
                  </div>
                ))}
                {grid.map((d, i) =>
                  d ? (
                    <div
                      key={d.date}
                      title={d.title ?? d.reason.replace('_', ' ')}
                      className={[
                        'flex h-12 flex-col items-center justify-center rounded-md border text-sm',
                        d.working
                          ? 'border-slate-200 bg-white'
                          : d.reason === 'holiday'
                            ? 'border-red-200 bg-red-50 text-red-800'
                            : 'border-slate-100 bg-slate-50 text-slate-400',
                      ].join(' ')}
                    >
                      {Number(d.date.slice(8))}
                      {d.reason === 'holiday' && (
                        <span className="max-w-full truncate px-1 text-[10px]">{d.title}</span>
                      )}
                    </div>
                  ) : (
                    <div key={`blank-${i}`} />
                  ),
                )}
              </div>
            )}
          </Card>
          <Card title="This month">
            {entries.loading && !entries.data ? (
              <Skeleton />
            ) : entries.error ? (
              <Alert>{entries.error.message}</Alert>
            ) : !entries.data?.length ? (
              <p className="text-sm text-slate-500">Nothing on the calendar this month.</p>
            ) : (
              <ul className="space-y-3">
                {entries.data.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{e.title}</p>
                        <p className="text-slate-500">{formatRange(e.startsOn, e.endsOn)}</p>
                        <div className="mt-1 flex gap-1">
                          <Badge tone={KINDS[e.kind].tone}>{KINDS[e.kind].label}</Badge>
                          {e.campusId === null && <Badge>All campuses</Badge>}
                        </div>
                      </div>
                      {canEdit(e) && (
                        <div className="flex shrink-0">
                          <Button variant="ghost" size="sm" onClick={() => setEditing(e)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              if (
                                !(await confirmAction({
                                  title: `Remove ${e.title}?`,
                                  confirmLabel: 'Remove',
                                }))
                              )
                                return;
                              await remove.run(() => del(`/calendar/${e.id}`));
                              reload();
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
