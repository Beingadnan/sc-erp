'use client';

import { useState } from 'react';
import { post } from '@/lib/api';
import type { StudentDetail, TransferCertificate } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Field, buttonStyles } from '@/components/ui';

const today = () => new Date().toISOString().slice(0, 10);

function LeavingForm({
  s,
  mode,
  onDone,
  onCancel,
}: {
  s: StudentDetail;
  mode: 'withdraw' | 'issue';
  onDone: () => void;
  onCancel: () => void;
}) {
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const submit = async (form: FormData) => {
    const body = {
      leftOn: form.get('leftOn'),
      reason: form.get('reason'),
      conduct: form.get('conduct'),
      remarks: String(form.get('remarks') ?? ''),
      issueTc: form.get('issueTc') === 'on',
    };
    const ok = await run(() =>
      mode === 'withdraw'
        ? post(`/students/${s.id}/withdraw`, body)
        : post(`/students/${s.id}/transfer-certificates`, body),
    );
    if (ok) onDone();
  };
  return (
    <form onSubmit={onSubmitForm(submit)} className="space-y-3">
      {error && !Object.keys(f).length && <Alert>{error.message}</Alert>}
      {mode === 'withdraw' && (
        <Alert tone="warning">
          The student will be marked as withdrawn and removed from class lists. This cannot be
          undone here.
        </Alert>
      )}
      <Field
        label="Date of leaving"
        name="leftOn"
        type="date"
        defaultValue={today()}
        error={f.leftOn}
      />
      <Field
        label="Reason for leaving"
        name="reason"
        placeholder="e.g. Family moving to another city"
        error={f.reason}
      />
      <Field label="General conduct" name="conduct" defaultValue="Good" error={f.conduct} />
      <Field
        label="Remarks (optional)"
        name="remarks"
        placeholder="e.g. All dues cleared"
        error={f.remarks}
      />
      {mode === 'withdraw' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="issueTc" defaultChecked /> Issue a transfer certificate now
        </label>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant={mode === 'withdraw' ? 'danger' : 'primary'}
          loading={pending}
        >
          {mode === 'withdraw' ? 'Withdraw student' : 'Issue certificate'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Withdrawal and transfer certificates for one student. */
export function LeavingPanel({ s, onChange }: { s: StudentDetail; onChange: () => void }) {
  const { can } = useSession();
  const canWithdraw = can('students.withdraw', s.campusId);
  const tcs = useApi<TransferCertificate[]>(`/students/${s.id}/transfer-certificates`);
  const [mode, setMode] = useState<'withdraw' | 'issue' | null>(null);
  const cancel = useAction();
  const hasIssued = tcs.data?.some((t) => t.status === 'issued');

  if (!canWithdraw && !tcs.data?.length) return null;

  const done = () => {
    setMode(null);
    void tcs.reload();
    onChange();
  };

  return (
    <Card title="Leaving school">
      <div className="space-y-4 text-sm">
        {cancel.error && <Alert>{cancel.error.message}</Alert>}
        {tcs.data && tcs.data.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {tcs.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{t.tcNumber}</span>{' '}
                  <Badge tone={t.status === 'issued' ? 'green' : 'neutral'}>{t.status}</Badge>
                  <span className="block text-xs text-slate-500">
                    {formatDate(t.issuedOn)}
                    {t.issuedByName ? ` · ${t.issuedByName}` : ''}
                    {t.cancelledReason ? ` · cancelled: ${t.cancelledReason}` : ''}
                  </span>
                </span>
                <span className="flex gap-1">
                  <a
                    href={`/api/v1/transfer-certificates/${t.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonStyles('ghost')}
                  >
                    Print
                  </a>
                  {canWithdraw && t.status === 'issued' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const reason = prompt('Why is this certificate being cancelled?');
                        if (!reason) return;
                        if (
                          await cancel.run(() =>
                            post(`/transfer-certificates/${t.id}/cancel`, { reason }),
                          )
                        ) {
                          void tcs.reload();
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canWithdraw &&
          (mode ? (
            <LeavingForm s={s} mode={mode} onDone={done} onCancel={() => setMode(null)} />
          ) : s.status === 'active' ? (
            <Button variant="secondary" onClick={() => setMode('withdraw')}>
              Withdraw student…
            </Button>
          ) : (
            !hasIssued && (
              <Button variant="secondary" onClick={() => setMode('issue')}>
                Issue transfer certificate
              </Button>
            )
          ))}
      </div>
    </Card>
  );
}
