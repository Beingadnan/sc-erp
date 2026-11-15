'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { post } from '@/lib/api';
import type {
  ApplicationDetail,
  ApplicationStatus,
  GradeLevel,
  GuardianMatch,
  Section,
} from '@/lib/api';
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_TONES,
  RELATIONSHIP_LABELS,
  SOURCE_LABELS,
  ageOn,
  dateTime,
  formatDate,
  fullName,
} from '@/lib/format';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { DocumentsPanel } from '@/components/students/documents-panel';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
} from '@/components/ui';

const ACTION_LABELS: Partial<Record<ApplicationStatus, string>> = {
  under_review: 'Start review',
  assessment: 'Schedule assessment',
  approved: 'Approve',
  waitlisted: 'Waitlist',
  rejected: 'Reject',
  withdrawn: 'Mark withdrawn',
};
const NEEDS_REASON: readonly string[] = ['rejected', 'withdrawn', 'waitlisted'];

function StatusAction({
  a,
  to,
  onDone,
}: {
  a: ApplicationDetail;
  to: ApplicationStatus;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const danger = to === 'rejected' || to === 'withdrawn';

  if (!open) {
    return (
      <Button
        variant={danger ? 'secondary' : to === 'approved' ? 'primary' : 'secondary'}
        onClick={() => setOpen(true)}
      >
        {ACTION_LABELS[to] ?? to}
      </Button>
    );
  }
  const submit = async (form: FormData) => {
    const when = String(form.get('assessmentAt') ?? '');
    const ok = await run(() =>
      post(`/applications/${a.id}/status`, {
        status: to,
        note: String(form.get('note') ?? ''),
        ...(to === 'assessment' && when ? { assessmentAt: new Date(when).toISOString() } : {}),
      }),
    );
    if (ok) {
      setOpen(false);
      onDone();
    }
  };
  return (
    <form
      onSubmit={onSubmitForm(submit)}
      className="w-full space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <p className="text-sm font-medium">{ACTION_LABELS[to]}</p>
      {error && !Object.keys(f).length && <Alert>{error.message}</Alert>}
      {to === 'assessment' && (
        <Field
          label="Date and time"
          name="assessmentAt"
          type="datetime-local"
          error={f.assessmentAt}
        />
      )}
      <Field
        label={
          NEEDS_REASON.includes(to)
            ? 'Reason (shared with staff, not the parent)'
            : 'Note (optional)'
        }
        name="note"
        error={f.note}
      />
      <div className="flex gap-2">
        <Button type="submit" loading={pending} variant={danger ? 'danger' : 'primary'}>
          Confirm
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AdmitPanel({ a, onDone }: { a: ApplicationDetail; onDone: () => void }) {
  const sections = useApi<Section[]>(`/sections?academicYearId=${a.academicYearId}`);
  const classes = useApi<GradeLevel[]>(`/classes?campusId=${a.campusId}`);
  const siblings = useApi<GuardianMatch[]>(
    `/guardians?phone=${encodeURIComponent(a.guardianPhone)}`,
  );
  const [linkTo, setLinkTo] = useState<string>('');
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const className = (id: string) => classes.data?.find((c) => c.id === id)?.name ?? '';
  // Sections of the class applied for first.
  const options = [...(sections.data ?? [])].sort(
    (x, y) =>
      Number(y.gradeLevelId === a.gradeLevelId) - Number(x.gradeLevelId === a.gradeLevelId) ||
      className(x.gradeLevelId).localeCompare(className(y.gradeLevelId)) ||
      x.name.localeCompare(y.name),
  );

  const submit = async (form: FormData) => {
    const res = await run(() =>
      post<{ studentId: string; admissionNumber: string }>(`/applications/${a.id}/admit`, {
        sectionId: form.get('sectionId'),
        admissionDate: form.get('admissionDate') || undefined,
        existingGuardianId: linkTo || null,
        aadhaar: form.get('aadhaar'),
        privacyNotice: {
          acknowledged: form.get('privacy') === 'on',
          version: '1.0',
          channel: form.get('channel'),
        },
      }),
    );
    if (res) onDone();
  };

  return (
    <Card
      title="Admit"
      description="Creates the student record with an admission number and enrolls the child."
    >
      <form onSubmit={onSubmitForm(submit)} className="space-y-4">
        {error && <Alert>{f.sectionId ?? f.aadhaar ?? error.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Section" name="sectionId" defaultValue="" error={f.sectionId}>
            <option value="" disabled>
              Choose
            </option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {className(s.gradeLevelId)} {s.name}
                {s.capacity ? ` (${s.capacity} seats)` : ''}
              </option>
            ))}
          </SelectField>
          <Field
            label="Admission date"
            name="admissionDate"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
          <Field
            label="Aadhaar (optional)"
            name="aadhaar"
            inputMode="numeric"
            autoComplete="off"
            error={f.aadhaar}
          />
        </div>
        {siblings.data && siblings.data.length > 0 && (
          <Alert tone="info">
            <span className="block">This mobile number belongs to an existing parent:</span>
            {siblings.data.map((g) => (
              <label key={g.id} className="mt-1 flex items-center gap-2">
                <input
                  type="radio"
                  name="sibling"
                  checked={linkTo === g.id}
                  onChange={() => setLinkTo(g.id)}
                />
                Link to {g.fullName}
                {g.children.length > 0 &&
                  ` (parent of ${g.children.map((c) => c.name).join(', ')})`}
              </label>
            ))}
            <label className="mt-1 flex items-center gap-2">
              <input
                type="radio"
                name="sibling"
                checked={linkTo === ''}
                onChange={() => setLinkTo('')}
              />
              Create a new parent record
            </label>
          </Alert>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="privacy" className="mt-1" />
          <span>
            The parent has been given the school&apos;s privacy notice (version 1.0) and agrees to
            the school keeping this information.
            {f['privacyNotice.acknowledged'] && (
              <span className="block text-xs text-red-600">{f['privacyNotice.acknowledged']}</span>
            )}
          </span>
        </label>
        <SelectField
          label="How was it acknowledged?"
          name="channel"
          defaultValue="in_person"
          className="w-60"
        >
          <option value="in_person">In person (signed form)</option>
          <option value="phone">On the phone</option>
          <option value="web">Online</option>
        </SelectField>
        <Button type="submit" loading={pending}>
          Admit student
        </Button>
      </form>
    </Card>
  );
}

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const { data: a, loading, error, reload } = useApi<ApplicationDetail>(`/applications/${id}`);
  const docsKey = useState(0);

  if (loading && !a) return <Skeleton rows={8} />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!a) return null;

  const refresh = () => {
    void reload();
    docsKey[1]((k) => k + 1);
  };

  return (
    <>
      <PageHeader
        title={`${fullName(a)} · ${a.className}`}
        description={`${a.applicationNumber} · ${a.yearName} · ${SOURCE_LABELS[a.source] ?? a.source}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={APPLICATION_STATUS_TONES[a.status]}>
              {APPLICATION_STATUS_LABELS[a.status]}
            </Badge>
            <Link href="/admissions/applications">
              <Button variant="secondary">All applications</Button>
            </Link>
          </div>
        }
      />
      {a.status === 'admitted' && a.studentId && (
        <div className="mb-4">
          <Alert tone="success">
            Admitted with admission number <strong>{a.admissionNumber}</strong>.{' '}
            <Link href={`/students/${a.studentId}`} className="underline">
              Open student record
            </Link>
          </Alert>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card title="Details">
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500">Date of birth</dt>
                <dd>
                  {formatDate(a.dateOfBirth)} ({ageOn(a.dateOfBirth)} years)
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Gender</dt>
                <dd>{{ male: 'Boy', female: 'Girl', other: 'Other' }[a.gender]}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Previous school</dt>
                <dd>{a.previousSchool ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">
                  {RELATIONSHIP_LABELS[a.guardianRelationship] ?? 'Parent'}
                </dt>
                <dd>{a.guardianName}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Mobile</dt>
                <dd>
                  <a href={`tel:${a.guardianPhone}`} className="text-brand-700 hover:underline">
                    {a.guardianPhone}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Email</dt>
                <dd>{a.guardianEmail ?? '—'}</dd>
              </div>
              {a.assessmentAt && (
                <div>
                  <dt className="text-xs text-slate-500">Assessment</dt>
                  <dd>{dateTime(a.assessmentAt)}</dd>
                </div>
              )}
              {a.notes && (
                <div className="sm:col-span-3">
                  <dt className="text-xs text-slate-500">Notes</dt>
                  <dd className="whitespace-pre-line">{a.notes}</dd>
                </div>
              )}
            </dl>
          </Card>

          {a.nextStatuses.length > 0 && (
            <Card title="Next step">
              <div className="flex flex-wrap gap-2">
                {a.nextStatuses.map((s) => (
                  <StatusAction key={s} a={a} to={s} onDone={refresh} />
                ))}
              </div>
            </Card>
          )}

          {a.status === 'approved' && a.permissions.admit && <AdmitPanel a={a} onDone={refresh} />}

          <DocumentsPanel
            key={docsKey[0]}
            owner={{ applicationId: a.id }}
            canManage={a.permissions.manage && !['withdrawn', 'admitted'].includes(a.status)}
          />
        </div>

        <Card title="History">
          <ol className="space-y-3 text-sm">
            {a.events.map((e) => (
              <li key={e.id} className="border-l-2 border-slate-200 pl-3">
                <p className="font-medium">{APPLICATION_STATUS_LABELS[e.toStatus] ?? e.toStatus}</p>
                <p className="text-xs text-slate-500">
                  {dateTime(e.createdAt)}
                  {e.actorName ? ` · ${e.actorName}` : ''}
                </p>
                {e.note && <p className="mt-0.5 text-slate-700">{e.note}</p>}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
