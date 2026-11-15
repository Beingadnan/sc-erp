'use client';

import { useState } from 'react';
import { post } from '@/lib/api';
import type { PortalAccess, PortalInviteCreated } from '@/lib/api';
import { formatDate, RELATIONSHIP_LABELS } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Card } from '@/components/ui';

const whatsapp = (phone: string, text: string) =>
  `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

/** Which guardians can use the parent app, and links to give or reset access. */
export function PortalAccessCard({ studentId }: { studentId: string }) {
  const res = useApi<PortalAccess>(`/students/${studentId}/portal-access`);
  const act = useAction();
  const [link, setLink] = useState<(PortalInviteCreated & { guardianId: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (res.error || !res.data) return null;
  const manage = res.data.canManage;

  const create = async (guardianId: string, purpose: 'activate' | 'reset') => {
    setCopied(false);
    const r = await act.run(() =>
      post<PortalInviteCreated>('/portal/invites', { guardianId, purpose }),
    );
    if (r) {
      setLink({ ...r, guardianId });
      void res.reload();
    }
  };

  return (
    <Card
      title="Parent app access"
      description="Parents sign in with their mobile number to see attendance, fees and receipts, and to pay."
    >
      <div className="flex flex-col gap-3">
        {act.error && <Alert>{act.error.message}</Alert>}
        <ul className="divide-y divide-slate-100">
          {res.data.guardians.map((g) => (
            <li
              key={g.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {g.fullName}{' '}
                  <span className="text-xs font-normal text-slate-500">
                    {RELATIONSHIP_LABELS[g.relationship] ?? g.relationship}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {g.status === 'active'
                    ? `Signs in with ${g.loginPhone} · ${g.lastLoginAt ? `last seen ${formatDate(g.lastLoginAt)}` : 'not signed in yet'}`
                    : g.status === 'invited'
                      ? `Link sent, valid till ${formatDate(g.inviteExpiresAt!)}`
                      : g.phone}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    g.status === 'active' ? 'green' : g.status === 'invited' ? 'blue' : 'neutral'
                  }
                >
                  {g.status === 'active'
                    ? 'Has access'
                    : g.status === 'invited'
                      ? 'Invited'
                      : 'No access'}
                </Badge>
                {manage &&
                  (g.status === 'active' ? (
                    confirmRemove === g.id ? (
                      <>
                        <Button
                          variant="danger"
                          loading={act.pending}
                          onClick={async () => {
                            if (await act.run(() => post(`/portal/guardians/${g.id}/revoke`))) {
                              setConfirmRemove(null);
                              void res.reload();
                            }
                          }}
                        >
                          Yes, remove
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="secondary" onClick={() => void create(g.id, 'reset')}>
                          Password reset link
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmRemove(g.id)}>
                          Remove access
                        </Button>
                      </>
                    )
                  ) : (
                    <Button variant="secondary" onClick={() => void create(g.id, 'activate')}>
                      {g.status === 'invited' ? 'New link' : 'Give access'}
                    </Button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
        {link && (
          <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p>
              {link.purpose === 'reset' ? 'Password reset link' : 'Access link'} ready, valid till{' '}
              {formatDate(link.expiresAt)}. Send it only to {link.phone}.
            </p>
            <code className="break-all rounded bg-white px-2 py-1 text-xs">{link.url}</code>
            <div className="flex flex-wrap gap-2">
              <a href={whatsapp(link.phone, link.message)} target="_blank" rel="noopener">
                <Button type="button">Send on WhatsApp</Button>
              </a>
              <Button
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(link.url);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
