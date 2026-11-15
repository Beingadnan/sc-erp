'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { post } from '@/lib/api';
import { useAction, onSubmitForm } from '@/lib/use-api';
import { Alert, Button, Field } from '@/components/ui';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const { pending, error, run } = useAction();

  const submit = async (form: FormData) => {
    const ok = await run(async () => {
      await post('/auth/password/reset', { token, password: form.get('password') });
      return true;
    });
    if (ok) setDone(true);
  };

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">Your password was changed. All other sessions were signed out.</Alert>
        <Link href="/login" className="text-sm text-brand-700 hover:underline">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmitForm(submit)} className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      {error && <Alert>{error.fields.password ?? error.message}</Alert>}
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        autoFocus
      />
      <Button type="submit" loading={pending} disabled={!token}>
        Set password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
