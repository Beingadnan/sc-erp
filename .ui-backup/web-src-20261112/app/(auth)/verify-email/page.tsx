'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { Alert } from '@/components/ui';

function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    post('/auth/email/verify', { token })
      .then(() => setState('done'))
      .catch((e: unknown) => {
        setMessage(e instanceof ApiError ? e.message : 'Something went wrong');
        setState('failed');
      });
  }, [token]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Email confirmation</h1>
      {state === 'working' && <p className="text-sm text-slate-600">Confirming…</p>}
      {state === 'done' && <Alert tone="success">Your email address is confirmed.</Alert>}
      {state === 'failed' && <Alert>{message}</Alert>}
      <Link href="/dashboard" className="text-sm text-brand-700 hover:underline">
        Continue
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
