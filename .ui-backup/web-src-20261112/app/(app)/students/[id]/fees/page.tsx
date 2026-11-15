'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { del, post } from '@/lib/api';
import type { ConcessionType, StudentDetail, StudentFeeAccount } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import {
  DemandBadge,
  MODE_LABEL,
  RECEIPT_LABEL,
  RECEIPT_TONE,
  RupeeField,
  concessionValue,
  inr,
  receiptPdf,
} from '@/components/fees/money';
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

type Invoice = StudentFeeAccount['invoices'][number];

const SOURCE_LABEL: Record<string, string> = {
  invoice: 'Fees due',
  payment: 'Payment',
  advance: 'Advance used',
  concession: 'Concession',
  adjustment: 'Waiver',
  late_fee: 'Late fee',
};

export default function StudentFeesPage() {
  const { id } = useParams<{ id: string }>();
  const student = useApi<StudentDetail>(`/students/${id}`);
  const [year, setYear] = useState('');
  const acct = useApi<StudentFeeAccount>(
    `/fees/students/${id}${year ? `?academicYearId=${year}` : ''}`,
  );
  const a = acct.data;
  const name = student.data ? `${student.data.firstName} ${student.data.lastName}`.trim() : '';

  return (
    <>
      <PageHeader
        title={name ? `${name} — fees` : 'Fees'}
        description={
          a
            ? `${a.enrollment.className} ${a.enrollment.sectionName} · ${a.enrollment.yearName}`
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-end gap-3">
            {a && a.years.length > 1 && (
              <SelectField
                label="Year"
                value={year || a.enrollment.academicYearId}
                onChange={(e) => setYear(e.target.value)}
                className="w-32"
              >
                {a.years.map((y) => (
                  <option key={y.academicYearId} value={y.academicYearId}>
                    {y.yearName}
                  </option>
                ))}
              </SelectField>
            )}
            {a?.can.collect && (
              <Link href={`/fees/collect?studentId=${id}`}>
                <Button>Take payment</Button>
              </Link>
            )}
            <Link className="text-sm text-brand-700 hover:underline" href={`/students/${id}`}>
              Student profile
            </Link>
          </div>
        }
      />
      {acct.error && <Alert>{acct.error.message}</Alert>}
      {!a ? (
        <Skeleton rows={6} />
      ) : (
        <div className="flex flex-col gap-6">
          {a.totals.advance > 0 && (
            <Alert tone="info">
              {inr(a.totals.advance)} paid in advance is held for future fees.
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Billed" value={inr(a.totals.billed)} />
            <Stat label="Paid" value={inr(a.totals.paid)} />
            <Stat label="Outstanding" value={inr(Math.max(a.totals.balance, 0))} strong />
            <Stat label="Overdue" value={inr(a.totals.overdue)} red={a.totals.overdue > 0} />
          </div>

          <Card
            title="Demands"
            description={
              a.totals.reduced
                ? `Concessions and waivers so far: ${inr(a.totals.reduced)}`
                : undefined
            }
          >
            {!a.invoices.length ? (
              <EmptyState title="Nothing billed yet" />
            ) : (
              <div className="flex flex-col divide-y divide-slate-100">
                {a.invoices.map((v) => (
                  <InvoiceBlock key={v.id} v={v} can={a.can} onDone={acct.reload} />
                ))}
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Concessions a={a} studentId={id} onDone={acct.reload} />
            <Optional a={a} studentId={id} onDone={acct.reload} />
          </div>

          <Card title="Receipts">
            {!a.payments.length ? (
              <EmptyState title="No payments yet" />
            ) : (
              <Table head={['Receipt', 'Date', 'Mode', 'Amount', 'Status']}>
                {a.payments.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <a
                        className="font-mono text-xs text-brand-700 hover:underline"
                        href={receiptPdf(p.id)}
                        target="_blank"
                        rel="noopener"
                      >
                        {p.receiptNumber}
                      </a>
                    </Td>
                    <Td>{formatDate(p.receivedOn)}</Td>
                    <Td>
                      {MODE_LABEL[p.mode] ?? p.mode}
                      {p.reference && <div className="text-xs text-slate-500">{p.reference}</div>}
                    </Td>
                    <Td className="tabular-nums">{inr(p.amount)}</Td>
                    <Td>
                      <Badge tone={RECEIPT_TONE[p.status]}>{RECEIPT_LABEL[p.status]}</Badge>
                      {p.cancelReason && (
                        <div className="text-xs text-slate-500">{p.cancelReason}</div>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card
            title="Statement"
            description="Every amount billed or taken off this student's account, in order."
          >
            {!a.statement.length ? (
              <EmptyState title="No entries yet" />
            ) : (
              <Table head={['Date', 'Details', 'Charged', 'Reduced', 'Balance']}>
                {a.statement.map((s, i) => (
                  <tr key={i}>
                    <Td className="whitespace-nowrap">{formatDate(s.date)}</Td>
                    <Td>
                      <span className="text-slate-500">
                        {SOURCE_LABEL[s.sourceType] ?? s.sourceType}
                      </span>
                      {s.reversal && (
                        <span className="ml-1">
                          <Badge tone="neutral">Reversal</Badge>
                        </span>
                      )}
                      <div>{s.memo}</div>
                    </Td>
                    <Td className="tabular-nums">{s.debit ? inr(s.debit) : ''}</Td>
                    <Td className="tabular-nums">{s.credit ? inr(s.credit) : ''}</Td>
                    <Td className="font-medium tabular-nums">{inr(s.balance)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  strong,
  red,
}: {
  label: string;
  value: string;
  strong?: boolean;
  red?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 text-xl tabular-nums ${strong ? 'font-semibold' : ''} ${red ? 'font-semibold text-red-700' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

function InvoiceBlock({
  v,
  can,
  onDone,
}: {
  v: Invoice;
  can: StudentFeeAccount['can'];
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(v.state === 'overdue' || v.state === 'due');
  const [waive, setWaive] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const action = useAction();
  const pendingWaivers = v.adjustments.filter((x) => x.kind === 'waiver' && x.status === 'pending');
  return (
    <div className="py-3">
      <button
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          <span className="font-medium">{v.structureName}</span>{' '}
          <span className="text-slate-500">· {v.installmentLabel}</span>
          <span className="ml-2 text-sm text-slate-500">due {formatDate(v.dueOn)}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="tabular-nums">
            {v.status === 'cancelled' ? inr(v.billed) : inr(Math.max(v.balance, 0))}
          </span>
          <DemandBadge state={v.state} />
        </span>
      </button>
      {open && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
          {v.status === 'cancelled' && (
            <p className="mb-2 text-slate-600">Cancelled: {v.cancelReason}</p>
          )}
          <table className="w-full">
            <tbody>
              {v.lines.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="py-1">
                    {l.headName}
                    {l.pending > 0 && (
                      <span className="ml-2 text-xs text-amber-700">
                        {inr(l.pending)} waiver pending
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right tabular-nums">{inr(l.amount)}</td>
                  <td className="py-1 pl-3 text-right tabular-nums text-emerald-700">
                    {l.reduced ? `− ${inr(l.reduced)}` : ''}
                    {l.paid ? <div className="text-slate-600">paid {inr(l.paid)}</div> : null}
                  </td>
                  <td className="py-1 pl-3 text-right">
                    {can.waive &&
                      v.status === 'active' &&
                      l.amount - l.reduced - l.pending - l.paid > 0 &&
                      waive !== l.id && (
                        <button
                          className="text-xs text-brand-700 hover:underline"
                          onClick={() => {
                            setWaive(l.id);
                            setAmount(l.amount - l.reduced - l.pending - l.paid);
                          }}
                        >
                          Waive
                        </button>
                      )}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 font-medium">
                <td className="py-1">Outstanding</td>
                <td />
                <td />
                <td className="py-1 text-right tabular-nums">{inr(Math.max(v.balance, 0))}</td>
              </tr>
            </tbody>
          </table>
          {waive && (
            <form
              className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3"
              onSubmit={onSubmitForm(async (f) => {
                const res = await action.run(() =>
                  post(`/fees/demands/${v.id}/waivers`, {
                    lineId: waive,
                    amount,
                    reason: f.get('reason'),
                  }),
                );
                if (res) {
                  setWaive(null);
                  await onDone();
                }
              })}
            >
              <RupeeField label="Waive" value={amount} onChange={setAmount} className="w-32" />
              <Field label="Reason" name="reason" required minLength={3} className="w-64" />
              <Button type="submit" loading={action.pending} disabled={!amount}>
                {can.approve ? 'Waive' : 'Ask for approval'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setWaive(null)}>
                Cancel
              </Button>
            </form>
          )}
          {pendingWaivers.length > 0 && can.approve && (
            <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3">
              {pendingWaivers.map((w) => (
                <WaiverDecision key={w.id} w={w} onDone={onDone} />
              ))}
            </div>
          )}
          {can.configure && v.status === 'active' && (
            <div className="mt-3 border-t border-slate-200 pt-3">
              {cancelling ? (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={onSubmitForm(async (f) => {
                    if (
                      await action.run(() =>
                        post(`/fees/demands/${v.id}/cancel`, { reason: f.get('reason') }),
                      )
                    ) {
                      setCancelling(false);
                      await onDone();
                    }
                  })}
                >
                  <Field
                    label="Why cancel this demand?"
                    name="reason"
                    required
                    minLength={3}
                    className="w-72"
                  />
                  <Button type="submit" variant="danger" loading={action.pending}>
                    Cancel demand
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setCancelling(false)}>
                    Back
                  </Button>
                </form>
              ) : (
                <button
                  className="text-xs text-slate-500 underline"
                  onClick={() => setCancelling(true)}
                >
                  Cancel this demand…
                </button>
              )}
            </div>
          )}
          {action.error && (
            <div className="mt-2">
              <Alert>{action.error.message}</Alert>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WaiverDecision({
  w,
  onDone,
}: {
  w: Invoice['adjustments'][number];
  onDone: () => Promise<void>;
}) {
  const action = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const decide = async (status: 'approved' | 'rejected') => {
    if (await action.run(() => post(`/fees/waivers/${w.id}/decision`, { status, note })))
      await onDone();
  };
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <span>
        Waiver of {inr(w.amount)} asked: “{w.reason}”
      </span>
      {rejecting ? (
        <span className="flex items-end gap-1">
          <Field
            label="Reason"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-48"
          />
          <Button
            variant="danger"
            disabled={note.trim().length < 3}
            loading={action.pending}
            onClick={() => decide('rejected')}
          >
            Reject
          </Button>
          <Button variant="ghost" onClick={() => setRejecting(false)}>
            Back
          </Button>
        </span>
      ) : (
        <span className="flex gap-1">
          <Button loading={action.pending} onClick={() => decide('approved')}>
            Approve
          </Button>
          <Button variant="secondary" onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </span>
      )}
      {action.error && <p className="w-full text-xs text-red-600">{action.error.message}</p>}
    </div>
  );
}

const C_TONE = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
  revoked: 'neutral',
} as const;

function Concessions({
  a,
  studentId,
  onDone,
}: {
  a: StudentFeeAccount;
  studentId: string;
  onDone: () => Promise<void>;
}) {
  const types = useApi<ConcessionType[]>(
    a.can.configure || a.can.approve ? '/fees/concession-types' : null,
  );
  const action = useAction();
  const [typeId, setTypeId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="Concessions">
      {!a.concessions.length ? (
        <p className="text-sm text-slate-500">None this year.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {a.concessions.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{c.typeName}</span> ·{' '}
                {concessionValue(c.mode, c.value)}
                <div className="text-xs text-slate-500">{c.reason}</div>
              </span>
              <Badge tone={C_TONE[c.status]}>
                {c.status[0]!.toUpperCase() + c.status.slice(1)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {(a.can.configure || a.can.approve) && types.data && (
        <form
          className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4"
          onSubmit={onSubmitForm(async (f) => {
            setMsg(null);
            const res = await action.run(() =>
              post<{ status: string; amount: number }>('/fees/concessions', {
                studentId,
                academicYearId: a.enrollment.academicYearId,
                concessionTypeId: typeId,
                reason: f.get('reason'),
              }),
            );
            if (res) {
              setMsg(
                res.status === 'approved'
                  ? `Approved; ${inr(res.amount)} taken off.`
                  : 'Sent for approval.',
              );
              setTypeId('');
              await onDone();
            }
          })}
        >
          <SelectField
            label="Give a concession"
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            required
          >
            <option value="">Choose…</option>
            {types.data
              .filter((t) => t.active)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {concessionValue(t.mode, t.value)}
                </option>
              ))}
          </SelectField>
          {typeId && (
            <>
              <Field label="Reason" name="reason" required minLength={3} />
              <div>
                <Button type="submit" loading={action.pending}>
                  {a.can.approve ? 'Give concession' : 'Ask for approval'}
                </Button>
              </div>
            </>
          )}
          {msg && <Alert tone="success">{msg}</Alert>}
          {action.error && <Alert>{action.error.message}</Alert>}
          <p className="text-xs text-slate-500">
            Amounts per student (e.g. scholarships) and approvals are on the{' '}
            <Link className="underline" href="/fees/concessions">
              Concessions
            </Link>{' '}
            page.
          </p>
        </form>
      )}
    </Card>
  );
}

function Optional({
  a,
  studentId,
  onDone,
}: {
  a: StudentFeeAccount;
  studentId: string;
  onDone: () => Promise<void>;
}) {
  const action = useAction();
  if (!a.optional.length) {
    return (
      <Card title="Optional fees">
        <p className="text-sm text-slate-500">
          No optional fees (transport, hostel…) are set up for this year.
        </p>
      </Card>
    );
  }
  return (
    <Card title="Optional fees" description="Billed when demands are raised for that fee.">
      <ul className="flex flex-col gap-2 text-sm">
        {a.optional.map((o) => (
          <li key={o.structureId} className="flex items-center justify-between gap-2">
            <span>
              {o.name} {o.assignmentId && <Badge tone="green">On</Badge>}
            </span>
            {a.can.configure &&
              (o.assignmentId ? (
                <button
                  className="text-xs text-slate-500 underline"
                  onClick={async () => {
                    if (
                      await action.run(() =>
                        del(`/fees/structures/${o.structureId}/students/${o.assignmentId}`),
                      )
                    )
                      await onDone();
                  }}
                >
                  Remove
                </button>
              ) : (
                <button
                  className="text-xs text-brand-700 underline"
                  onClick={async () => {
                    if (
                      await action.run(() =>
                        post(`/fees/structures/${o.structureId}/students`, { studentId }),
                      )
                    )
                      await onDone();
                  }}
                >
                  Add
                </button>
              ))}
          </li>
        ))}
      </ul>
      {action.error && (
        <div className="mt-2">
          <Alert>{action.error.message}</Alert>
        </div>
      )}
    </Card>
  );
}
