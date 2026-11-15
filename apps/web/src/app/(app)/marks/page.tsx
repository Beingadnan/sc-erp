'use client';

import Link from 'next/link';
import type { MarksToEnter } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui';

/** A teacher's marks to enter: their own subjects in their own classes, for open exams. */
export default function MyMarksPage() {
  const mine = useApi<{ items: MarksToEnter[] }>('/exams/marks/mine');
  const items = mine.data?.items ?? [];
  const exams = [...new Set(items.map((i) => i.examName))];
  return (
    <>
      <PageHeader
        title="Marks entry"
        description="Your subjects in your classes. Enter marks, then hand them in to the exam in-charge."
      />
      {mine.error && <Alert>{mine.error.message}</Alert>}
      {!mine.data ? (
        <Skeleton rows={4} />
      ) : !items.length ? (
        <EmptyState title="Nothing to enter">
          When the exam in-charge starts marks entry for an exam, your classes appear here.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {exams.map((name) => (
            <section key={name}>
              <h2 className="mb-2 font-semibold">{name}</h2>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {items
                  .filter((i) => i.examName === name)
                  .map((i) => (
                    <li key={`${i.paperId}:${i.sectionId}`}>
                      <Link
                        href={`/marks/${i.paperId}/${i.sectionId}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50"
                      >
                        <span>
                          <span className="font-medium">
                            {i.className} {i.sectionName} · {i.subjectName}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {i.examDate ? formatDate(i.examDate) : 'Date not set'} · out of{' '}
                            {i.maxMarks}
                          </span>
                        </span>
                        {i.submitted ? (
                          <Badge tone="green">Handed in</Badge>
                        ) : i.entered >= i.students && i.students > 0 ? (
                          <Badge tone="blue">Ready to hand in</Badge>
                        ) : (
                          <Badge tone={i.entered ? 'amber' : 'neutral'}>
                            {i.entered}/{i.students} entered
                          </Badge>
                        )}
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
