'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { Roster } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { HomeworkPanel } from '@/components/classroom/homework';
import { Alert, Card, PageHeader, Skeleton, Table, Td } from '@/components/ui';

export default function RosterPage() {
  const { id } = useParams<{ id: string }>();
  const r = useApi<Roster>(`/teaching/sections/${id}/students`);
  const [q, setQ] = useState('');
  const d = r.data;
  const list = (d?.students ?? []).filter((s) =>
    `${s.firstName} ${s.lastName} ${s.admissionNumber}`
      .toLowerCase()
      .includes(q.trim().toLowerCase()),
  );

  return (
    <>
      <Link href="/my-classes" className="text-sm text-brand-700">
        ← My classes
      </Link>
      <PageHeader
        title={d ? `${d.section.className} ${d.section.name}` : 'Class list'}
        description={
          d
            ? `${d.students.length} students · ${d.role === 'class_teacher' ? 'You are the class teacher' : d.role === 'subject_teacher' ? 'You teach a subject here' : 'Office view'}`
            : undefined
        }
      />
      {r.error && <Alert>{r.error.message}</Alert>}
      {!d ? (
        <Skeleton rows={8} />
      ) : (
        <div className="flex flex-col gap-6">
          <HomeworkPanel sectionId={id} />
          <Card title="Students">
            <input
              type="search"
              placeholder="Search name or admission no."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mb-3 w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <Table head={['Roll', 'Name', 'Adm. no.', ...(d.canOpenProfiles ? ['Parent'] : [])]}>
              {list.map((s) => (
                <tr key={s.id}>
                  <Td className="w-14 tabular-nums text-slate-500">{s.rollNumber ?? '—'}</Td>
                  <Td>
                    {d.canOpenProfiles ? (
                      <Link className="font-medium hover:underline" href={`/students/${s.id}`}>
                        {s.firstName} {s.lastName}
                      </Link>
                    ) : (
                      <span className="font-medium">
                        {s.firstName} {s.lastName}
                      </span>
                    )}
                  </Td>
                  <Td className="text-slate-500">{s.admissionNumber}</Td>
                  {d.canOpenProfiles && (
                    <Td>
                      {s.parentPhone && (
                        <span className="flex gap-3">
                          <a
                            className="text-brand-700 hover:underline"
                            href={`tel:${s.parentPhone}`}
                          >
                            Call
                          </a>
                          <a
                            className="text-brand-700 hover:underline"
                            href={`https://wa.me/${s.parentPhone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener"
                          >
                            WhatsApp
                          </a>
                        </span>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
