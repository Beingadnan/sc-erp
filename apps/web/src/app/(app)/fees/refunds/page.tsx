'use client';

import Link from 'next/link';
import { useState } from 'react';
import { post } from '@/lib/api';
import type { RefundRow } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { MODE_LABEL, inr } from '@/components/fees/money';
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

const REFUND_TONE = { requested: 'amber', paid: 'green', rejected: 'red' } as const;
const LABEL = { requested: 'Waiting for approval', paid: 'Paid', rejected: 'Rejected' } as const;
const SOURCE = { advance: 'Advance', deposit: 'Deposit' } as const;

export default function RefundsPage() {
  const { campus, picker } = useCampus();
  const [status, setStatus] = useState('');
  const list = useApi<{ items: RefundRow[] }>(
    campus ? `/fees/refunds?campusId=${campus.id}${status ? `&status=${status}` : ''}` : null,
  );
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Refunds"
        description="Refunds of unused advance or refundable deposits. One person asks from the student's fee page; a different person approves and records the payout."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            {picker}
            <SelectField
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-48"
            >
              <option value="">All</option>
              <option value="requested">Waiting for approval</option>
              <option value="paid">Paid</option>
              <option value="rejected">Rejected</option>
            </SelectField>
          </div>
        }
      />
      {list.error && <Alert>{list.error.message}</Alert>}
      <Card>
        {!list.data ? (
          <Skeleton rows={5} />
        ) : !list.data.items.length ? (
          <EmptyState title="No refunds">Ask for a refund from a student’s fee page.</EmptyState>
        ) : (
          <Table head={['Student', 'Amount', 'From', 'Reason', 'Status', '']}>
            {list.data.items.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link
                    className="font-medium hover:underline"
                    href={`/students/${r.studentId}/fees`}
                  >
                    {r.studentName}
                  </Link>
                  <div className="text-xs text-slate-500">{r.admissionNumber}</div>
                </Td>
                <Td className="tabular-nums">
                  {inr(r.amount)}
                  <div className="text-xs text-slate-500">{MODE_LABEL[r.mode]}</div>
                </Td>
                <Td>{SOURCE[r.source]}</Td>
                <Td>
                  {r.reason}
                  <div className="text-xs text-slate-500">
                    Asked by {r.requestedByName ?? '—'} · {formatDate(r.createdAt)}
                  </div>
                </Td>
                <Td>
                  <Badge tone={REFUND_TONE[r.status]}>{LABEL[r.status]}</Badge>
                  {r.refundNumber && (
                    <div className="font-mono text-xs">
                      {r.refundNumber}
                      {r.paidOn && ` · ${formatDate(r.paidOn)}`}
                    </div>
                  )}
                  {r.reference && <div className="text-xs text-slate-500">{r.reference}</div>}
                  {r.decisionNote && <div className="text-xs text-slate-500">{r.decisionNote}</div>}
                </Td>
                <Td>
                  {r.status === 'requested' && (
                    <Button
                      variant="secondary"
                      onClick={() => setOpen(open === r.id ? null : r.id)}
                    >
                      Decide
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {open && list.data && (
        <Decide
          key={open}
          r={list.data.items.find((x) => x.id === open)!}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            void list.reload();
          }}
        />
      )}
    </>
  );
}

function Decide({ r, onClose, onDone }: { r: RefundRow; onClose: () => void; onDone: () => void }) {
  const { can } = useSession();
  const [mode, setMode] = useState<string>(r.mode);
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [note, setNote] = useState('');
  const act = useAction();
  const allowed = can('fees.cancel_receipt');

  return (
    <Card
      className="mt-6"
      title={`Refund ${inr(r.amount)} to ${r.studentName}`}
      description={`${SOURCE[r.source]} · ${r.reason}`}
      actions={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      {!allowed ? (
        <Alert tone="info">Someone who can cancel receipts must approve refunds.</Alert>
      ) : r.mine ? (
        <Alert tone="info">You asked for this refund, so someone else must approve it.</Alert>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = { mode, reference, note, ...(paidOn ? { paidOn } : {}) };
            if (await act.run(() => post(`/fees/refunds/${r.id}/pay`, body))) onDone();
          }}
        >
          <SelectField
            label="Paid by"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="w-40"
          >
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="upi">UPI</option>
          </SelectField>
          <Field
            label={mode === 'cheque' ? 'Cheque number' : 'Reference / UTR'}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            required={mode !== 'cash'}
            className="w-48"
          />
          <Field
            label="Date"
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            className="w-40"
          />
          <Field
            label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-56"
          />
          <Button type="submit" loading={act.pending}>
            Approve and record payout
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={note.trim().length < 3}
            title="Write a note to reject"
            onClick={async () => {
              if (await act.run(() => post(`/fees/refunds/${r.id}/reject`, { note }))) onDone();
            }}
          >
            Reject
          </Button>
        </form>
      )}
      {act.error && (
        <div className="mt-3">
          <Alert>{act.error.message}</Alert>
        </div>
      )}
    </Card>
  );
}
