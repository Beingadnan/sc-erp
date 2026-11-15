'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { put } from '@/lib/api';
import type { PeriodSlot, SectionTimetable } from '@/lib/api';
import { useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { Alert, Button, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Grid {
  canManage: boolean;
  classes: Array<{
    gradeLevelId: string;
    name: string;
    sections: Array<{ id: string; name: string }>;
  }>;
  teachers: Array<{ membershipId: string; fullName: string }>;
}

type DraftSlot = Omit<PeriodSlot, 'id'> & { id?: string };

/** A typical CBSE day: 8 periods with a short break and lunch. */
const STARTER: DraftSlot[] = [
  ['Period 1', '08:00', '08:40'],
  ['Period 2', '08:40', '09:20'],
  ['Period 3', '09:20', '10:00'],
  ['Short break', '10:00', '10:15', true],
  ['Period 4', '10:15', '10:55'],
  ['Period 5', '10:55', '11:35'],
  ['Lunch', '11:35', '12:05', true],
  ['Period 6', '12:05', '12:45'],
  ['Period 7', '12:45', '13:25'],
  ['Period 8', '13:25', '14:05'],
].map(([label, startsAt, endsAt, isBreak]) => ({
  label: label as string,
  startsAt: startsAt as string,
  endsAt: endsAt as string,
  isBreak: Boolean(isBreak),
}));

export default function TimetablePage() {
  const { campus, picker } = useCampus();
  const bell = useApi<{ canManage: boolean; slots: PeriodSlot[] }>(
    campus ? `/timetable/slots?campusId=${campus.id}` : null,
  );
  const grid = useApi<Grid>(campus ? `/teaching/grid?campusId=${campus.id}` : null);
  const [sectionId, setSectionId] = useState('');
  const [editBell, setEditBell] = useState(false);

  const sections = (grid.data?.classes ?? []).flatMap((c) =>
    c.sections.map((s) => ({ id: s.id, label: `${c.name} ${s.name}` })),
  );
  useEffect(() => {
    if (!sectionId && sections[0]) setSectionId(sections[0].id);
  }, [sections, sectionId]);

  const noBell = bell.data && !bell.data.slots.length;

  return (
    <>
      <PageHeader
        title="Timetable"
        description="Set the school bell once, then fill each class's week. Teachers see their periods on their Today page."
        actions={picker}
      />
      {(bell.error || grid.error) && (
        <div className="mb-4">
          <Alert>{(bell.error ?? grid.error)!.message}</Alert>
        </div>
      )}
      {!bell.data || !grid.data ? (
        <Skeleton rows={6} />
      ) : editBell || noBell ? (
        <BellEditor
          campusId={campus!.id}
          slots={bell.data.slots}
          canManage={bell.data.canManage}
          onDone={() => {
            setEditBell(false);
            void bell.reload();
          }}
          onCancel={noBell ? undefined : () => setEditBell(false)}
        />
      ) : !sections.length ? (
        <EmptyState title="No sections yet">
          Add classes and sections in{' '}
          <Link className="underline" href="/academics/classes">
            Classes &amp; sections
          </Link>
          .
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
              Class
              <select
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                className="h-9 min-w-40 rounded-lg border border-slate-300 bg-white px-3 text-sm"
              >
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-sm text-slate-500">
              Bell: {bell.data.slots.filter((s) => !s.isBreak).length} periods,{' '}
              {bell.data.slots[0]?.startsAt}–{bell.data.slots.at(-1)?.endsAt}
            </span>
            {bell.data.canManage && (
              <Button variant="ghost" onClick={() => setEditBell(true)}>
                Change bell
              </Button>
            )}
          </div>
          {sectionId && (
            <WeekGrid key={sectionId} sectionId={sectionId} teachers={grid.data.teachers} />
          )}
        </div>
      )}
    </>
  );
}

function BellEditor({
  campusId,
  slots,
  canManage,
  onDone,
  onCancel,
}: {
  campusId: string;
  slots: PeriodSlot[];
  canManage: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [rows, setRows] = useState<DraftSlot[]>(slots.length ? slots : STARTER);
  const act = useAction();
  const set = (i: number, patch: Partial<DraftSlot>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    const ok = await act.run(() =>
      put('/timetable/slots', {
        campusId,
        slots: rows.map(({ id, label, startsAt, endsAt, isBreak }) => ({
          ...(id ? { id } : {}),
          label,
          startsAt,
          endsAt,
          isBreak,
        })),
      }),
    );
    if (ok) onDone();
  };

  return (
    <Card
      title="School bell"
      description={
        slots.length
          ? 'Removing a period also clears it from every class timetable.'
          : 'Start from a usual day and change the times to match your school.'
      }
    >
      {act.error && (
        <div className="mb-3">
          <Alert>{act.error.message}</Alert>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={r.id ?? `n${i}`} className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Name"
              value={r.label}
              disabled={!canManage}
              onChange={(e) => set(i, { label: e.target.value })}
              className="h-9 w-36 rounded-lg border border-slate-300 px-3 text-sm"
            />
            <input
              aria-label="Starts"
              type="time"
              value={r.startsAt}
              disabled={!canManage}
              onChange={(e) => set(i, { startsAt: e.target.value })}
              className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
            />
            <span className="text-slate-400">to</span>
            <input
              aria-label="Ends"
              type="time"
              value={r.endsAt}
              disabled={!canManage}
              onChange={(e) => set(i, { endsAt: e.target.value })}
              className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
            />
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={r.isBreak}
                disabled={!canManage}
                onChange={(e) => set(i, { isBreak: e.target.checked })}
              />
              Break
            </label>
            {canManage && (
              <button
                type="button"
                className="text-sm text-red-600 hover:underline"
                onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              const last = rows.at(-1);
              setRows((r) => [
                ...r,
                {
                  label: `Period ${r.filter((x) => !x.isBreak).length + 1}`,
                  startsAt: last?.endsAt ?? '08:00',
                  endsAt: addMinutes(last?.endsAt ?? '08:00', 40),
                  isBreak: false,
                },
              ]);
            }}
          >
            Add period
          </Button>
          <Button onClick={save} loading={act.pending}>
            Save bell
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function addMinutes(hhmm: string, m: number) {
  const [h, mm] = hhmm.split(':').map(Number) as [number, number];
  const t = Math.min(h * 60 + mm + m, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function WeekGrid({ sectionId, teachers }: { sectionId: string; teachers: Grid['teachers'] }) {
  const tt = useApi<SectionTimetable>(`/timetable/sections/${sectionId}`);
  const act = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const d = tt.data;
  if (tt.error) return <Alert>{tt.error.message}</Alert>;
  if (!d) return <Skeleton rows={8} />;

  const cell = (weekday: number, slotId: string) =>
    d.entries.find((e) => e.weekday === weekday && e.slotId === slotId);

  const save = async (
    weekday: number,
    slotId: string,
    subjectId: string | null,
    membershipId: string | null = null,
  ) => {
    const ok = await act.run(() =>
      put(`/timetable/sections/${sectionId}/cell`, { weekday, slotId, subjectId, membershipId }),
    );
    if (ok) {
      setEditing(null);
      void tt.reload();
    }
  };

  return (
    <Card>
      {act.error && (
        <div className="mb-3">
          <Alert>{act.error.message}</Alert>
        </div>
      )}
      {!d.subjects.length && (
        <div className="mb-3">
          <Alert tone="info">
            This class has no subjects yet. Add them in Classes &amp; sections.
          </Alert>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-28 p-2 text-left font-medium text-slate-500">Period</th>
              {DAYS.map((day) => (
                <th key={day} className="p-2 text-left font-medium text-slate-500">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.slots.map((s) =>
              s.isBreak ? (
                <tr key={s.id}>
                  <td className="p-2 text-xs text-slate-500">{s.startsAt}</td>
                  <td colSpan={6} className="bg-slate-50 p-1.5 text-center text-xs text-slate-500">
                    {s.label}
                  </td>
                </tr>
              ) : (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="p-2 align-top">
                    <div className="font-medium">{s.label}</div>
                    <div className="text-xs text-slate-500">
                      {s.startsAt}–{s.endsAt}
                    </div>
                  </td>
                  {DAYS.map((_, i) => {
                    const wd = i + 1;
                    const e = cell(wd, s.id);
                    const key = `${wd}:${s.id}`;
                    if (editing === key && d.canManage) {
                      return (
                        <td key={key} className="p-1 align-top">
                          <CellEditor
                            subjects={d.subjects}
                            teachers={teachers}
                            current={e}
                            pending={act.pending}
                            onSave={(sub, t) => save(wd, s.id, sub, t)}
                            onCancel={() => setEditing(null)}
                          />
                        </td>
                      );
                    }
                    return (
                      <td key={key} className="p-1 align-top">
                        <button
                          type="button"
                          disabled={!d.canManage}
                          onClick={() => setEditing(key)}
                          className={`flex min-h-12 w-full flex-col rounded-md border px-2 py-1 text-left ${
                            e
                              ? 'border-slate-200 bg-white hover:border-brand-300'
                              : 'border-dashed border-slate-200 text-slate-400 hover:border-brand-300'
                          }`}
                        >
                          {e ? (
                            <>
                              <span className="font-medium text-slate-900">{e.subjectName}</span>
                              <span className="text-xs text-slate-500">
                                {e.teacherName ?? 'No teacher'}
                              </span>
                            </>
                          ) : (
                            d.canManage && <span className="text-xs">+ Add</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CellEditor({
  subjects,
  teachers,
  current,
  pending,
  onSave,
  onCancel,
}: {
  subjects: SectionTimetable['subjects'];
  teachers: Grid['teachers'];
  current: SectionTimetable['entries'][number] | undefined;
  pending: boolean;
  onSave: (subjectId: string | null, membershipId: string | null) => void;
  onCancel: () => void;
}) {
  const [subjectId, setSubjectId] = useState(current?.subjectId ?? '');
  const defaultTeacher = (id: string) => subjects.find((s) => s.id === id)?.teacherId ?? '';
  const [teacher, setTeacher] = useState(current?.membershipId ?? defaultTeacher(subjectId));
  return (
    <div className="flex flex-col gap-1 rounded-md border border-brand-300 bg-brand-50/40 p-1.5">
      <select
        aria-label="Subject"
        autoFocus
        value={subjectId}
        onChange={(e) => {
          setSubjectId(e.target.value);
          setTeacher(defaultTeacher(e.target.value));
        }}
        className="rounded border border-slate-300 bg-white px-1.5 py-1 text-sm"
      >
        <option value="">— free —</option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {subjectId && (
        <select
          aria-label="Teacher"
          value={teacher}
          onChange={(e) => setTeacher(e.target.value)}
          className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
        >
          <option value="">— no teacher —</option>
          {teachers.map((t) => (
            <option key={t.membershipId} value={t.membershipId}>
              {t.fullName}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => onSave(subjectId || null, subjectId ? teacher || null : null)}
          className="rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white"
        >
          Save
        </button>
        <button type="button" onClick={onCancel} className="px-1 text-xs text-slate-600">
          Cancel
        </button>
      </div>
    </div>
  );
}
