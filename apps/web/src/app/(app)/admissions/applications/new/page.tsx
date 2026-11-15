'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { RELATIONSHIPS } from '@school-erp/validation';
import { post } from '@/lib/api';
import type { AcademicYear, GradeLevel } from '@/lib/api';
import { RELATIONSHIP_LABELS } from '@/lib/format';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { Alert, Button, Card, Field, PageHeader, SelectField, Skeleton } from '@/components/ui';

function NewApplication() {
  const router = useRouter();
  const params = useSearchParams();
  const inquiryId = params.get('inquiryId');
  const { campus, picker } = useCampus();
  const years = useApi<AcademicYear[]>(campus ? `/academic-years?campusId=${campus.id}` : null);
  const classes = useApi<GradeLevel[]>(campus ? `/classes?campusId=${campus.id}` : null);
  const [yearId, setYearId] = useState('');
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const [first, ...rest] = (params.get('studentName') ?? '').trim().split(/\s+/);

  useEffect(() => {
    const list = (years.data ?? []).filter((y) => y.status !== 'closed');
    // New admissions usually target the next session once it exists.
    setYearId(
      (list.find((y) => y.status === 'planned') ?? list.find((y) => y.isCurrent) ?? list[0])?.id ??
        '',
    );
  }, [years.data]);

  const submit = async (form: FormData) => {
    const res = await run(() =>
      post<{ id: string }>('/applications', {
        campusId: campus?.id,
        academicYearId: yearId,
        gradeLevelId: form.get('gradeLevelId'),
        inquiryId: inquiryId ?? null,
        ...(inquiryId ? {} : { source: form.get('source') }),
        firstName: form.get('firstName'),
        lastName: form.get('lastName'),
        dateOfBirth: form.get('dateOfBirth'),
        gender: form.get('gender'),
        previousSchool: form.get('previousSchool'),
        guardianName: form.get('guardianName'),
        guardianPhone: form.get('guardianPhone'),
        guardianEmail: form.get('guardianEmail'),
        guardianRelationship: form.get('guardianRelationship'),
        notes: String(form.get('notes') ?? ''),
      }),
    );
    if (res) router.push(`/admissions/applications/${res.id}`);
  };

  return (
    <>
      <PageHeader
        title="New application"
        description={inquiryId ? 'Started from a website or office inquiry.' : undefined}
      />
      <form onSubmit={onSubmitForm(submit)} className="space-y-6" noValidate>
        {error && (
          <Alert>
            {error.message}
            {Object.keys(f).length > 0 && ' Check the highlighted fields.'}
          </Alert>
        )}
        <Card title="Applying for">
          <div className="space-y-4">
            {picker}
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                label="Academic year"
                value={yearId}
                onChange={(e) => setYearId(e.target.value)}
                error={f.academicYearId}
              >
                {(years.data ?? [])
                  .filter((y) => y.status !== 'closed')
                  .map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                    </option>
                  ))}
              </SelectField>
              <SelectField label="Class" name="gradeLevelId" defaultValue="" error={f.gradeLevelId}>
                <option value="" disabled>
                  {params.get('classSought') ? `Asked for: ${params.get('classSought')}` : 'Choose'}
                </option>
                {(classes.data ?? [])
                  .filter((c) => c.status === 'active')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </SelectField>
              {!inquiryId && (
                <SelectField label="How did they reach us?" name="source" defaultValue="walk_in">
                  <option value="walk_in">Walk-in</option>
                  <option value="phone">Phone call</option>
                  <option value="referral">Referral</option>
                  <option value="website">Website</option>
                  <option value="other">Other</option>
                </SelectField>
              )}
            </div>
          </div>
        </Card>
        <Card title="Child">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="First name"
              name="firstName"
              defaultValue={first ?? ''}
              error={f.firstName}
            />
            <Field
              label="Last name"
              name="lastName"
              defaultValue={rest.join(' ')}
              error={f.lastName}
            />
            <Field label="Date of birth" name="dateOfBirth" type="date" error={f.dateOfBirth} />
            <SelectField label="Gender" name="gender" defaultValue="" error={f.gender}>
              <option value="" disabled>
                Choose
              </option>
              <option value="female">Girl</option>
              <option value="male">Boy</option>
              <option value="other">Other</option>
            </SelectField>
            <Field
              label="Previous school (optional)"
              name="previousSchool"
              className="sm:col-span-2"
              error={f.previousSchool}
            />
          </div>
        </Card>
        <Card title="Parent / guardian">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Name"
              name="guardianName"
              defaultValue={params.get('parentName') ?? ''}
              error={f.guardianName}
            />
            <Field
              label="Mobile number"
              name="guardianPhone"
              type="tel"
              defaultValue={params.get('phone') ?? ''}
              error={f.guardianPhone}
            />
            <SelectField label="Relationship" name="guardianRelationship" defaultValue="mother">
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {RELATIONSHIP_LABELS[r]}
                </option>
              ))}
            </SelectField>
            <Field
              label="Email (optional)"
              name="guardianEmail"
              type="email"
              defaultValue={params.get('email') ?? ''}
              error={f.guardianEmail}
            />
            <Field
              label="Notes"
              name="notes"
              defaultValue={params.get('message') ?? ''}
              className="sm:col-span-2"
              error={f.notes}
            />
          </div>
        </Card>
        <Button type="submit" loading={pending} disabled={!campus || !yearId}>
          Create application
        </Button>
      </form>
    </>
  );
}

export default function NewApplicationPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <NewApplication />
    </Suspense>
  );
}
