'use client';

import Link from 'next/link';
import { useState } from 'react';
import { post } from '@/lib/api';
import { useAction, onSubmitForm } from '@/lib/use-api';
import { Alert, Button, Field } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const { pending, error, run } = useAction();

  const submit = async (form: FormData) => {
    const ok = await run(() => post('/auth/password/forgot', { email: form.get('email') }));
    if (ok) setSent(true);
  };

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="text-sm text-slate-600">
          If an account exists for that address, we have sent a link to reset the password. It is
          valid for one hour.
        </p>
        <Link href="/login" className="text-sm text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmitForm(submit)} className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      {error && <Alert>{error.message}</Alert>}
      <Field label="Email" name="email" type="email" autoComplete="email" required autoFocus />
      <Button type="submit" loading={pending}>
        Send reset link
      </Button>
    </form>
  );
}
