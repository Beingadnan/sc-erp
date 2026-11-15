'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { post } from '@/lib/api';
import { useAction, onSubmitForm } from '@/lib/use-api';
import { Alert, Button, Field } from '@/components/ui';

function Accept() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const { pending, error, run } = useAction();

  const submit = async (form: FormData) => {
    const ok = await run(() =>
      post('/auth/invite/accept', { token, password: form.get('password') }),
    );
    if (ok) router.replace('/dashboard');
  };

  return (
    <form onSubmit={onSubmitForm(submit)} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Join your school</h1>
        <p className="mt-1 text-sm text-slate-600">
          Set a password to finish creating your account.
        </p>
      </div>
      {error && <Alert>{error.fields.password ?? error.message}</Alert>}
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters."
        required
        autoFocus
      />
      <Button type="submit" loading={pending} disabled={!token}>
        Accept invitation
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <Accept />
    </Suspense>
  );
}
