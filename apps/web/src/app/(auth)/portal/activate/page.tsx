'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { useAction, onSubmitForm } from '@/lib/use-api';
import { Alert, Button, Field, Skeleton } from '@/components/ui';

interface Peek {
  status: 'open' | 'expired' | 'used';
  purpose: 'activate' | 'reset';
  schoolName: string;
  guardianFirstName: string;
  phone: string;
  hasAccount: boolean;
}

function Activate() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [peek, setPeek] = useState<Peek | null>(null);
  const [bad, setBad] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const { pending, error, run } = useAction();

  useEffect(() => {
    if (!token) {
      setBad(true);
      return;
    }
    post<Peek>('/portal/activate/peek', { token })
      .then(setPeek)
      .catch(() => setBad(true));
  }, [token]);

  if (bad) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Link not found</h1>
        <p className="text-sm text-slate-600">
          Open the full link the school sent you, or ask the school office for a new one.
        </p>
      </div>
    );
  }
  if (!peek) return <Skeleton rows={4} />;
  if (peek.status !== 'open') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">
          {peek.status === 'used' ? 'This link was already used' : 'This link has expired'}
        </h1>
        <p className="text-sm text-slate-600">
          {peek.status === 'used'
            ? 'Sign in with your mobile number and password.'
            : 'Ask the school office for a new link.'}
        </p>
        <Link href="/login">
          <Button>Go to sign in</Button>
        </Link>
      </div>
    );
  }

  const existing = peek.purpose === 'activate' && peek.hasAccount;
  const submit = async (form: FormData) => {
    const password = String(form.get('password') ?? '');
    if (!existing && password !== form.get('confirm')) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    const ok = await run(() => post('/portal/activate', { token, password }));
    if (ok) router.replace('/parent');
  };

  return (
    <form onSubmit={onSubmitForm(submit)} className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-brand-700">{peek.schoolName}</p>
        <h1 className="mt-1 text-xl font-semibold">
          {peek.purpose === 'reset'
            ? 'Set a new password'
            : existing
              ? `Welcome back, ${peek.guardianFirstName}`
              : `Welcome, ${peek.guardianFirstName}`}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {existing
            ? `Mobile ${peek.phone} already has a parent account. Enter its password to add this school.`
            : `You will sign in with mobile ${peek.phone} and this password.`}
        </p>
      </div>
      {error && <Alert>{error.fields.password ?? error.message}</Alert>}
      {mismatch && <Alert>The two passwords do not match.</Alert>}
      <Field
        label={existing ? 'Your password' : 'New password'}
        name="password"
        type="password"
        autoComplete={existing ? 'current-password' : 'new-password'}
        hint={existing ? undefined : 'At least 8 characters.'}
        required
        autoFocus
      />
      {!existing && (
        <Field
          label="Type it again"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
      )}
      <Button type="submit" loading={pending}>
        {existing
          ? 'Add this school'
          : peek.purpose === 'reset'
            ? 'Save password'
            : 'Start using the app'}
      </Button>
    </form>
  );
}

export default function PortalActivatePage() {
  return (
    <Suspense>
      <Activate />
    </Suspense>
  );
}
