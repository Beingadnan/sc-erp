'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { post } from '@/lib/api';
import type { StudentListItem } from '@/lib/api';
import { fullName } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import { SectionPicker } from '@/components/students/section-picker';
import type { SectionChoice } from '@/components/students/section-picker';
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

const STATUS_TONE = { active: 'green', withdrawn: 'red', alumni: 'neutral' } as const;

export default function StudentsPage() {
  const { can } = useSession();
  const { campus, picker } = useCampus();
  const [choice, setChoice] = useState<SectionChoice>({
    academicYearId: null,
    gradeLevelId: null,
    sectionId: null,
  });
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const renumber = useAction();
  const onChoice = useCallback((v: SectionChoice) => {
    setChoice(v);
    setCursor(null);
  }, []);

  // Reset filters when the campus changes.
  useEffect(() => {
    setChoice({ academicYearId: null, gradeLevelId: null, sectionId: null });
    setCursor(null);
  }, [campus?.id]);

  const params = new URLSearchParams({ limit: '50' });
  if (campus) params.set('campusId', campus.id);
  if (choice.academicYearId) params.set('academicYearId', choice.academicYearId);
  if (choice.gradeLevelId) params.set('gradeLevelId', choice.gradeLevelId);
  if (choice.sectionId) params.set('sectionId', choice.sectionId);
  if (search) params.set('q', search);
  if (cursor) params.set('cursor', cursor);
  const { data, loading, error, reload } = useApi<{
    data: StudentListItem[];
    nextCursor: string | null;
  }>(campus ? `/students?${params}` : null);

  const roster = Boolean(choice.sectionId);
  const exportParams = new URLSearchParams(params);
  exportParams.delete('limit');
  exportParams.delete('cursor');
  const manage = campus ? can('students.manage', campus.id) : false;

  return (
    <>
      <PageHeader
        title="Students"
        description={
          roster
            ? 'Class list in roll-number order.'
            : 'Search by name, admission number or parent’s mobile number.'
        }
        actions={
          <div className="flex gap-2">
            {campus && can('students.export', campus.id) && (
              <a href={`/api/v1/students/export?${exportParams}`}>
                <Button variant="secondary">Download CSV</Button>
              </a>
            )}
            {manage && (
              <Link href="/students/new">
                <Button>Admit a student</Button>
              </Link>
            )}
          </div>
        }
      />
      <Card className="mb-4">
        <div className="space-y-4">
          {picker}
          {campus && (
            <SectionPicker campusId={campus.id} value={choice} onChange={onChoice} allowAll />
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(q.trim());
              setCursor(null);
            }}
            className="flex items-end gap-2"
          >
            <Field
              label="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, admission no. or mobile"
              className="w-full max-w-sm"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
            {search && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setQ('');
                  setSearch('');
                }}
              >
                Clear
              </Button>
            )}
          </form>
        </div>
      </Card>

      {roster && manage && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {renumber.error && <Alert>{renumber.error.message}</Alert>}
          <Button
            variant="secondary"
            loading={renumber.pending}
            onClick={async () => {
              if (!confirm('Give roll numbers 1, 2, 3… in alphabetical order of first name?'))
                return;
              await renumber.run(() =>
                post(`/sections/${choice.sectionId}/renumber`, { order: 'name' }),
              );
              void reload();
            }}
          >
            Renumber alphabetically
          </Button>
        </div>
      )}

      <Card>
        {loading && !data ? (
          <Skeleton rows={6} />
        ) : error ? (
          <Alert>{error.message}</Alert>
        ) : !data?.data.length ? (
          <EmptyState title={search ? 'No students match' : 'No students yet'}>
            {manage && !search && 'Use “Admit a student” to add the first one.'}
          </EmptyState>
        ) : (
          <>
            <Table
              head={
                roster
                  ? ['Roll', 'Student', 'Adm. no.', 'Parent', 'Mobile', 'Status']
                  : ['Student', 'Adm. no.', 'Class', 'Parent', 'Mobile', 'Status']
              }
            >
              {data.data.map((s) => (
                <tr key={s.id}>
                  {roster && <Td>{s.rollNumber ?? '—'}</Td>}
                  <Td>
                    <Link
                      href={`/students/${s.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {fullName(s)}
                    </Link>
                  </Td>
                  <Td>{s.admissionNumber}</Td>
                  {!roster && (
                    <Td>
                      {s.className ? `${s.className} ${s.sectionName}` : '—'}
                      {s.yearName && (
                        <span className="ml-1 text-xs text-slate-500">({s.yearName})</span>
                      )}
                    </Td>
                  )}
                  <Td>{s.guardianName ?? '—'}</Td>
                  <Td>
                    {s.guardianPhone ? (
                      <a href={`tel:${s.guardianPhone}`} className="hover:underline">
                        {s.guardianPhone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
            {roster && <p className="mt-3 text-sm text-slate-500">{data.data.length} students</p>}
            <div className="mt-4 flex gap-2">
              {cursor && (
                <Button variant="secondary" onClick={() => setCursor(null)}>
                  Back to start
                </Button>
              )}
              {data.nextCursor && (
                <Button variant="secondary" onClick={() => setCursor(data.nextCursor)}>
                  More students
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
