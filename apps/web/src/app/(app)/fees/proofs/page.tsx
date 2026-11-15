'use client';

import Link from 'next/link';
import { useState } from 'react';
import { post } from '@/lib/api';
import type { ProofDetail, ProofRow, ProofStatus } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { MODE_LABEL, RupeeField, inr, receiptPdf } from '@/components/fees/money';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Skeleton,
  Table,
  Td,
} from '@/components/ui';

const TONE = { pending: 'amber', approved: 'green', rejected: 'red' } as const;
const LABEL = { pending: 'To check', approved: 'Approved', rejected: 'Rejected' } as const;

export default function ProofsPage() {
  const { campus, picker } = useCampus();
  const [status, setStatus] = useState<ProofStatus>('pending');
  const [open, setOpen] = useState<string | null>(null);
  const list = useApi<{ items: ProofRow[]; pending: number; hasMore: boolean }>(
    campus ? `/fees/payment-proofs?campusId=${campus.id}&status=${status}` : null,
  );

  return (
    <>
      <PageHeader
        title="Payments to check"
        description="Screenshots parents uploaded after paying the school account. Match each UTR and amount with your bank statement, then approve to issue the receipt."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            {picker}
            <ButtonLink href="/settings/payments" variant="secondary">
              Payment details
            </ButtonLink>
          </div>
        }
      />
      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1 text-sm" role="tablist">
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            onClick={() => {
              setStatus(s);
              setOpen(null);
            }}
            className={`rounded-md px-3 py-1.5 font-medium ${status === s ? 'bg-white shadow-xs' : 'text-slate-600'}`}
          >
            {LABEL[s]}
            {s === 'pending' && list.data ? ` (${list.data.pending})` : ''}
          </button>
        ))}
      </div>
      {list.error && <Alert>{list.error.message}</Alert>}
      <div className={`grid gap-6 ${open ? 'lg:grid-cols-[1fr_420px]' : ''}`}>
        <Card>
          {!list.data ? (
            <Skeleton rows={5} />
          ) : !list.data.items.length ? (
            <EmptyState title={status === 'pending' ? 'Nothing to check' : 'None yet'}>
              {status === 'pending' &&
                'Send payment links from a student’s fee page; uploads appear here.'}
            </EmptyState>
          ) : (
            <Table head={['Student', 'Amount', 'UTR / reference', 'Paid on', 'Status', '']}>
              {list.data.items.map((p) => (
                <tr key={p.id} className={open === p.id ? 'bg-brand-50/50' : undefined}>
                  <Td>
                    <Link
                      className="font-medium hover:underline"
                      href={`/students/${p.studentId}/fees`}
                    >
                      {p.studentName}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {p.admissionNumber} · {p.className}
                    </div>
                  </Td>
                  <Td className="tabular-nums">
                    {inr(p.amount)}
                    {p.amount !== p.askedAmount && (
                      <div className="text-xs text-amber-700">Asked {inr(p.askedAmount)}</div>
                    )}
                  </Td>
                  <Td>
                    <span className="font-mono text-xs">{p.reference}</span>
                    <div className="text-xs text-slate-500">
                      {MODE_LABEL[p.mode]} · {p.payerName}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(p.paidOn)}</Td>
                  <Td>
                    <Badge tone={TONE[p.status]}>{LABEL[p.status]}</Badge>
                    {p.receiptNumber && p.paymentId && (
                      <a
                        className="block font-mono text-xs text-brand-700 hover:underline"
                        href={receiptPdf(p.paymentId)}
                        target="_blank"
                        rel="noopener"
                      >
                        {p.receiptNumber}
                      </a>
                    )}
                    {p.decisionNote && (
                      <div className="text-xs text-slate-500">{p.decisionNote}</div>
                    )}
                  </Td>
                  <Td>
                    <Button variant="secondary" onClick={() => setOpen(p.id)}>
                      {p.status === 'pending' ? 'Check' : 'View'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {open && (
          <ProofPanel
            key={open}
            id={open}
            onClose={() => setOpen(null)}
            onDone={() => {
              setOpen(null);
              void list.reload();
            }}
          />
        )}
      </div>
    </>
  );
}

function ProofPanel({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { can } = useSession();
  const proof = useApi<ProofDetail>(`/fees/payment-proofs/${id}`);
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const act = useAction();
  const p = proof.data;

  return (
    <Card
      title="Check payment"
      actions={
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      }
    >
      {proof.error && <Alert>{proof.error.message}</Alert>}
      {!p ? (
        <Skeleton rows={6} />
      ) : (
        <div className="flex flex-col gap-4">
          <a href={p.fileUrl} target="_blank" rel="noopener" className="block">
            {p.contentType === 'application/pdf' ? (
              <span className="text-sm text-brand-700 underline">Open the uploaded PDF</span>
            ) : (
              <img
                src={p.fileUrl}
                alt="Payment screenshot"
                className="max-h-96 w-full rounded-lg border object-contain"
              />
            )}
          </a>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Amount paid</dt>
            <dd className="font-medium tabular-nums">{inr(p.amount)}</dd>
            {p.askedAmount !== null && (
              <>
                <dt className="text-slate-500">Link asked for</dt>
                <dd className="tabular-nums">{inr(p.askedAmount)}</dd>
              </>
            )}
            <dt className="text-slate-500">UTR / reference</dt>
            <dd className="font-mono text-xs">{p.reference}</dd>
            <dt className="text-slate-500">Paid on</dt>
            <dd>
              {formatDate(p.paidOn)} · {MODE_LABEL[p.mode]}
            </dd>
            <dt className="text-slate-500">Paid by</dt>
            <dd>
              {p.payerName}
              {p.payerPhone && <div className="text-xs text-slate-500">{p.payerPhone}</div>}
            </dd>
          </dl>
          {p.otherProofs.length > 0 && (
            <Alert tone="info">
              Other uploads on this link:{' '}
              {p.otherProofs
                .map((o) => `${inr(o.amount)} (${o.reference}, ${o.status})`)
                .join('; ')}
            </Alert>
          )}
          {act.error && <Alert>{act.error.message}</Alert>}
          {p.status === 'pending' && can('fees.collect') ? (
            rejecting ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await act.run(() => post(`/fees/payment-proofs/${id}/reject`, { note })))
                    onDone();
                }}
              >
                <Field
                  label="Reason (the parent will see this)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Amount not received in the bank yet"
                  required
                  minLength={3}
                />
                <div className="flex gap-2">
                  <Button type="submit" variant="danger" loading={act.pending}>
                    Reject
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRejecting(false)}
                  >
                    Back
                  </Button>
                </div>
              </form>
            ) : (
              <form
                className="flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const body = { note, ...(amount !== null ? { amount } : {}) };
                  if (await act.run(() => post(`/fees/payment-proofs/${id}/approve`, body)))
                    onDone();
                }}
              >
                <RupeeField
                  label="Amount received in bank"
                  value={amount ?? p.amount}
                  onChange={setAmount}
                  hint="Change only if the bank statement shows a different amount."
                />
                <Field
                  label="Note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="submit" loading={act.pending}>
                    Approve and issue receipt
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setRejecting(true)}>
                    Reject…
                  </Button>
                </div>
              </form>
            )
          ) : (
            p.decisionNote && <p className="text-sm text-slate-600">{p.decisionNote}</p>
          )}
        </div>
      )}
    </Card>
  );
}
