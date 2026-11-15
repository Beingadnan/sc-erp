'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { post } from '@/lib/api';
import { useAction, onSubmitForm } from '@/lib/use-api';
import { Alert, Button, Field } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const [useRecovery, setUseRecovery] = useState(false);
  const { pending, error, run } = useAction();

  const submitPassword = async (form: FormData) => {
    const r = await run(() =>
      post<{ status: 'ok' | 'mfa_required' }>('/auth/login', {
        email: form.get('email'),
        password: form.get('password'),
      }),
    );
    if (r?.status === 'mfa_required') setStep('mfa');
    else if (r) router.replace('/dashboard');
  };

  const submitCode = async (form: FormData) => {
    const body = useRecovery ? { recoveryCode: form.get('code') } : { code: form.get('code') };
    const r = await run(() => post('/auth/mfa/verify', body));
    if (r) router.replace('/dashboard');
  };

  if (step === 'mfa') {
    return (
      <form onSubmit={onSubmitForm(submitCode)} className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold">Two-step verification</h1>
          <p className="mt-1 text-sm text-slate-600">
            {useRecovery
              ? 'Enter one of your recovery codes.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </p>
        </div>
        {error && <Alert>{error.message}</Alert>}
        <Field
          label={useRecovery ? 'Recovery code' : 'Code'}
          name="code"
          inputMode={useRecovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          placeholder={useRecovery ? 'xxxxx-xxxxx' : '123456'}
          required
          autoFocus
        />
        <Button type="submit" loading={pending}>
          Verify
        </Button>
        <button
          type="button"
          className="text-sm text-brand-700 hover:underline"
          onClick={() => setUseRecovery((v) => !v)}
        >
          {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code'}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitForm(submitPassword)} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-slate-600">Welcome back.</p>
      </div>
      {error && <Alert>{error.message}</Alert>}
      <Field label="Email" name="email" type="email" autoComplete="email" required autoFocus />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" loading={pending}>
        Sign in
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-brand-700 hover:underline">
          Forgot password?
        </Link>
        <Link href="/register" className="text-brand-700 hover:underline">
          Register a school
        </Link>
      </div>
    </form>
  );
}
