'use client';

import Link from 'next/link';
import { Download, ListOrdered, UserPlus, Users } from 'lucide-react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  SearchInput,
  Skeleton,
  Table,
  Td,
  buttonStyles,
  confirmAction,
  cx,
  toast,
} from '@/components/ui';

const STATUS_TONE = { active: 'green', withdrawn: 'red', alumni: 'neutral' } as const;

function StudentsPageInner() {
  const { can } = useSession();
  const { campus, picker } = useCampus();
  const [choice, setChoice] = useState<SectionChoice>({
    academicYearId: null,
    gradeLevelId: null,
    sectionId: null,
  });
  const urlQuery = useSearchParams().get('q') ?? '';
  const [q, setQ] = useState(urlQuery);
  const [search, setSearch] = useState(urlQuery);
  // "Find a student" in the header lands here with ?q=.
  useEffect(() => {
    setQ(urlQuery);
    setSearch(urlQuery);
  }, [urlQuery]);
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
          <>
            {campus && can('students.export', campus.id) && (
              <a
                href={`/api/v1/students/export?${exportParams}`}
                className={buttonStyles('secondary')}
              >
                <Download className="size-4" aria-hidden />
                Download CSV
              </a>
            )}
            {manage && (
              <ButtonLink href="/students/new" variant="primary" icon={UserPlus}>
                Admit a student
              </ButtonLink>
            )}
          </>
        }
      />
      {roster && manage && renumber.error && (
        <Alert className="mb-4">{renumber.error.message}</Alert>
      )}

      <Card flush>
        <div className="space-y-3 border-b border-slate-100 px-5 py-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(q.trim());
                setCursor(null);
              }}
              className="flex min-w-0 items-center gap-2"
              role="search"
            >
              <SearchInput
                value={q}
                onChange={(v) => {
                  setQ(v);
                  if (!v.trim() && search) {
                    setSearch('');
                    setCursor(null);
                  }
                }}
                placeholder="Search by name, admission no. or parent’s mobile"
                className="w-full max-w-md"
              />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
            {roster && manage && (
              <Button
                variant="secondary"
                icon={ListOrdered}
                loading={renumber.pending}
                onClick={async () => {
                  if (
                    !(await confirmAction({
                      title: 'Renumber roll numbers?',
                      message:
                        'Roll numbers 1, 2, 3… will be given in alphabetical order of first name.',
                      confirmLabel: 'Renumber',
                      tone: 'primary',
                    }))
                  )
                    return;
                  if (
                    await renumber.run(() =>
                      post(`/sections/${choice.sectionId}/renumber`, { order: 'name' }),
                    )
                  )
                    toast.success('Roll numbers updated.');
                  void reload();
                }}
              >
                Renumber alphabetically
              </Button>
            )}
          </div>
          <div
            className={cx(
              'grid gap-3 lg:items-end',
              picker && 'lg:grid-cols-[16rem_minmax(0,1fr)]',
            )}
          >
            {picker}
            {campus && (
              <SectionPicker campusId={campus.id} value={choice} onChange={onChoice} allowAll />
            )}
          </div>
        </div>

        {loading && !data ? (
          <div className="p-5">
            <Skeleton rows={6} />
          </div>
        ) : error ? (
          <div className="p-5">
            <Alert>{error.message}</Alert>
          </div>
        ) : !data?.data.length ? (
          <EmptyState
            icon={Users}
            title={search ? 'No students match your search' : 'No students yet'}
            action={
              manage && !search ? (
                <ButtonLink href="/students/new" variant="primary" icon={UserPlus}>
                  Admit a student
                </ButtonLink>
              ) : undefined
            }
          >
            {search ? 'Check the spelling, or search by admission number or mobile.' : undefined}
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
                  {roster && (
                    <Td className="w-16 text-slate-500 tabular-nums">{s.rollNumber ?? '—'}</Td>
                  )}
                  <Td>
                    <Link href={`/students/${s.id}`} className="group flex items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                        {(s.firstName[0] ?? '') + (s.lastName[0] ?? '')}
                      </span>
                      <span className="font-medium text-ink group-hover:text-brand-700 group-hover:underline">
                        {fullName(s)}
                      </span>
                    </Link>
                  </Td>
                  <Td className="text-slate-600 tabular-nums">{s.admissionNumber}</Td>
                  {!roster && (
                    <Td className="whitespace-nowrap">
                      {s.className ? `${s.className} ${s.sectionName}` : '—'}
                      {s.yearName && (
                        <span className="ml-1 text-xs text-slate-400">{s.yearName}</span>
                      )}
                    </Td>
                  )}
                  <Td className="text-slate-600">{s.guardianName ?? '—'}</Td>
                  <Td>
                    {s.guardianPhone ? (
                      <a
                        href={`tel:${s.guardianPhone}`}
                        className="text-slate-600 tabular-nums hover:text-brand-700 hover:underline"
                      >
                        {s.guardianPhone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <Badge dot tone={STATUS_TONE[s.status]}>
                      {s.status}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-[13px] text-slate-500">
              <span>
                {data.data.length} {data.data.length === 1 ? 'student' : 'students'}
                {cursor || data.nextCursor ? ' on this page' : ''}
              </span>
              <div className="flex gap-2">
                {cursor && (
                  <Button size="sm" variant="secondary" onClick={() => setCursor(null)}>
                    Back to start
                  </Button>
                )}
                {data.nextCursor && (
                  <Button size="sm" variant="secondary" onClick={() => setCursor(data.nextCursor)}>
                    Next page
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

export default function StudentsPage() {
  return (
    <Suspense>
      <StudentsPageInner />
    </Suspense>
  );
}
