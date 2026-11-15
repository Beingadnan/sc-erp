'use client';

import Link from 'next/link';
import type { MyClass } from '@/lib/api';
import { Badge } from '@/components/ui';

/** Cards for the classes a teacher teaches: class-teacher section first. */
export function MyClassesList({ items }: { items: MyClass[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((c) => (
        <li
          key={c.sectionId}
          className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-lg font-semibold">
                {c.className} {c.sectionName}
              </div>
              <div className="text-sm text-slate-500">
                {[c.isClassTeacher ? 'Class teacher' : null, ...c.subjects.map((s) => s.name)]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                · {c.students} students
              </div>
            </div>
            {c.isClassTeacher &&
              (c.attendanceTaken ? (
                <Badge tone="green">Attendance done</Badge>
              ) : (
                <Badge tone="amber">Attendance due</Badge>
              ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {c.isClassTeacher && !c.attendanceTaken && (
              <Link
                href={`/attendance/mark?sectionId=${c.sectionId}`}
                className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                Take attendance
              </Link>
            )}
            <Link
              href={`/my-classes/${c.sectionId}`}
              className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium hover:bg-slate-50"
            >
              Class list
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
