'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AcademicYear, ApplicationListItem, ApplicationSummary } from '@/lib/api';
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_TONES,
  SOURCE_LABELS,
  dateTime,
  fullName,
} from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
  Table,
  Td,
} from '@/components/ui';

const PIPELINE = [
  'submitted',
  'under_review',
  'assessment',
  'approved',
  'waitlisted',
  'admitted',
] as const;

export default function ApplicationsPage() {
  const { can } = useSession();
  const { campus, picker } = useCampus();
  const years = useApi<AcademicYear[]>(campus ? `/academic-years?campusId=${campus.id}` : null);
  const [yearId, setYearId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    const list = years.data ?? [];
    setYearId(
      (list.find((y) => y.isCurrent) ?? list.findLast((y) => y.status !== 'closed') ?? list.at(-1))
        ?.id ?? null,
    );
  }, [years.data]);

  const params = new URLSearchParams({ limit: '50' });
  if (campus) params.set('campusId', campus.id);
  if (yearId) params.set('academicYearId', yearId);
  if (status) params.set('status', status);
  if (search) params.set('q', search);
  if (cursor) params.set('cursor', cursor);
  const list = useApi<{ data: ApplicationListItem[]; nextCursor: string | null }>(
    campus && yearId ? `/applications?${params}` : null,
  );
  const summary = useApi<ApplicationSummary>(
    campus && yearId
      ? `/applications/summary?campusId=${campus.id}&academicYearId=${yearId}`
      : null,
  );
  const manage = campus ? can('admissions.manage', campus.id) : false;

  return (
    <>
      <PageHeader
        title="Applications"
        description="Admission applications from review to admission."
        actions={
          manage && (
            <ButtonLink href="/admissions/applications/new" variant="primary" icon={Plus}>
              New application
            </ButtonLink>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-4">
        {picker}
        {years.data && years.data.length > 0 && (
          <SelectField
            label="Academic year"
            value={yearId ?? ''}
            onChange={(e) => {
              setYearId(e.target.value);
              setCursor(null);
            }}
            className="w-48"
          >
            {years.data.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </SelectField>
        )}
      </div>

      {years.data && years.data.length === 0 && (
        <Alert tone="info">Add an academic year first (Academics → Academic years).</Alert>
      )}

      {summary.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {PIPELINE.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatus(status === s ? '' : s);
                setCursor(null);
              }}
              className={`rounded-xl border bg-white p-3 text-left shadow-xs transition hover:border-brand-600 ${
                status === s ? 'border-brand-600 ring-2 ring-brand-600/20' : 'border-slate-200'
              }`}
            >
              <p className="text-xs text-slate-500">{APPLICATION_STATUS_LABELS[s]}</p>
              <p className="text-2xl font-semibold">{summary.data?.byStatus[s] ?? 0}</p>
            </button>
          ))}
        </div>
      )}

      <Card className="mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
            setCursor(null);
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <Field
            label="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Child, parent, mobile or application no."
            className="w-full max-w-sm"
          />
          <SelectField
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setCursor(null);
            }}
            className="w-44"
          >
            <option value="">All</option>
            {Object.entries(APPLICATION_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </Card>

      <Card>
        {list.loading && !list.data ? (
          <Skeleton rows={5} />
        ) : list.error ? (
          <Alert>{list.error.message}</Alert>
        ) : !list.data?.data.length ? (
          <EmptyState title="No applications">
            {manage && 'Start one from an inquiry, or use “New application”.'}
          </EmptyState>
        ) : (
          <>
            <Table head={['Application', 'Child', 'Class', 'Parent', 'Source', 'Status']}>
              {list.data.data.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link
                      href={`/admissions/applications/${a.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {a.applicationNumber}
                    </Link>
                    <span className="block text-xs text-slate-500">{dateTime(a.createdAt)}</span>
                  </Td>
                  <Td>{fullName(a)}</Td>
                  <Td>{a.className}</Td>
                  <Td>
                    {a.guardianName}
                    <span className="block text-xs text-slate-500">{a.guardianPhone}</span>
                  </Td>
                  <Td>{SOURCE_LABELS[a.source] ?? a.source}</Td>
                  <Td>
                    <Badge tone={APPLICATION_STATUS_TONES[a.status]}>
                      {APPLICATION_STATUS_LABELS[a.status]}
                    </Badge>
                    {a.status === 'assessment' && a.assessmentAt && (
                      <span className="block text-xs text-slate-500">
                        {dateTime(a.assessmentAt)}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            <div className="mt-4 flex gap-2">
              {cursor && (
                <Button variant="secondary" onClick={() => setCursor(null)}>
                  Back to newest
                </Button>
              )}
              {list.data.nextCursor && (
                <Button variant="secondary" onClick={() => setCursor(list.data!.nextCursor)}>
                  Older applications
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      {summary.data && summary.data.byClass.length > 0 && (
        <Card title="By class" className="mt-6">
          <Table head={['Class', 'Applications', 'In progress', 'Admitted']}>
            {summary.data.byClass.map((c) => (
              <tr key={c.gradeLevelId}>
                <Td>{c.className}</Td>
                <Td>{c.total}</Td>
                <Td>{c.pending}</Td>
                <Td>{c.admitted}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
