'use client';

import { useState } from 'react';
import { post } from '@/lib/api';
import { onSubmitForm, useAction } from '@/lib/use-api';
import { Alert, Button, Field, SelectField } from '@/components/ui';

export function InquiryForm({
  school,
  campuses,
}: {
  school: string;
  campuses: Array<{ id: string; name: string }>;
}) {
  const { pending, error, run } = useAction();
  const [sent, setSent] = useState(false);
  const f = error?.fields ?? {};

  const submit = async (form: FormData) => {
    const ok = await run(() =>
      post(`/public/schools/${school}/inquiries`, {
        parentName: form.get('parentName'),
        phone: form.get('phone'),
        email: form.get('email'),
        studentName: form.get('studentName'),
        classSought: form.get('classSought'),
        campusId: form.get('campusId') ?? '',
        message: form.get('message'),
        consent: form.get('consent') === 'on',
        website: form.get('website'),
      }),
    );
    if (ok) setSent(true);
  };

  if (sent) {
    return (
      <Alert tone="success">
        Thank you. Your inquiry has been sent to the school office, and they will contact you soon.
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmitForm(submit)} className="grid gap-4 sm:grid-cols-2" noValidate>
      {error && !Object.keys(f).length && (
        <div className="sm:col-span-2">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field
        label="Parent's name"
        name="parentName"
        autoComplete="name"
        error={f.parentName}
        required
      />
      <Field
        label="Mobile number"
        name="phone"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        hint="10-digit mobile number"
        error={f.phone}
        required
      />
      <Field
        label="Email (optional)"
        name="email"
        type="email"
        autoComplete="email"
        error={f.email}
      />
      <Field label="Child's name (optional)" name="studentName" error={f.studentName} />
      <Field
        label="Class for admission (optional)"
        name="classSought"
        hint="e.g. Class 3 or UKG"
        error={f.classSought}
      />
      {campuses.length > 1 ? (
        <SelectField label="Campus" name="campusId" defaultValue="">
          <option value="">Not sure yet</option>
          {campuses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <input type="hidden" name="campusId" value={campuses[0]?.id ?? ''} />
      )}
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor="inq-message" className="text-sm font-medium text-slate-800">
          Message (optional)
        </label>
        <textarea
          id="inq-message"
          name="message"
          rows={4}
          maxLength={2000}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
        />
      </div>
      {/* Honeypot: hidden from people, often filled in by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2">
        <input type="checkbox" name="consent" className="mt-1" />
        <span>
          I agree that the school may contact me by phone, SMS, WhatsApp or email about admission.
          The details above are used only for this inquiry.
          {f.consent && <span className="block text-xs text-red-600">{f.consent}</span>}
        </span>
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending}>
          Send inquiry
        </Button>
      </div>
    </form>
  );
}
