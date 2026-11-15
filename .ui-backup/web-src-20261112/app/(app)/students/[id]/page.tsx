'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BLOOD_GROUPS, RELATIONSHIPS } from '@school-erp/validation';
import { del, patch, post } from '@/lib/api';
import type { GradeLevel, Section, StudentDetail, StudentGuardian } from '@/lib/api';
import { ageOn, blank, formatDate, fullName, RELATIONSHIP_LABELS } from '@/lib/format';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { DocumentsPanel } from '@/components/students/documents-panel';
import { LeavingPanel } from '@/components/students/leaving-panel';
import { AttendanceCard } from '@/components/attendance/student-card';
import { FeesCard } from '@/components/fees/student-card';
import {
  CustomFieldInputs,
  readCustomFields,
  useCustomFields,
} from '@/components/students/custom-field-inputs';
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

const GENDER = { male: 'Boy', female: 'Girl', other: 'Other' } as const;
const CHANNEL: Record<string, string> = {
  in_person: 'in person',
  phone: 'on the phone',
  web: 'online',
  app: 'in the app',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm">{children || '—'}</dd>
    </div>
  );
}

function DetailsForm({ s, onDone }: { s: StudentDetail; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const customDefs = useCustomFields('student');
  const submit = async (form: FormData) => {
    const body: Record<string, unknown> = {
      firstName: form.get('firstName'),
      lastName: String(form.get('lastName') ?? ''),
      nameLocal: blank(form.get('nameLocal')),
      dateOfBirth: form.get('dateOfBirth'),
      gender: form.get('gender'),
      bloodGroup: blank(form.get('bloodGroup')),
      address: blank(form.get('address')),
      pen: blank(form.get('pen')),
      apaarId: blank(form.get('apaarId')),
      customFields: readCustomFields(form, customDefs),
    };
    const aadhaar = String(form.get('aadhaar') ?? '').trim();
    if (aadhaar) body.aadhaar = aadhaar;
    if (form.get('removeAadhaar') === 'on') body.aadhaar = null;
    const ok = await run(() => patch(`/students/${s.id}`, body));
    if (ok) onDone();
  };
  return (
    <form onSubmit={onSubmitForm(submit)} className="grid gap-4 sm:grid-cols-3">
      {error && !Object.keys(f).length && (
        <div className="sm:col-span-3">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field label="First name" name="firstName" defaultValue={s.firstName} error={f.firstName} />
      <Field label="Last name" name="lastName" defaultValue={s.lastName} error={f.lastName} />
      <Field
        label="Name in Hindi"
        name="nameLocal"
        lang="hi"
        defaultValue={s.nameLocal ?? ''}
        error={f.nameLocal}
      />
      <Field
        label="Date of birth"
        name="dateOfBirth"
        type="date"
        defaultValue={s.dateOfBirth}
        error={f.dateOfBirth}
      />
      <SelectField label="Gender" name="gender" defaultValue={s.gender}>
        <option value="female">Girl</option>
        <option value="male">Boy</option>
        <option value="other">Other</option>
      </SelectField>
      <SelectField label="Blood group" name="bloodGroup" defaultValue={s.bloodGroup ?? ''}>
        <option value="">Not known</option>
        {BLOOD_GROUPS.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </SelectField>
      <Field
        label="Address"
        name="address"
        defaultValue={s.address ?? ''}
        className="sm:col-span-3"
        error={f.address}
      />
      <CustomFieldInputs defs={customDefs} values={s.customFields} errors={f} />
      <Field label="PEN" name="pen" defaultValue={s.pen ?? ''} error={f.pen} />
      <Field label="APAAR ID" name="apaarId" defaultValue={s.apaarId ?? ''} error={f.apaarId} />
      <div className="flex flex-col gap-1">
        <Field
          label={s.aadhaarMasked ? 'New Aadhaar number' : 'Aadhaar'}
          name="aadhaar"
          autoComplete="off"
          inputMode="numeric"
          hint={s.aadhaarMasked ? `Leave empty to keep ${s.aadhaarMasked}` : '12 digits, optional'}
          error={f.aadhaar}
        />
        {s.aadhaarMasked && (
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" name="removeAadhaar" /> Remove Aadhaar from the record
          </label>
        )}
      </div>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" loading={pending}>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AddGuardian({ studentId, onDone }: { studentId: string; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const submit = async (form: FormData) => {
    const ok = await run(() =>
      post(`/students/${studentId}/guardians`, {
        fullName: form.get('fullName'),
        phone: form.get('phone'),
        email: form.get('email'),
        occupation: form.get('occupation'),
        relationship: form.get('relationship'),
        isPrimary: false,
        isFeePayer: form.get('isFeePayer') === 'on',
      }),
    );
    if (ok) onDone();
  };
  return (
    <form
      onSubmit={onSubmitForm(submit)}
      className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3"
    >
      {error && !Object.keys(f).length && (
        <div className="sm:col-span-3">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field label="Full name" name="fullName" error={f.fullName} />
      <Field label="Mobile number" name="phone" type="tel" error={f.phone} />
      <SelectField label="Relationship" name="relationship" defaultValue="guardian">
        {RELATIONSHIPS.map((r) => (
          <option key={r} value={r}>
            {RELATIONSHIP_LABELS[r]}
          </option>
        ))}
      </SelectField>
      <Field label="Email (optional)" name="email" type="email" error={f.email} />
      <Field label="Occupation (optional)" name="occupation" />
      <label className="flex items-center gap-2 text-sm sm:pt-6">
        <input type="checkbox" name="isFeePayer" /> Pays fees
      </label>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" loading={pending}>
          Add guardian
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function EditGuardian({ g, onDone }: { g: StudentGuardian; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const submit = async (form: FormData) => {
    const ok = await run(() =>
      patch(`/guardians/${g.id}`, {
        fullName: form.get('fullName'),
        phone: form.get('phone'),
        email: form.get('email'),
        occupation: form.get('occupation'),
      }),
    );
    if (ok !== undefined) onDone();
  };
  return (
    <form onSubmit={onSubmitForm(submit)} className="mt-3 grid gap-3 sm:grid-cols-2">
      {error && !Object.keys(f).length && (
        <div className="sm:col-span-2">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field label="Full name" name="fullName" defaultValue={g.fullName} error={f.fullName} />
      <Field label="Mobile number" name="phone" type="tel" defaultValue={g.phone} error={f.phone} />
      <Field label="Email" name="email" type="email" defaultValue={g.email ?? ''} error={f.email} />
      <Field label="Occupation" name="occupation" defaultValue={g.occupation ?? ''} />
      <p className="text-xs text-slate-500 sm:col-span-2">
        Changes apply to this parent on the records of all their children.
      </p>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={pending}>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function MoveSection({
  enrollment,
  onDone,
}: {
  enrollment: StudentDetail['enrollments'][number];
  onDone: () => void;
}) {
  const sections = useApi<Section[]>(`/sections?academicYearId=${enrollment.academicYearId}`);
  const classes = useApi<GradeLevel[]>(
    sections.data?.[0] ? `/classes?campusId=${sections.data[0].campusId}` : null,
  );
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const className = (id: string) => classes.data?.find((c) => c.id === id)?.name ?? '';
  const submit = async (form: FormData) => {
    const roll = blank(form.get('rollNumber'));
    const sectionId = String(form.get('sectionId'));
    const ok = await run(() =>
      patch(`/enrollments/${enrollment.id}`, {
        ...(sectionId !== enrollment.sectionId ? { sectionId } : {}),
        ...(roll !== String(enrollment.rollNumber ?? '')
          ? { rollNumber: roll === null ? null : Number(roll) }
          : {}),
      }),
    );
    if (ok) onDone();
  };
  return (
    <form onSubmit={onSubmitForm(submit)} className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
      {error && (
        <div className="sm:col-span-3">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <SelectField label="Section" name="sectionId" defaultValue={enrollment.sectionId}>
        {(sections.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {className(s.gradeLevelId)} {s.name}
          </option>
        ))}
      </SelectField>
      <Field
        label="Roll number"
        name="rollNumber"
        type="number"
        min={1}
        max={999}
        defaultValue={enrollment.rollNumber ?? ''}
        hint="Leave unchanged when moving to get the next free number"
        error={f.rollNumber}
      />
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function StudentPage() {
  const { id } = useParams<{ id: string }>();
  const { data: s, loading, error, reload } = useApi<StudentDetail>(`/students/${id}`);
  const [editing, setEditing] = useState(false);
  const [addingGuardian, setAddingGuardian] = useState(false);
  const [editingGuardian, setEditingGuardian] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [aadhaar, setAadhaar] = useState<string | null>(null);
  const action = useAction();
  const customDefs = useCustomFields('student');

  if (loading && !s) return <Skeleton rows={8} />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!s) return null;

  const manage = s.permissions.manage;
  const current = s.enrollments.find((e) => e.status === 'active');
  const act = async (fn: () => Promise<unknown>) => {
    await action.run(fn);
    void reload();
  };
  const guardianName = (gid: string) =>
    s.guardians.find((g) => g.id === gid)?.fullName ?? 'A former guardian';

  return (
    <>
      <PageHeader
        title={fullName(s)}
        description={[
          `Admission no. ${s.admissionNumber}`,
          current
            ? `${current.className} ${current.sectionName}, roll ${current.rollNumber ?? '—'}`
            : null,
          current?.yearName,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={s.status === 'active' ? 'green' : 'neutral'}>{s.status}</Badge>
            <Link href="/students">
              <Button variant="secondary">All students</Button>
            </Link>
          </div>
        }
      />
      {action.error && (
        <div className="mb-4">
          <Alert>{action.error.message}</Alert>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card
            title="Student details"
            actions={
              manage &&
              !editing && (
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )
            }
          >
            {editing ? (
              <DetailsForm
                s={s}
                onDone={() => {
                  setEditing(false);
                  setAadhaar(null);
                  void reload();
                }}
              />
            ) : (
              <dl className="grid gap-4 sm:grid-cols-3">
                <Row label="Name in Hindi">{s.nameLocal}</Row>
                <Row label="Date of birth">
                  {formatDate(s.dateOfBirth)} ({ageOn(s.dateOfBirth)} years)
                </Row>
                <Row label="Gender">{GENDER[s.gender]}</Row>
                <Row label="Blood group">{s.bloodGroup}</Row>
                <Row label="Admission date">{formatDate(s.admissionDate)}</Row>
                <Row label="Address">{s.address}</Row>
                {customDefs.map((d) => (
                  <Row key={d.key} label={d.label}>
                    {s.customFields[d.key] === undefined ? null : String(s.customFields[d.key])}
                  </Row>
                ))}
                <Row label="PEN">{s.pen}</Row>
                <Row label="APAAR ID">{s.apaarId}</Row>
                <Row label="Aadhaar">
                  {s.aadhaarMasked ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{aadhaar ?? s.aadhaarMasked}</span>
                      {s.permissions.viewSensitive &&
                        (aadhaar ? (
                          <Button variant="ghost" onClick={() => setAadhaar(null)}>
                            Hide
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            title="Your view will be recorded in the audit log"
                            onClick={async () => {
                              const r = await action.run(() =>
                                post<{ aadhaar: string }>(`/students/${s.id}/aadhaar/reveal`),
                              );
                              if (r)
                                setAadhaar(r.aadhaar.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3'));
                            }}
                          >
                            Show
                          </Button>
                        ))}
                    </span>
                  ) : null}
                </Row>
              </dl>
            )}
          </Card>

          <Card
            title="Parents and guardians"
            actions={
              manage &&
              s.guardians.length < 4 &&
              !addingGuardian && (
                <Button variant="ghost" onClick={() => setAddingGuardian(true)}>
                  Add guardian
                </Button>
              )
            }
          >
            <ul className="divide-y divide-slate-100">
              {s.guardians.map((g) => (
                <li key={g.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {g.fullName}{' '}
                        <span className="font-normal text-slate-500">
                          · {RELATIONSHIP_LABELS[g.relationship] ?? g.relationship}
                        </span>
                      </p>
                      <p>
                        <a href={`tel:${g.phone}`} className="text-brand-700 hover:underline">
                          {g.phone}
                        </a>
                        {g.email && <span className="text-slate-500"> · {g.email}</span>}
                        {g.occupation && <span className="text-slate-500"> · {g.occupation}</span>}
                      </p>
                      <div className="mt-1 flex gap-1">
                        {g.isPrimary && <Badge tone="blue">Main contact</Badge>}
                        {g.isFeePayer && <Badge>Pays fees</Badge>}
                      </div>
                    </div>
                    {manage && (
                      <div className="flex flex-wrap gap-1">
                        <Button variant="ghost" onClick={() => setEditingGuardian(g.id)}>
                          Edit
                        </Button>
                        {!g.isPrimary && (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              act(() =>
                                patch(`/students/${s.id}/guardians/${g.id}`, { isPrimary: true }),
                              )
                            }
                          >
                            Make main contact
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          onClick={() =>
                            act(() =>
                              patch(`/students/${s.id}/guardians/${g.id}`, {
                                isFeePayer: !g.isFeePayer,
                              }),
                            )
                          }
                        >
                          {g.isFeePayer ? 'Not fee payer' : 'Pays fees'}
                        </Button>
                        {!g.isPrimary && (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`Unlink ${g.fullName} from ${fullName(s)}?`))
                                void act(() => del(`/students/${s.id}/guardians/${g.id}`));
                            }}
                          >
                            Unlink
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          title="Record that this parent acknowledged the current privacy notice"
                          onClick={() =>
                            act(() =>
                              post(`/students/${s.id}/guardians/${g.id}/privacy-acknowledgements`, {
                                version: '1.0',
                                channel: 'in_person',
                              }),
                            )
                          }
                        >
                          Record privacy acknowledgement
                        </Button>
                      </div>
                    )}
                  </div>
                  {editingGuardian === g.id && (
                    <EditGuardian
                      g={g}
                      onDone={() => {
                        setEditingGuardian(null);
                        void reload();
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
            {addingGuardian && (
              <AddGuardian
                studentId={s.id}
                onDone={() => {
                  setAddingGuardian(false);
                  void reload();
                }}
              />
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Classes">
            <ul className="space-y-3 text-sm">
              {s.enrollments.map((e) => (
                <li key={e.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {e.className} {e.sectionName}
                        <span className="font-normal text-slate-500">
                          {' '}
                          · roll {e.rollNumber ?? '—'}
                        </span>
                      </p>
                      <p className="text-slate-500">
                        {e.yearName} · since {formatDate(e.enrolledOn)}
                        {e.leftOn ? ` · left ${formatDate(e.leftOn)}` : ''}
                      </p>
                    </div>
                    {manage &&
                      e.status === 'active' &&
                      e.yearStatus !== 'closed' &&
                      moving !== e.id && (
                        <Button variant="ghost" onClick={() => setMoving(e.id)}>
                          Change
                        </Button>
                      )}
                  </div>
                  {moving === e.id && (
                    <MoveSection
                      enrollment={e}
                      onDone={() => {
                        setMoving(null);
                        void reload();
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <FeesCard studentId={s.id} />
          <AttendanceCard studentId={s.id} />
          <DocumentsPanel owner={{ studentId: s.id }} canManage={manage} />
          <LeavingPanel s={s} onChange={() => void reload()} />
          <Card title="Privacy acknowledgements">
            {s.acknowledgements.length ? (
              <ul className="space-y-2 text-sm">
                {s.acknowledgements.map((a) => (
                  <li key={a.id}>
                    <p>
                      {guardianName(a.guardianId)} · notice v{a.noticeVersion}
                    </p>
                    <p className="text-slate-500">
                      {when(a.acknowledgedAt)} · {CHANNEL[a.channel] ?? a.channel}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">None recorded.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
