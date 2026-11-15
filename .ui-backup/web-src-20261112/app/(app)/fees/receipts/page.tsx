'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import type { PaymentList } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { MODE_LABEL, RECEIPT_LABEL, RECEIPT_TONE, inr, receiptPdf } from '@/components/fees/money';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
  Table,
  Td,
} from '@/components/ui';

export default function ReceiptsPage() {
  const { campus, picker } = useCampus();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [from, to, mode, status, debounced]);
  const query = new URLSearchParams();
  if (campus) query.set('campusId', campus.id);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (mode) query.set('mode', mode);
  if (status) query.set('status', status);
  if (debounced) query.set('q', debounced);
  query.set('page', String(page));
  const list = useApi<PaymentList>(campus ? `/fees/payments?${query}` : null);
  const d = list.data;
  useEffect(() => {
    if (d && !from) {
      setFrom(d.from);
      setTo(d.to);
    }
  }, [d, from]);

  return (
    <>
      <PageHeader
        title="Receipts"
        description="Payments received. Cheques stay pending until you mark them cleared or bounced."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            {picker}
            <Link href="/fees/collect">
              <Button>Take a payment</Button>
            </Link>
          </div>
        }
      />
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label="From"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
          />
          <Field
            label="To"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
          />
          <SelectField
            label="Mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="w-40"
          >
            <option value="">All modes</option>
            {Object.entries(MODE_LABEL)
              .filter(([k]) => k !== 'online')
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </SelectField>
          <SelectField
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-44"
          >
            <option value="">All</option>
            <option value="cleared">Received</option>
            <option value="pending">Cheque pending</option>
            <option value="bounced">Bounced</option>
            <option value="cancelled">Cancelled</option>
          </SelectField>
          <Field
            label="Search"
            placeholder="Receipt, student, reference"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-56"
          />
        </div>
      </Card>
      {list.error && <Alert>{list.error.message}</Alert>}
      {!d ? (
        <Skeleton rows={5} />
      ) : (
        <Card
          title={`${inr(d.totalAmount)} received`}
          description={
            d.byMode.length
              ? d.byMode
                  .map((m) => `${MODE_LABEL[m.mode]} ${inr(m.amount)} (${m.receipts})`)
                  .join(' · ')
              : 'No receipts in this period'
          }
        >
          {!d.data.length ? (
            <EmptyState title="No receipts" />
          ) : (
            <>
              <Table head={['Receipt', 'Student', 'Mode', 'Amount', 'Status', '']}>
                {d.data.map((p) => (
                  <ReceiptRow key={p.id} p={p} can={d.can} onDone={list.reload} />
                ))}
              </Table>
              {d.total > d.pageSize && (
                <div className="mt-4 flex justify-end gap-2 text-sm">
                  <Button
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={page * d.pageSize >= d.total}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </>
  );
}

function ReceiptRow({
  p,
  can,
  onDone,
}: {
  p: PaymentList['data'][number];
  can: PaymentList['can'];
  onDone: () => Promise<void>;
}) {
  const action = useAction();
  const [mode, setMode] = useState<null | 'bounce' | 'cancel'>(null);
  const [reason, setReason] = useState('');
  const act = async (path: string, body: object) => {
    if (await action.run(() => post(`/fees/payments/${p.id}/${path}`, body))) {
      setMode(null);
      setReason('');
      await onDone();
    }
  };
  const live = p.status === 'cleared' || p.status === 'pending';
  return (
    <tr className={live ? '' : 'text-slate-400'}>
      <Td>
        <a
          className="font-mono text-xs text-brand-700 hover:underline"
          href={receiptPdf(p.id)}
          target="_blank"
          rel="noopener"
        >
          {p.receiptNumber}
        </a>
        <div className="text-xs text-slate-500">
          {formatDate(p.receivedOn)} · {p.collectedBy ?? '—'}
          {p.dayClosed && ' · day closed'}
        </div>
      </Td>
      <Td>
        <Link className="hover:underline" href={`/students/${p.studentId}/fees`}>
          {p.studentName}
        </Link>
        <div className="text-xs text-slate-500">{p.admissionNumber}</div>
      </Td>
      <Td>
        {MODE_LABEL[p.mode]}
        {p.reference && <div className="text-xs text-slate-500">{p.reference}</div>}
      </Td>
      <Td className="tabular-nums">{inr(p.amount)}</Td>
      <Td>
        <Badge tone={RECEIPT_TONE[p.status]}>{RECEIPT_LABEL[p.status]}</Badge>
      </Td>
      <Td className="text-right">
        {action.error && <p className="mb-1 text-xs text-red-600">{action.error.message}</p>}
        {!mode && (
          <div className="flex justify-end gap-2 text-sm">
            {p.status === 'pending' && can.collect && (
              <>
                <button className="text-brand-700 hover:underline" onClick={() => act('clear', {})}>
                  Cleared
                </button>
                <button className="text-red-700 hover:underline" onClick={() => setMode('bounce')}>
                  Bounced
                </button>
              </>
            )}
            {live && can.cancel && (
              <button className="text-slate-500 hover:underline" onClick={() => setMode('cancel')}>
                Cancel
              </button>
            )}
          </div>
        )}
        {mode && (
          <div className="flex flex-col items-end gap-1">
            <Field
              label={mode === 'bounce' ? 'Bank’s reason' : 'Why cancel?'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-56"
            />
            <div className="flex gap-1">
              <Button
                variant="danger"
                disabled={reason.trim().length < 3}
                loading={action.pending}
                onClick={() => act(mode, { reason })}
              >
                {mode === 'bounce' ? 'Mark bounced' : 'Cancel receipt'}
              </Button>
              <Button variant="ghost" onClick={() => setMode(null)}>
                Back
              </Button>
            </div>
          </div>
        )}
      </Td>
    </tr>
  );
}
