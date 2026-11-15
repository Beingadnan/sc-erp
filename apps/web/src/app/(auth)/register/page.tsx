'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BOARDS } from '@school-erp/validation';
import { post } from '@/lib/api';
import { useAction, onSubmitForm } from '@/lib/use-api';
import { Alert, Button, Field, SelectField } from '@/components/ui';

const BOARD_LABELS: Record<(typeof BOARDS)[number], string> = {
  CBSE: 'CBSE',
  RBSE: 'Rajasthan Board (RBSE)',
  CISCE: 'CISCE (ICSE / ISC)',
  STATE_OTHER: 'Other state board',
  IB: 'IB',
  CAMBRIDGE: 'Cambridge',
  OTHER: 'Other',
};

const toSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export default function RegisterPage() {
  const router = useRouter();
  const [schoolName, setSchoolName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};

  const submit = async (form: FormData) => {
    const ok = await run(() =>
      post('/auth/register-school', {
        schoolName,
        slug,
        campusName: form.get('campusName'),
        board: form.get('board'),
        fullName: form.get('fullName'),
        email: form.get('email'),
        password: form.get('password'),
      }),
    );
    if (ok) router.replace('/dashboard');
  };

  return (
    <form onSubmit={onSubmitForm(submit)} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Register your school</h1>
        <p className="mt-1 text-sm text-slate-600">
          You will be the school owner. You can add campuses and staff later.
        </p>
      </div>
      {error && !Object.keys(f).length && <Alert>{error.message}</Alert>}
      <Field
        label="School name"
        name="schoolName"
        value={schoolName}
        onChange={(e) => {
          setSchoolName(e.target.value);
          if (!slugTouched) setSlug(toSlug(e.target.value));
        }}
        error={f.schoolName}
        required
      />
      <Field
        label="School address"
        name="slug"
        value={slug}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value.toLowerCase());
        }}
        hint={slug ? `${slug}.schoolerp.in — lowercase letters, numbers and hyphens` : undefined}
        error={f.slug}
        required
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="First campus"
          name="campusName"
          defaultValue="Main Campus"
          error={f.campusName}
          required
        />
        <SelectField label="Board" name="board" defaultValue="CBSE" error={f.board}>
          {BOARDS.map((b) => (
            <option key={b} value={b}>
              {BOARD_LABELS[b]}
            </option>
          ))}
        </SelectField>
      </div>
      <hr className="border-slate-200" />
      <Field
        label="Your full name"
        name="fullName"
        autoComplete="name"
        error={f.fullName}
        required
      />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        error={f.email}
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters. A short sentence works well."
        error={f.password}
        required
      />
      <Button type="submit" loading={pending}>
        Create school account
      </Button>
      <p className="text-center text-sm text-slate-600">
        Already registered?{' '}
        <Link href="/login" className="text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
