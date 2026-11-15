'use client';

import { useState } from 'react';
import { put } from '@/lib/api';
import type { TeacherDay } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { Alert, Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Morning job in the office: a teacher is absent, give each of their periods to someone free. */
export default function SubstitutionsPage() {
  const { campus, picker } = useCampus();
  const grid = useApi<{ teachers: Array<{ membershipId: string; fullName: string }> }>(
    campus ? `/teaching/grid?campusId=${campus.id}` : null,
  );
  const [date, setDate] = useState(today);
  const [absent, setAbsent] = useState('');
  const day = useApi<TeacherDay>(
    campus && absent
      ? `/timetable/teachers/${absent}/day?campusId=${campus.id}&date=${date}`
      : null,
  );
  const act = useAction();
  const [saved, setSaved] = useState<string | null>(null);

  const choose = async (entryId: string, substituteMembershipId: string) => {
    const ok = await act.run(() =>
      put('/timetable/substitutions', {
        onDate: date,
        entryId,
        substituteMembershipId: substituteMembershipId || null,
      }),
    );
    if (ok) {
      setSaved(entryId);
      void day.reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Substitutions"
        description="Pick the absent teacher. Each of their periods lists only teachers who are free then."
        actions={picker}
      />
      {(grid.error || act.error || day.error) && (
        <div className="mb-4">
          <Alert>{(act.error ?? day.error ?? grid.error)!.message}</Alert>
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
            Absent teacher
            <select
              value={absent}
              onChange={(e) => setAbsent(e.target.value)}
              className="h-9 min-w-56 rounded-lg border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="">Choose…</option>
              {grid.data?.teachers.map((t) => (
                <option key={t.membershipId} value={t.membershipId}>
                  {t.fullName}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>
      <div className="mt-4">
        {!absent ? null : !day.data ? (
          <Skeleton rows={5} />
        ) : !day.data.periods.length ? (
          <EmptyState title="No periods">
            This teacher has no periods on {formatDate(day.data.date)}. Fill the timetable first if
            this looks wrong.
          </EmptyState>
        ) : (
          <Card title={`Periods on ${formatDate(day.data.date)}`}>
            <ul className="divide-y divide-slate-100">
              {day.data.periods.map((p) => (
                <li key={p.entryId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="w-40">
                    <div className="font-medium">{p.label}</div>
                    <div className="text-xs text-slate-500">
                      {p.startsAt}–{p.endsAt}
                    </div>
                  </div>
                  <div className="min-w-40 flex-1">
                    <div>
                      {p.className} {p.sectionName}
                    </div>
                    <div className="text-xs text-slate-500">{p.subjectName}</div>
                  </div>
                  <select
                    aria-label={`Substitute for ${p.label}`}
                    disabled={act.pending}
                    value={
                      p.freeTeachers.find((f) => f.fullName === p.coveredBy)?.membershipId ??
                      (p.coveredBy ? '__current' : '')
                    }
                    onChange={(e) => {
                      if (e.target.value !== '__current') void choose(p.entryId, e.target.value);
                    }}
                    className={`h-9 min-w-56 rounded-lg border px-3 text-sm ${
                      p.coveredBy ? 'border-emerald-300 bg-emerald-50' : 'border-slate-300 bg-white'
                    } ${saved === p.entryId ? 'ring-2 ring-emerald-300' : ''}`}
                  >
                    <option value="">— no substitute —</option>
                    {p.coveredBy && !p.freeTeachers.some((f) => f.fullName === p.coveredBy) && (
                      <option value="__current">{p.coveredBy}</option>
                    )}
                    {p.freeTeachers.map((f) => (
                      <option key={f.membershipId} value={f.membershipId}>
                        {f.fullName}
                      </option>
                    ))}
                  </select>
                  {p.coveredBy ? (
                    <Badge tone="green">Covered</Badge>
                  ) : (
                    <Badge tone="amber">Needs cover</Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
