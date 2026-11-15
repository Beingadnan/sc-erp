'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { BLOOD_GROUPS, RELATIONSHIPS } from '@school-erp/validation';
import { api, post } from '@/lib/api';
import type { AdmissionNumberSettings, GuardianMatch } from '@/lib/api';
import { RELATIONSHIP_LABELS } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import { SectionPicker } from '@/components/students/section-picker';
import {
  CustomFieldInputs,
  readCustomFields,
  useCustomFields,
} from '@/components/students/custom-field-inputs';
import type { SectionChoice } from '@/components/students/section-picker';
import { Alert, Button, Card, Field, PageHeader, SelectField } from '@/components/ui';

interface GuardianDraft {
  key: number;
  /** Set when linking an existing guardian (sibling). */
  existing: GuardianMatch | null;
  matches: GuardianMatch[] | null;
  fullName: string;
  phone: string;
  email: string;
  occupation: string;
  relationship: string;
  isPrimary: boolean;
  isFeePayer: boolean;
}

let keySeq = 0;
const blankGuardian = (primary: boolean, relationship = 'mother'): GuardianDraft => ({
  key: ++keySeq,
  existing: null,
  matches: null,
  fullName: '',
  phone: '',
  email: '',
  occupation: '',
  relationship,
  isPrimary: primary,
  isFeePayer: primary,
});

const PRIVACY_NOTICE_VERSION = '1.0';

export default function AdmitStudentPage() {
  const { can } = useSession();
  const { campus, picker } = useCampus();
  const [choice, setChoice] = useState<SectionChoice>({
    academicYearId: null,
    gradeLevelId: null,
    sectionId: null,
  });
  const onChoice = useCallback((v: SectionChoice) => setChoice(v), []);
  const numbers = useApi<AdmissionNumberSettings>(
    choice.sectionId ? `/settings/admission-numbers?sectionId=${choice.sectionId}` : null,
  );
  const [guardians, setGuardians] = useState<GuardianDraft[]>([
    blankGuardian(true, 'mother'),
    blankGuardian(false, 'father'),
  ]);
  const [done, setDone] = useState<{
    id: string;
    admissionNumber: string;
    rollNumber: number;
  } | null>(null);
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const customDefs = useCustomFields('student');

  const setG = (key: number, patch: Partial<GuardianDraft>) =>
    setGuardians((gs) =>
      gs.map((g) =>
        g.key === key ? { ...g, ...patch } : patch.isPrimary ? { ...g, isPrimary: false } : g,
      ),
    );

  const lookup = async (g: GuardianDraft) => {
    const digits = g.phone.replace(/\D/g, '');
    if (digits.length < 10 || g.existing) return;
    try {
      const matches = await api<GuardianMatch[]>(`/guardians?phone=${encodeURIComponent(g.phone)}`);
      setG(g.key, { matches: matches.length ? matches : null });
    } catch {
      /* invalid number: the form will report it on submit */
    }
  };

  if (campus && !can('students.manage', campus.id)) {
    return (
      <>
        <PageHeader title="Admit a student" />
        <Alert>You do not have permission to admit students on this campus.</Alert>
      </>
    );
  }

  if (done) {
    return (
      <>
        <PageHeader title="Student admitted" />
        <Card>
          <Alert tone="success">
            Admission number <strong>{done.admissionNumber}</strong>, roll number {done.rollNumber}.
          </Alert>
          <div className="mt-4 flex gap-2">
            <Link href={`/students/${done.id}`}>
              <Button>Open student record</Button>
            </Link>
            <Button
              variant="secondary"
              onClick={() => {
                setDone(null);
                setGuardians([blankGuardian(true, 'mother'), blankGuardian(false, 'father')]);
                void numbers.reload();
              }}
            >
              Admit another student
            </Button>
          </div>
        </Card>
      </>
    );
  }

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const filled = guardians.filter((g) => g.existing || g.fullName.trim() || g.phone.trim());
    const res = await run(() =>
      post<{ id: string; admissionNumber: string; rollNumber: number }>('/students', {
        firstName: form.get('firstName'),
        lastName: form.get('lastName'),
        nameLocal: form.get('nameLocal'),
        dateOfBirth: form.get('dateOfBirth'),
        gender: form.get('gender'),
        bloodGroup: form.get('bloodGroup'),
        address: form.get('address'),
        pen: form.get('pen'),
        apaarId: form.get('apaarId'),
        aadhaar: form.get('aadhaar'),
        customFields: readCustomFields(form, customDefs),
        admissionDate: form.get('admissionDate') || undefined,
        sectionId: choice.sectionId ?? '',
        guardians: filled.map((g) =>
          g.existing
            ? {
                guardianId: g.existing.id,
                relationship: g.relationship,
                isPrimary: g.isPrimary,
                isFeePayer: g.isFeePayer,
              }
            : {
                fullName: g.fullName,
                phone: g.phone,
                email: g.email,
                occupation: g.occupation,
                relationship: g.relationship,
                isPrimary: g.isPrimary,
                isFeePayer: g.isFeePayer,
              },
        ),
        privacyNotice: {
          acknowledged: form.get('privacy') === 'on',
          version: PRIVACY_NOTICE_VERSION,
          channel: form.get('channel'),
        },
      }),
    );
    if (res) {
      setDone(res);
      window.scrollTo({ top: 0 });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <>
      <PageHeader
        title="Admit a student"
        description="Creates the student record, links parents and enrolls the student in a section."
      />
      <form onSubmit={submit} className="space-y-6" noValidate>
        {error && (
          <Alert>
            {error.message}
            {Object.keys(f).length > 0 && ' Check the highlighted fields.'}
          </Alert>
        )}

        <Card title="Class">
          <div className="space-y-4">
            {picker}
            {campus && (
              <SectionPicker
                campusId={campus.id}
                value={choice}
                onChange={onChoice}
                error={f.sectionId}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Admission date"
                name="admissionDate"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                error={f.admissionDate}
              />
              <Field
                label="Roll number"
                name="rollNumber"
                disabled
                placeholder="Next free number"
                hint="Given automatically; change it later on the student record"
              />
              {numbers.data?.next && (
                <div className="flex flex-col justify-end text-sm">
                  <span className="text-slate-500">Next admission number</span>
                  <span className="font-semibold">{numbers.data.next}</span>
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card title="Student">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="First name" name="firstName" error={f.firstName} required />
            <Field label="Last name" name="lastName" error={f.lastName} />
            <Field
              label="Name in Hindi (optional)"
              name="nameLocal"
              lang="hi"
              hint="As it should appear on certificates"
              error={f.nameLocal}
            />
            <Field
              label="Date of birth"
              name="dateOfBirth"
              type="date"
              error={f.dateOfBirth}
              required
            />
            <SelectField label="Gender" name="gender" defaultValue="" error={f.gender}>
              <option value="" disabled>
                Choose
              </option>
              <option value="female">Girl</option>
              <option value="male">Boy</option>
              <option value="other">Other</option>
            </SelectField>
            <SelectField label="Blood group" name="bloodGroup" defaultValue="" error={f.bloodGroup}>
              <option value="">Not known</option>
              {BLOOD_GROUPS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </SelectField>
            <Field label="Address" name="address" className="sm:col-span-3" error={f.address} />
            <CustomFieldInputs defs={customDefs} errors={f} />
          </div>
        </Card>

        <Card
          title="Identity numbers"
          description="Optional. Aadhaar is stored encrypted and shown masked; only authorised staff can see the full number, and every view is logged."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="PEN (UDISE+)"
              name="pen"
              inputMode="numeric"
              hint="11 digits"
              error={f.pen}
            />
            <Field
              label="APAAR ID"
              name="apaarId"
              inputMode="numeric"
              hint="12 digits"
              error={f.apaarId}
            />
            <Field
              label="Aadhaar"
              name="aadhaar"
              inputMode="numeric"
              autoComplete="off"
              hint="12 digits"
              error={f.aadhaar}
            />
          </div>
        </Card>

        <Card title="Parents and guardians" description="One of them is the main contact.">
          <div className="space-y-6">
            {f.guardians && <Alert>{f.guardians}</Alert>}
            {guardians.map((g, i) => (
              <fieldset key={g.key} className="rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-medium">
                  {i === 0 ? 'First parent / guardian' : `Parent / guardian ${i + 1}`}
                </legend>
                {g.existing ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p>
                      Linked to existing parent <strong>{g.existing.fullName}</strong> (
                      {g.existing.phone}
                      ), parent of{' '}
                      {g.existing.children.map((c) => c.name).join(', ') || 'no listed children'}.
                    </p>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => setG(g.key, { existing: null })}
                    >
                      Enter as new instead
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field
                      label="Mobile number"
                      type="tel"
                      value={g.phone}
                      onChange={(e) => setG(g.key, { phone: e.target.value, matches: null })}
                      onBlur={() => void lookup(g)}
                      error={f[`guardians.${i}.phone`]}
                    />
                    <Field
                      label="Full name"
                      value={g.fullName}
                      onChange={(e) => setG(g.key, { fullName: e.target.value })}
                      error={f[`guardians.${i}.fullName`]}
                    />
                    <Field
                      label="Email (optional)"
                      type="email"
                      value={g.email}
                      onChange={(e) => setG(g.key, { email: e.target.value })}
                      error={f[`guardians.${i}.email`]}
                    />
                    <Field
                      label="Occupation (optional)"
                      value={g.occupation}
                      onChange={(e) => setG(g.key, { occupation: e.target.value })}
                    />
                    {g.matches && (
                      <div className="sm:col-span-3">
                        <Alert tone="info">
                          {g.matches.map((m) => (
                            <span key={m.id} className="flex flex-wrap items-center gap-2">
                              <span>
                                <strong>{m.fullName}</strong> already has this number
                                {m.children.length > 0 &&
                                  ` (parent of ${m.children.map((c) => c.name).join(', ')})`}
                                . Is this a sibling?
                              </span>
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setG(g.key, { existing: m, matches: null })}
                              >
                                Link to {m.fullName}
                              </Button>
                            </span>
                          ))}
                        </Alert>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-end gap-4">
                  <SelectField
                    label="Relationship"
                    value={g.relationship}
                    onChange={(e) => setG(g.key, { relationship: e.target.value })}
                    className="w-44"
                  >
                    {RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {RELATIONSHIP_LABELS[r]}
                      </option>
                    ))}
                  </SelectField>
                  <label className="flex h-9 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="primary"
                      checked={g.isPrimary}
                      onChange={() => setG(g.key, { isPrimary: true })}
                    />
                    Main contact
                  </label>
                  <label className="flex h-9 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={g.isFeePayer}
                      onChange={(e) => setG(g.key, { isFeePayer: e.target.checked })}
                    />
                    Pays fees
                  </label>
                  {guardians.length > 1 && !g.isPrimary && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setGuardians((gs) => gs.filter((x) => x.key !== g.key))}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </fieldset>
            ))}
            {guardians.length < 4 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setGuardians((gs) => [...gs, blankGuardian(false, 'guardian')])}
              >
                Add another guardian
              </Button>
            )}
          </div>
        </Card>

        <Card title="Privacy notice">
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" name="privacy" className="mt-1" />
              <span>
                The main contact has been given the school&apos;s privacy notice (version{' '}
                {PRIVACY_NOTICE_VERSION}) and agrees to the school keeping this information to run
                the admission and their child&apos;s schooling.
                {f['privacyNotice.acknowledged'] && (
                  <span className="block text-xs text-red-600">
                    {f['privacyNotice.acknowledged']}
                  </span>
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
          </div>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" loading={pending} disabled={!choice.sectionId}>
            Admit student
          </Button>
          <Link href="/students">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </>
  );
}
