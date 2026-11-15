'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { post } from '@/lib/api';
import { useAction, onSubmitForm } from '@/lib/use-api';
import { Alert, Button, Field } from '@/components/ui';

/** Parents sign in here with the mobile number the school has for them. */
export default function ParentLoginPage() {
  const router = useRouter();
  const { pending, error, run } = useAction();

  const submit = async (form: FormData) => {
    const r = await run(() =>
      post('/auth/login', {
        phone: form.get('phone'),
        password: form.get('password'),
        as: 'parent',
      }),
    );
    if (r) router.replace('/parent');
  };

  return (
    <form onSubmit={onSubmitForm(submit)} className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase">Parents</p>
        <h1 className="mt-1 text-xl font-semibold">Parent sign in</h1>
        <p className="mt-1 text-sm text-slate-600">
          See your child&apos;s attendance, fees and receipts, and pay fees.
        </p>
      </div>
      {error && <Alert>{error.message}</Alert>}
      <Field
        label="Mobile number"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="98290 12345"
        hint="The number you gave the school."
        required
        autoFocus
      />
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
      <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        <p className="font-medium text-slate-800">First time or forgot your password?</p>
        <p className="mt-0.5">
          Ask the school office to send you the parent app link on WhatsApp. Open it and set your
          password.
        </p>
      </div>
      <p className="border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
        School staff?{' '}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Staff sign in
        </Link>
      </p>
    </form>
  );
}
