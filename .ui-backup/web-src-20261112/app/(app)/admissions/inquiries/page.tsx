'use client';

import Link from 'next/link';
import { useState } from 'react';
import { patch, post } from '@/lib/api';
import type { Campus, Inquiry } from '@/lib/api';
import { blank } from '@/lib/format';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
} from '@/components/ui';

const SOURCE = {
  website: 'Website',
  walk_in: 'Walk-in',
  phone: 'Phone',
  referral: 'Referral',
  other: 'Other',
} as const;
const STATUS_TONE = { new: 'blue', contacted: 'amber', closed: 'neutral' } as const;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

function WalkInForm({ campuses, onDone }: { campuses: Campus[]; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const submit = async (form: FormData) => {
    const ok = await run(() =>
      post('/inquiries', {
        parentName: form.get('parentName'),
        phone: form.get('phone'),
        email: blank(form.get('email')),
        studentName: blank(form.get('studentName')),
        classSought: blank(form.get('classSought')),
        campusId: blank(form.get('campusId')),
        message: String(form.get('message') ?? ''),
        source: form.get('source'),
        consent: form.get('consent') === 'on',
      }),
    );
    if (ok) onDone();
  };
  return (
    <form onSubmit={onSubmitForm(submit)} className="grid gap-4 sm:grid-cols-3">
      {error && !Object.keys(f).length && (
        <div className="sm:col-span-3">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field label="Parent's name" name="parentName" error={f.parentName} required />
      <Field label="Mobile number" name="phone" type="tel" error={f.phone} required />
      <SelectField label="How did they reach us?" name="source" defaultValue="walk_in">
        <option value="walk_in">Walk-in</option>
        <option value="phone">Phone call</option>
        <option value="referral">Referral</option>
        <option value="other">Other</option>
      </SelectField>
      <Field label="Child's name" name="studentName" error={f.studentName} />
      <Field label="Class for admission" name="classSought" error={f.classSought} />
      <SelectField
        label="Campus"
        name="campusId"
        defaultValue={campuses.length === 1 ? campuses[0]!.id : ''}
        error={f.campusId}
      >
        <option value="">Not decided</option>
        {campuses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <Field label="Email" name="email" type="email" error={f.email} />
      <Field label="Notes" name="message" className="sm:col-span-2" error={f.message} />
      <label className="flex items-start gap-2 text-sm sm:col-span-3">
        <input type="checkbox" name="consent" className="mt-1" />
        <span>
          The parent agreed to be contacted about admission.
          {f.consent && <span className="block text-xs text-red-600">{f.consent}</span>}
        </span>
      </label>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" loading={pending}>
          Save inquiry
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function InquiriesPage() {
  const { can, tenant } = useSession();
  const [status, setStatus] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const query = `/inquiries?limit=25${status ? `&status=${status}` : ''}${cursor ? `&cursor=${cursor}` : ''}`;
  const { data, loading, error, reload } = useApi<{ data: Inquiry[]; nextCursor: string | null }>(
    query,
  );
  const campuses = useApi<Campus[]>('/campuses');
  const [adding, setAdding] = useState(false);
  const change = useAction();
  const manage = can('admissions.manage');
  const campusName = (id: string | null) => campuses.data?.find((c) => c.id === id)?.name;

  return (
    <>
      <PageHeader
        title="Admission inquiries"
        description={
          tenant
            ? `Inquiries from your website form (/s/${tenant.slug}/inquiry) and those recorded by staff.`
            : undefined
        }
        actions={
          manage && !adding && <Button onClick={() => setAdding(true)}>Record inquiry</Button>
        }
      />
      {adding && (
        <Card title="Record a walk-in or phone inquiry" className="mb-6">
          <WalkInForm
            campuses={(campuses.data ?? []).filter((c) => c.status === 'active')}
            onDone={() => {
              setAdding(false);
              setCursor(null);
              void reload();
            }}
          />
        </Card>
      )}
      <div className="mb-4 flex items-end gap-3">
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursor(null);
          }}
          className="w-48"
        >
          <option value="">All</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="closed">Closed</option>
        </SelectField>
      </div>
      {change.error && (
        <div className="mb-4">
          <Alert>{change.error.message}</Alert>
        </div>
      )}
      {loading && !data ? (
        <Card>
          <Skeleton />
        </Card>
      ) : error ? (
        <Alert>{error.message}</Alert>
      ) : !data?.data.length ? (
        <Card>
          <EmptyState title="No inquiries">
            Share your website&apos;s inquiry form with parents, or record walk-ins here.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.data.map((q) => (
            <Card key={q.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 text-sm">
                  <p className="text-base font-medium">
                    {q.parentName}
                    {q.studentName && (
                      <span className="font-normal text-slate-500"> for {q.studentName}</span>
                    )}
                  </p>
                  <p>
                    <a href={`tel:${q.phone}`} className="text-brand-700 hover:underline">
                      {q.phone}
                    </a>
                    {q.email && (
                      <>
                        {' · '}
                        <a href={`mailto:${q.email}`} className="text-brand-700 hover:underline">
                          {q.email}
                        </a>
                      </>
                    )}
                  </p>
                  <p className="text-slate-600">
                    {[q.classSought, campusName(q.campusId), SOURCE[q.source], when(q.createdAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {q.message && <p className="whitespace-pre-line text-slate-700">{q.message}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {manage && q.status !== 'closed' && (
                    <Link
                      href={`/admissions/applications/new?${new URLSearchParams({
                        inquiryId: q.id,
                        parentName: q.parentName,
                        phone: q.phone,
                        email: q.email ?? '',
                        studentName: q.studentName ?? '',
                        classSought: q.classSought ?? '',
                        message: q.message,
                      })}`}
                    >
                      <Button variant="secondary">Start application</Button>
                    </Link>
                  )}
                  <Badge tone={STATUS_TONE[q.status]}>{q.status}</Badge>
                  {manage && (
                    <select
                      aria-label={`Status of inquiry from ${q.parentName}`}
                      value={q.status}
                      onChange={async (e) => {
                        await change.run(() =>
                          patch(`/inquiries/${q.id}`, { status: e.target.value }),
                        );
                        void reload();
                      }}
                      className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm"
                    >
                      <option value="new">New</option>
                      <option value="contacted">Contacted</option>
                      <option value="closed">Closed</option>
                    </select>
                  )}
                </div>
              </div>
            </Card>
          ))}
          <div className="flex gap-2">
            {cursor && (
              <Button variant="secondary" onClick={() => setCursor(null)}>
                Back to newest
              </Button>
            )}
            {data.nextCursor && (
              <Button variant="secondary" onClick={() => setCursor(data.nextCursor)}>
                Older inquiries
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
