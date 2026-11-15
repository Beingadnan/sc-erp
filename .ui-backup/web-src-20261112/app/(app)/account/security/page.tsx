'use client';

import QRCode from 'qrcode';
import { useState } from 'react';
import { del, post } from '@/lib/api';
import { useAction, useApi, onSubmitForm } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  Skeleton,
  Table,
  Td,
} from '@/components/ui';

interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

const describeAgent = (ua: string | null) => {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return [browser, os].filter(Boolean).join(' on ');
};

function TwoStep() {
  const { me, reload } = useSession();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const action = useAction();

  const start = async () => {
    const r = await action.run(() =>
      post<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup'),
    );
    if (r)
      setSetup({
        secret: r.secret,
        qr: await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 180 }),
      });
  };

  const enable = async (form: FormData) => {
    const r = await action.run(() =>
      post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code: form.get('code') }),
    );
    if (r) {
      setSetup(null);
      setCodes(r.recoveryCodes);
      await reload();
    }
  };

  const disable = async (form: FormData) => {
    const ok = await action.run(async () => {
      await post('/auth/mfa/disable', { password: form.get('password'), code: form.get('code') });
      return true;
    });
    if (ok) {
      setDisabling(false);
      await reload();
    }
  };

  return (
    <Card
      title="Two-step verification"
      description="Sign-ins need a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy)."
      actions={
        me.user.mfaEnabled ? <Badge tone="green">On</Badge> : <Badge tone="amber">Off</Badge>
      }
    >
      <div className="flex flex-col gap-4">
        {action.error && <Alert>{action.error.message}</Alert>}
        {codes && (
          <Alert tone="success">
            <p className="font-medium">Save these recovery codes somewhere safe.</p>
            <p className="mb-2">
              Each one works once if you lose your phone. They will not be shown again.
            </p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Alert>
        )}
        {!me.user.mfaEnabled && !setup && (
          <div>
            <Button onClick={start} loading={action.pending}>
              Set up two-step verification
            </Button>
          </div>
        )}
        {setup && (
          <form
            onSubmit={onSubmitForm(enable)}
            className="flex flex-col gap-4 sm:flex-row sm:items-start"
          >
            <img
              src={setup.qr}
              alt="QR code for your authenticator app"
              width={180}
              height={180}
              className="rounded-lg border border-slate-200"
            />
            <div className="flex flex-1 flex-col gap-3">
              <p className="text-sm text-slate-600">
                Scan the code with your app, or enter this key:{' '}
                <code className="break-all font-mono text-xs">{setup.secret}</code>
              </p>
              <Field
                label="6-digit code from the app"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
              <div>
                <Button type="submit" loading={action.pending}>
                  Turn on
                </Button>
              </div>
            </div>
          </form>
        )}
        {me.user.mfaEnabled && !disabling && (
          <div>
            <Button variant="secondary" onClick={() => setDisabling(true)}>
              Turn off
            </Button>
          </div>
        )}
        {disabling && (
          <form onSubmit={onSubmitForm(disable)} className="grid max-w-lg gap-3 sm:grid-cols-2">
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <Field label="Current code" name="code" inputMode="numeric" required />
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" variant="danger" loading={action.pending}>
                Turn off two-step verification
              </Button>
              <Button type="button" variant="secondary" onClick={() => setDisabling(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

function Sessions() {
  const { data, loading, reload } = useApi<SessionRow[]>('/auth/sessions');
  const action = useAction();
  return (
    <Card title="Where you are signed in">
      {action.error && <Alert>{action.error.message}</Alert>}
      {loading && !data ? (
        <Skeleton />
      ) : (
        <Table head={['Device', 'IP address', 'Last active', '']}>
          {data?.map((s) => (
            <tr key={s.id}>
              <Td>
                {describeAgent(s.userAgent)} {s.current && <Badge tone="blue">This device</Badge>}
              </Td>
              <Td>{s.ip ?? '—'}</Td>
              <Td>
                {new Date(s.lastSeenAt).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </Td>
              <Td className="text-right">
                {!s.current && (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await action.run(() => del(`/auth/sessions/${s.id}`));
                      void reload();
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function ChangePassword() {
  const action = useAction();
  const [done, setDone] = useState(false);
  const submit = async (form: FormData) => {
    setDone(false);
    const ok = await action.run(async () => {
      await post('/auth/password/change', {
        currentPassword: form.get('currentPassword'),
        newPassword: form.get('newPassword'),
      });
      return true;
    });
    if (ok) setDone(true);
  };
  return (
    <Card title="Password">
      <form onSubmit={onSubmitForm(submit)} className="flex max-w-md flex-col gap-4">
        {done && <Alert tone="success">Password changed. Other devices were signed out.</Alert>}
        {action.error && !Object.keys(action.error.fields).length && (
          <Alert>{action.error.message}</Alert>
        )}
        <Field
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          error={action.error?.fields.currentPassword}
        />
        <Field
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          error={action.error?.fields.newPassword}
        />
        <div>
          <Button type="submit" loading={action.pending}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function SecurityPage() {
  return (
    <>
      <PageHeader
        title="Security"
        description="Protect your account and see where you are signed in."
      />
      <div className="flex flex-col gap-6">
        <TwoStep />
        <ChangePassword />
        <Sessions />
      </div>
    </>
  );
}
