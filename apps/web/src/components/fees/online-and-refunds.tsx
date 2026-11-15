'use client';

import { useState } from 'react';
import { post } from '@/lib/api';
import type { PaymentLinkCreated, PaymentLinkRow, RefundRow, Refundable } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useApi } from '@/lib/use-api';
import { MODE_LABEL, RupeeField, inr } from '@/components/fees/money';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  SelectField,
  Table,
  Td,
  buttonStyles,
} from '@/components/ui';

const LINK_TONE = {
  open: 'blue',
  paid: 'green',
  cancelled: 'neutral',
  expired: 'neutral',
} as const;
const REFUND_TONE = { requested: 'amber', paid: 'green', rejected: 'red' } as const;
const REFUND_LABEL = {
  requested: 'Waiting for approval',
  paid: 'Paid',
  rejected: 'Rejected',
} as const;

/** WhatsApp click-to-chat with the message ready (Indian numbers without the "+"). */
const whatsapp = (phone: string | null, text: string) =>
  `https://wa.me/${phone ? phone.replace(/\D/g, '') : ''}?text=${encodeURIComponent(text)}`;

/** Payment links sent to the family for this student. */
export function PaymentLinks({
  studentId,
  campusId,
  outstanding,
}: {
  studentId: string;
  campusId: string;
  outstanding: number;
}) {
  const { can } = useSession();
  const links = useApi<{ items: PaymentLinkRow[] }>(
    `/fees/payment-links?campusId=${campusId}&studentId=${studentId}`,
  );
  const [amount, setAmount] = useState<number | null>(null);
  const [days, setDays] = useState('7');
  const [created, setCreated] = useState<PaymentLinkCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const act = useAction();
  const collect = can('fees.collect', campusId);

  return (
    <Card
      title="Pay to school account"
      description="Send a link: the parent sees the school's bank / UPI details, pays, and uploads the screenshot for you to check."
    >
      <div className="flex flex-col gap-4">
        {collect && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setCopied(false);
              const r = await act.run(() =>
                post<PaymentLinkCreated>('/fees/payment-links', {
                  studentId,
                  expiresInDays: Number(days),
                  ...(amount ? { amount } : {}),
                }),
              );
              if (r) {
                setCreated(r);
                void links.reload();
              }
            }}
          >
            <RupeeField
              label="Amount"
              value={amount}
              onChange={setAmount}
              hint={`Leave empty for what is due (${inr(outstanding)} outstanding)`}
              className="w-56"
            />
            <SelectField
              label="Valid for"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-32"
            >
              {['3', '7', '15', '30'].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </SelectField>
            <Button type="submit" loading={act.pending}>
              Create payment link
            </Button>
          </form>
        )}
        {act.error && <Alert>{act.error.message}</Alert>}
        {created && (
          <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p>
              Link for <strong>{inr(created.amount)}</strong>, valid till{' '}
              {formatDate(created.expiresAt)}. Only someone with this link can open it.
            </p>
            <code className="break-all rounded bg-white px-2 py-1 text-xs">{created.url}</code>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(created.url);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <a
                href={whatsapp(created.guardianPhone, created.message)}
                target="_blank"
                rel="noopener"
                className={buttonStyles('secondary')}
              >
                Send on WhatsApp
              </a>
            </div>
          </div>
        )}
        {links.data && links.data.items.length > 0 && (
          <Table head={['Created', 'Amount', 'Status', '']}>
            {links.data.items.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap">
                  {formatDate(l.createdAt)}
                  <div className="text-xs text-slate-500">by {l.createdByName ?? '—'}</div>
                </Td>
                <Td className="tabular-nums">{inr(l.amount)}</Td>
                <Td>
                  <Badge tone={LINK_TONE[l.status]}>{l.status}</Badge>
                  {l.proofs > 0 && (
                    <div className="text-xs text-slate-500">
                      {l.proofs} upload{l.proofs > 1 ? 's' : ''}
                    </div>
                  )}
                </Td>
                <Td>
                  {collect && l.status === 'open' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (await act.run(() => post(`/fees/payment-links/${l.id}/cancel`))) {
                          void links.reload();
                        }
                      }}
                    >
                      Cancel link
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Card>
  );
}

/** Ask for a refund of advance or deposit; see past refunds. */
export function Refunds({ studentId, campusId }: { studentId: string; campusId: string }) {
  const { can } = useSession();
  const canAsk = can('fees.refund', campusId) || can('fees.cancel_receipt', campusId);
  const avail = useApi<Refundable>(canAsk ? `/fees/students/${studentId}/refundable` : null);
  const list = useApi<{ items: RefundRow[] }>(
    `/fees/refunds?campusId=${campusId}&studentId=${studentId}`,
  );
  const [source, setSource] = useState<'advance' | 'deposit'>('advance');
  const [amount, setAmount] = useState<number | null>(null);
  const [mode, setMode] = useState('bank_transfer');
  const [reason, setReason] = useState('');
  const act = useAction();
  const a = avail.data;
  const max = a ? a[source] : 0;

  if (!canAsk && !list.data?.items.length) return null;
  return (
    <Card
      title="Refunds"
      description="Unused advance or refundable deposits. A second person approves and pays the refund."
    >
      <div className="flex flex-col gap-4">
        {a && (a.advance > 0 || a.deposit > 0) ? (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act.run(() =>
                  post('/fees/refunds', { studentId, source, amount: amount ?? max, mode, reason }),
                )
              ) {
                setAmount(null);
                setReason('');
                void avail.reload();
                void list.reload();
              }
            }}
          >
            <SelectField
              label="Refund from"
              value={source}
              onChange={(e) => setSource(e.target.value as 'advance' | 'deposit')}
              className="w-48"
            >
              <option value="advance" disabled={!a.advance}>
                Advance ({inr(a.advance)})
              </option>
              <option value="deposit" disabled={!a.deposit}>
                Deposit ({inr(a.deposit)})
              </option>
            </SelectField>
            <RupeeField
              label="Amount"
              value={amount}
              onChange={setAmount}
              hint={`Up to ${inr(max)}`}
              className="w-40"
            />
            <SelectField
              label="Pay by"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-40"
            >
              <option value="bank_transfer">Bank transfer</option>
              <option value="upi">UPI</option>
              <option value="cheque">Cheque</option>
              <option value="cash">Cash</option>
            </SelectField>
            <Field
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              className="w-64"
            />
            <Button type="submit" loading={act.pending}>
              Ask for refund
            </Button>
          </form>
        ) : (
          canAsk && a && <p className="text-sm text-slate-500">Nothing to refund right now.</p>
        )}
        {act.error && <Alert>{act.error.message}</Alert>}
        {list.data && list.data.items.length > 0 && (
          <Table head={['Asked', 'Amount', 'Status']}>
            {list.data.items.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">
                  {formatDate(r.createdAt)}
                  <div className="text-xs text-slate-500">{r.reason}</div>
                </Td>
                <Td className="tabular-nums">
                  {inr(r.amount)}
                  <div className="text-xs text-slate-500">
                    {r.source === 'advance' ? 'Advance' : 'Deposit'} · {MODE_LABEL[r.mode]}
                  </div>
                </Td>
                <Td>
                  <Badge tone={REFUND_TONE[r.status]}>{REFUND_LABEL[r.status]}</Badge>
                  {r.refundNumber && <div className="font-mono text-xs">{r.refundNumber}</div>}
                  {r.decisionNote && <div className="text-xs text-slate-500">{r.decisionNote}</div>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Card>
  );
}
