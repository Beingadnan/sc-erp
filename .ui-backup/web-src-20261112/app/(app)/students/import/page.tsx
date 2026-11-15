'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, post, upload } from '@/lib/api';
import type { AcademicYear, ImportJob, ImportPreview } from '@/lib/api';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import { Alert, Button, Card, PageHeader, SelectField, Table, Td } from '@/components/ui';

export default function ImportPage() {
  const { can } = useSession();
  const { campus, picker } = useCampus();
  const years = useApi<AcademicYear[]>(campus ? `/academic-years?campusId=${campus.id}` : null);
  const [yearId, setYearId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const action = useAction();

  useEffect(() => {
    const open = (years.data ?? []).filter((y) => y.status !== 'closed');
    setYearId((open.find((y) => y.isCurrent) ?? open[0])?.id ?? '');
  }, [years.data]);

  // Follow a running import.
  useEffect(() => {
    if (!job || job.status !== 'processing') return;
    const t = setTimeout(async () => setJob(await api<ImportJob>(`/imports/${job.id}`)), 1500);
    return () => clearTimeout(t);
  }, [job]);

  if (campus && !can('students.import', campus.id)) {
    return (
      <>
        <PageHeader title="Import students" />
        <Alert>You do not have permission to import students.</Alert>
      </>
    );
  }

  const reset = () => {
    setPreview(null);
    setJob(null);
    setPrivacy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      <PageHeader
        title="Import students"
        description="Bring existing students in from a spreadsheet (CSV or Excel, up to 2,000 rows)."
        actions={
          <a href="/api/v1/students/import/template">
            <Button variant="secondary">Download template</Button>
          </a>
        }
      />
      {action.error && (
        <div className="mb-4">
          <Alert>{action.error.message}</Alert>
        </div>
      )}

      {!preview && (
        <Card title="1. Choose the file">
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">
              Use the template's column names (common ones like “DOB”, “Adm No”, “Father Name” and
              “Mobile” are understood too). Classes and sections must already exist for the chosen
              year. Dates can be written 15-06-2014 or 2014-06-15. Rows with problems are listed and
              skipped; nothing is saved until you confirm.
            </p>
            {picker}
            <SelectField
              label="Academic year"
              value={yearId}
              onChange={(e) => setYearId(e.target.value)}
              className="w-56"
            >
              {(years.data ?? [])
                .filter((y) => y.status !== 'closed')
                .map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
            </SelectField>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,text/csv"
              className="block text-sm"
            />
            <Button
              loading={action.pending}
              disabled={!campus || !yearId}
              onClick={async () => {
                const file = fileRef.current?.files?.[0];
                if (!file || !campus) return;
                const form = new FormData();
                form.set('campusId', campus.id);
                form.set('academicYearId', yearId);
                form.set('file', file);
                const r = await action.run(() => upload<ImportPreview>('/imports/students', form));
                if (r) setPreview(r);
              }}
            >
              Check file
            </Button>
          </div>
        </Card>
      )}

      {preview && !job && (
        <div className="space-y-4">
          <Card title="2. Check the results">
            <div className="space-y-4 text-sm">
              <Alert tone={preview.validRows ? 'info' : 'warning'}>
                {preview.validRows} of {preview.totalRows} rows are ready to import.
                {preview.problems.length > 0 &&
                  ' Rows with problems below will be skipped — fix them and import them later.'}
              </Alert>
              {preview.sample.length > 0 && (
                <Table head={['Row', 'Student', 'Born', 'Class', 'Parent', 'Adm. no.']}>
                  {preview.sample.map((r) => (
                    <tr key={r.row}>
                      <Td>{r.row}</Td>
                      <Td>{r.name}</Td>
                      <Td>{r.dateOfBirth}</Td>
                      <Td>{r.class}</Td>
                      <Td>{r.parent}</Td>
                      <Td>{r.admissionNumber}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          </Card>
          {preview.problems.length > 0 && (
            <Card title={`Problems (${preview.problems.length})`}>
              <Table head={['Row', 'Column', 'Problem']}>
                {preview.problems.map((p, i) => (
                  <tr key={i}>
                    <Td>{p.row}</Td>
                    <Td>
                      <code className="text-xs">{p.field}</code>
                    </Td>
                    <Td>{p.message}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
          <Card title="3. Import">
            <div className="space-y-3 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={privacy}
                  onChange={(e) => setPrivacy(e.target.checked)}
                  className="mt-1"
                />
                Parents of these students have been given the school&apos;s privacy notice. Each
                import is recorded in the audit log.
              </label>
              <div className="flex gap-2">
                <Button
                  disabled={!privacy || !preview.validRows}
                  loading={action.pending}
                  onClick={async () => {
                    const ok = await action.run(() =>
                      post(`/imports/${preview.jobId}/confirm`, { privacyNoticeGiven: true }),
                    );
                    if (ok) setJob(await api<ImportJob>(`/imports/${preview.jobId}`));
                  }}
                >
                  Import {preview.validRows} students
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await action.run(() => post(`/imports/${preview.jobId}/cancel`));
                    reset();
                  }}
                >
                  Start again
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {job && (
        <Card title={job.status === 'processing' ? 'Importing…' : 'Import finished'}>
          <div className="space-y-4 text-sm">
            {job.status === 'processing' ? (
              <Alert tone="info">
                {job.report.length} of {job.validRows} done. You can leave this page; the import
                continues.
              </Alert>
            ) : (
              <Alert tone={job.failed ? 'warning' : 'success'}>
                {job.created} students added{job.failed ? `, ${job.failed} could not be added` : ''}
                .
              </Alert>
            )}
            {job.report.some((r) => r.status === 'failed') && (
              <Table head={['Row', 'Problem']}>
                {job.report
                  .filter((r) => r.status === 'failed')
                  .map((r) => (
                    <tr key={r.row}>
                      <Td>{r.row}</Td>
                      <Td>{r.message}</Td>
                    </tr>
                  ))}
              </Table>
            )}
            {job.status !== 'processing' && (
              <div className="flex gap-2">
                <Link href="/students">
                  <Button>View students</Button>
                </Link>
                <Button variant="secondary" onClick={reset}>
                  Import another file
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
