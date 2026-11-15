'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { post } from '@/lib/api';
import type { PaymentMode, PaymentResult, StudentFeeAccount, StudentListItem } from '@/lib/api';
import { formatDate, fullName } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { DemandBadge, MODE_LABEL, RupeeField, inr, receiptPdf } from '@/components/fees/money';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Skeleton,
  buttonStyles,
} from '@/components/ui';

const MODES: PaymentMode[] = ['cash', 'upi', 'cheque', 'dd', 'card', 'bank_transfer'];
const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function CollectPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Collect />
    </Suspense>
  );
}

function Collect() {
  const params = useSearchParams();
  const router = useRouter();
  const studentId = params.get('studentId');
  return (
    <>
      <PageHeader
        title="Fee counter"
        description="Find the student, take the payment, print the receipt."
        actions={
          <div className="flex gap-3 text-sm">
            <Link className="text-brand-700 hover:underline" href="/fees/receipts">
              Today’s receipts
            </Link>
            <Link className="text-brand-700 hover:underline" href="/fees/day-close">
              Close my day
            </Link>
          </div>
        }
      />
      <FindStudent onPick={(id) => router.replace(`/fees/collect?studentId=${id}`)} />
      {studentId && (
        <Counter
          key={studentId}
          studentId={studentId}
          onDone={() => router.replace('/fees/collect')}
        />
      )}
    </>
  );
}

function FindStudent({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const found = useApi<{ data: StudentListItem[] }>(
    debounced.length >= 2 ? `/students?limit=8&q=${encodeURIComponent(debounced)}` : null,
  );
  return (
    <Card className="mb-6">
      <Field
        label="Student"
        placeholder="Name, admission number or parent's phone"
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        className="max-w-lg"
      />
      {found.data && debounced.length >= 2 && (
        <ul className="mt-2 max-w-lg divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {found.data.data.length === 0 && (
            <li className="px-3 py-2 text-slate-500">No matching students</li>
          )}
          {found.data.data.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => {
                  setQ('');
                  onPick(s.id);
                }}
              >
                <span className="font-medium">{fullName(s)}</span>
                <span className="text-slate-500">
                  {' '}
                  · {s.admissionNumber} · {s.className} – {s.sectionName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Line = StudentFeeAccount['invoices'][number]['lines'][number] & {
  invoiceId: string;
  label: string;
  dueOn: string;
  outstanding: number;
};

function Counter({ studentId, onDone }: { studentId: string; onDone: () => void }) {
  const acct = useApi<StudentFeeAccount>(`/fees/students/${studentId}`);
  const a = acct.data;
  const lines: Line[] = useMemo(
    () =>
      (a?.invoices ?? [])
        .filter((v) => v.status === 'active')
        .flatMap((v) =>
          v.lines.map((l) => ({
            ...l,
            invoiceId: v.id,
            label: `${l.headName} · ${v.structureName} ${v.installmentLabel}`,
            dueOn: v.dueOn,
            outstanding: l.amount - l.reduced - l.paid,
          })),
        )
        .filter((l) => l.outstanding > 0),
    [a],
  );
  const due = lines.reduce((n, l) => n + l.outstanding, 0);
  const overdue = lines
    .filter((l) => l.dueOn < (a?.today ?? ''))
    .reduce((n, l) => n + l.outstanding, 0);

  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [choose, setChoose] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [reference, setReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [instrumentDate, setInstrumentDate] = useState('');
  const [receivedOn, setReceivedOn] = useState('');
  const [payerName, setPayerName] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(newKey);
  const [done, setDone] = useState<PaymentResult | null>(null);
  const action = useAction();
  const advance = useAction();

  // Default: everything due.
  useEffect(() => {
    if (!a) return;
    setPicked(Object.fromEntries(lines.map((l) => [l.id, true])));
    setAmount(due || null);
  }, [a, lines, due]);

  const chosenTotal = lines.filter((l) => picked[l.id]).reduce((n, l) => n + l.outstanding, 0);
  useEffect(() => {
    if (choose) setAmount(chosenTotal || null);
  }, [choose, chosenTotal]);

  const needsRef = mode !== 'cash';
  const isInstrument = mode === 'cheque' || mode === 'dd';
  const ready =
    !!amount &&
    amount > 0 &&
    (!needsRef || reference.trim().length >= (isInstrument ? 1 : 4)) &&
    (!isInstrument || (bankName.trim() && instrumentDate));

  const submit = async () => {
    if (!amount) return;
    const res = await action.run(() =>
      post<PaymentResult>('/fees/payments', {
        studentId,
        mode,
        amount,
        ...(receivedOn ? { receivedOn } : {}),
        reference: reference.trim(),
        bankName: bankName.trim(),
        ...(instrumentDate ? { instrumentDate } : {}),
        payerName: payerName.trim(),
        note: note.trim(),
        ...(choose
          ? {
              allocations: lines
                .filter((l) => picked[l.id])
                .map((l) => ({ lineId: l.id, amount: l.outstanding })),
            }
          : {}),
        idempotencyKey: key,
      }),
    );
    if (res) {
      setDone(res);
      setKey(newKey());
      await acct.reload();
    }
  };

  if (acct.error) return <Alert>{acct.error.message}</Alert>;
  if (!a) return <Skeleton rows={6} />;

  if (done) {
    return (
      <Card>
        <div className="flex flex-col items-start gap-4">
          <Alert tone="success">
            {done.repeated ? 'This payment was already recorded: ' : 'Payment recorded: '}
            receipt <strong>{done.receiptNumber}</strong> for {inr(done.amount)}
            {done.advance > 0 && <> ({inr(done.advance)} kept as advance)</>}
            {done.status === 'pending' && <> — cheque awaiting clearance</>}.
          </Alert>
          <div className="flex flex-wrap gap-2">
            <a
              href={receiptPdf(done.id)}
              target="_blank"
              rel="noopener"
              className={buttonStyles('primary')}
            >
              Print receipt
            </a>
            <Button
              variant="secondary"
              onClick={() => {
                setDone(null);
                setReference('');
                setNote('');
              }}
            >
              Another payment for this student
            </Button>
            <Button variant="ghost" size="sm" onClick={onDone}>
              Next student
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <Card
        title={`${a.enrollment.className} ${a.enrollment.sectionName} · ${a.enrollment.yearName}`}
        description={
          <span>
            Due {inr(due)}
            {overdue > 0 && (
              <span className="font-semibold text-red-700"> · {inr(overdue)} overdue</span>
            )}
            {a.totals.advance > 0 && <> · {inr(a.totals.advance)} held in advance</>}
          </span>
        }
        actions={
          <Link
            className="text-sm text-brand-700 hover:underline"
            href={`/students/${studentId}/fees`}
          >
            Full account
          </Link>
        }
      >
        {a.totals.advance > 0 && due > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm">
            <span>{inr(a.totals.advance)} paid earlier is held in advance.</span>
            <Button
              variant="secondary"
              loading={advance.pending}
              onClick={async () => {
                if (await advance.run(() => post(`/fees/students/${studentId}/apply-advance`, {})))
                  await acct.reload();
              }}
            >
              Use it for these dues
            </Button>
          </div>
        )}
        {!lines.length ? (
          <EmptyState title="Nothing due">
            A payment now is kept as advance for future fees.
          </EmptyState>
        ) : (
          <>
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={choose}
                onChange={(e) => setChoose(e.target.checked)}
              />
              Choose which fees this pays (otherwise the oldest dues are settled first)
            </label>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <tr key={l.id}>
                    {choose && (
                      <td className="w-6 py-2">
                        <input
                          type="checkbox"
                          aria-label={l.label}
                          checked={!!picked[l.id]}
                          onChange={(e) => setPicked((p) => ({ ...p, [l.id]: e.target.checked }))}
                        />
                      </td>
                    )}
                    <td className="py-2">
                      {l.label}
                      <div className="text-xs text-slate-500">due {formatDate(l.dueOn)}</div>
                    </td>
                    <td className="py-2 text-right">
                      <DemandBadge state={l.dueOn < a.today ? 'overdue' : 'due'} />
                    </td>
                    <td className="py-2 text-right tabular-nums">{inr(l.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <Card title="Payment">
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Mode" className="grid grid-cols-3 gap-1.5">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-lg border px-2 py-2 text-sm ${
                  mode === m
                    ? 'border-brand-600 bg-brand-50 font-medium text-brand-800'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <RupeeField
            label="Amount received"
            value={amount}
            onChange={setAmount}
            required
            hint={
              amount && amount > due
                ? `${inr(amount - due)} more than due will be kept as advance.`
                : undefined
            }
          />
          {needsRef && (
            <Field
              label={
                isInstrument
                  ? `${MODE_LABEL[mode]} number`
                  : mode === 'upi'
                    ? 'UPI transaction ID'
                    : 'Reference'
              }
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
            />
          )}
          {isInstrument && (
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Bank"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                required
              />
              <Field
                label="Dated"
                type="date"
                value={instrumentDate}
                onChange={(e) => setInstrumentDate(e.target.value)}
                required
              />
            </div>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-600">More details</summary>
            <div className="mt-3 flex flex-col gap-3">
              <Field
                label="Received on"
                type="date"
                value={receivedOn}
                max={a.today}
                onChange={(e) => setReceivedOn(e.target.value)}
                hint="Leave empty for today."
              />
              <Field
                label="Paid by"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder="Parent's name"
              />
              <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </details>
          {action.error && <Alert>{action.error.message}</Alert>}
          <Button onClick={submit} loading={action.pending} disabled={!ready}>
            Take {amount ? inr(amount) : 'payment'}
          </Button>
          {a.payments.length > 0 && (
            <div className="border-t border-slate-100 pt-3 text-xs text-slate-500">
              Last receipt {a.payments[0]!.receiptNumber} on {formatDate(a.payments[0]!.receivedOn)}{' '}
              for {inr(a.payments[0]!.amount)}{' '}
              <Badge tone="neutral">{MODE_LABEL[a.payments[0]!.mode]}</Badge>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
