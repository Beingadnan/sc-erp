'use client';

import Link from 'next/link';
import { useState } from 'react';
import { patch, put } from '@/lib/api';
import { useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { Alert, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui';

interface Grid {
  year: { id: string; name: string; status: string };
  canManage: boolean;
  classes: Array<{
    gradeLevelId: string;
    name: string;
    sections: Array<{ id: string; name: string; students: number; classTeacherId: string | null }>;
    subjects: Array<{ id: string; name: string; code: string; isOptional: boolean }>;
  }>;
  assignments: Array<{ sectionId: string; subjectId: string; membershipId: string }>;
  teachers: Array<{
    membershipId: string;
    fullName: string;
    designation: string;
    classTeacherOf: number;
    periods: number;
  }>;
}

export default function TeachingPage() {
  const { campus, picker } = useCampus();
  const grid = useApi<Grid>(campus ? `/teaching/grid?campusId=${campus.id}` : null);
  const act = useAction();
  const [saved, setSaved] = useState<string | null>(null);
  const g = grid.data;

  const teacherOf = (sectionId: string, subjectId: string) =>
    g?.assignments.find((a) => a.sectionId === sectionId && a.subjectId === subjectId)
      ?.membershipId ?? '';

  const setCell = async (sectionId: string, subjectId: string, membershipId: string) => {
    const ok = await act.run(() =>
      put('/teaching/cell', {
        sectionId,
        subjectId,
        membershipIds: membershipId ? [membershipId] : [],
      }),
    );
    if (ok) {
      setSaved(`${sectionId}:${subjectId}`);
      void grid.reload();
    }
  };
  const setClassTeacher = async (sectionId: string, membershipId: string) => {
    const ok = await act.run(() =>
      patch(`/sections/${sectionId}`, { classTeacherMembershipId: membershipId || null }),
    );
    if (ok) {
      setSaved(`${sectionId}:ct`);
      void grid.reload();
    }
  };

  const select = (value: string, onChange: (v: string) => void, key: string, label: string) => (
    <select
      aria-label={label}
      value={value}
      disabled={!g?.canManage || act.pending}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full min-w-32 rounded-md border px-2 py-1.5 text-sm ${
        value
          ? 'border-slate-300 bg-white'
          : 'border-dashed border-slate-300 bg-slate-50 text-slate-400'
      } ${saved === key ? 'ring-2 ring-emerald-300' : ''}`}
    >
      <option value="">— nobody —</option>
      {g?.teachers.map((t) => (
        <option key={t.membershipId} value={t.membershipId}>
          {t.fullName}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader
        title="Who teaches what"
        description={`Pick the class teacher and a teacher for each subject. Teachers then see only these classes.${g ? ` Year ${g.year.name}.` : ''}`}
        actions={picker}
      />
      {(grid.error || act.error) && (
        <div className="mb-4">
          <Alert>{(act.error ?? grid.error)!.message}</Alert>
        </div>
      )}
      {!g ? (
        <Skeleton rows={6} />
      ) : !g.classes.length ? (
        <EmptyState title="No sections yet">
          Add classes and sections in{' '}
          <Link className="underline" href="/academics/classes">
            Classes &amp; sections
          </Link>
          .
        </EmptyState>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_260px]">
          <div className="flex flex-col gap-6">
            {g.classes.map((c) => (
              <Card key={c.gradeLevelId} title={c.name}>
                {!c.subjects.length ? (
                  <p className="text-sm text-slate-500">
                    No subjects for this class yet. Add them in{' '}
                    <Link className="underline" href="/academics/classes">
                      Classes &amp; sections
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                          <th className="py-2 pr-3">Section</th>
                          <th className="py-2 pr-3">Class teacher</th>
                          {c.subjects.map((s) => (
                            <th key={s.id} className="py-2 pr-3">
                              {s.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {c.sections.map((sec) => (
                          <tr key={sec.id}>
                            <td className="py-2 pr-3 whitespace-nowrap font-medium">
                              {sec.name}{' '}
                              <span className="text-xs font-normal text-slate-400">
                                {sec.students}
                              </span>
                            </td>
                            <td className="py-2 pr-3">
                              {select(
                                sec.classTeacherId ?? '',
                                (v) => void setClassTeacher(sec.id, v),
                                `${sec.id}:ct`,
                                `Class teacher of ${c.name} ${sec.name}`,
                              )}
                            </td>
                            {c.subjects.map((s) => (
                              <td key={s.id} className="py-2 pr-3">
                                {select(
                                  teacherOf(sec.id, s.id),
                                  (v) => void setCell(sec.id, s.id, v),
                                  `${sec.id}:${s.id}`,
                                  `${s.name} teacher of ${c.name} ${sec.name}`,
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            ))}
          </div>
          <Card title="Teachers" description="Class teacher of · subject classes">
            {!g.teachers.length ? (
              <p className="text-sm text-slate-500">
                No staff yet.{' '}
                <Link className="underline" href="/settings/members">
                  Add staff
                </Link>
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {g.teachers.map((t) => (
                  <li key={t.membershipId} className="flex items-center justify-between py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{t.fullName}</span>
                      {t.designation && (
                        <span className="block truncate text-xs text-slate-500">
                          {t.designation}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {t.classTeacherOf} · {t.periods}
                    </span>
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
