'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { post } from '@/lib/api';
import type { FamilyAttendance, FamilyChild, FamilyFees } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { MODE_LABEL, RupeeField, inr } from '@/components/fees/money';
import { ATTENDANCE_LABEL, ATTENDANCE_TONE } from '@/components/family/labels';
import { Alert, Badge, Button, Skeleton } from '@/components/ui';
import { HomeworkList } from '@/components/classroom/homework';
import type { FamilyResult, HomeworkItem } from '@/lib/api';
import { MARK_SHORT, fmtMarks } from '@/components/exams/labels';

const CELL: Record<string, string> = {
  present: 'bg-emerald-500 text-white',
  late: 'bg-amber-400 text-white',
  absent: 'bg-red-500 text-white',
};
const DEMAND_TONE = {
  due: 'amber',
  overdue: 'red',
  settled: 'green',
  cancelled: 'neutral',
} as const;
const DEMAND_LABEL = {
  due: 'Due',
  overdue: 'Overdue',
  settled: 'Paid',
  cancelled: 'Cancelled',
} as const;

export default function ChildPage() {
  const { id } = useParams<{ id: string }>();
  type Tab = 'homework' | 'attendance' | 'results' | 'fees';
  const [tab, setTab] = useState<Tab>('homework');
  // Home page buttons link straight to a tab: /parent/child/:id?tab=fees
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'homework' || t === 'attendance' || t === 'results' || t === 'fees') setTab(t);
  }, []);
  const home = useApi<{ children: FamilyChild[] }>('/family');
  const child = home.data?.children.find((c) => c.id === id);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/parent" className="text-sm text-brand-700">
        ← My children
      </Link>
      {home.data && !child ? (
        <Alert>This student is not linked to your account.</Alert>
      ) : (
        <div>
          <h1 className="text-xl font-semibold">
            {child ? `${child.firstName} ${child.lastName}` : '…'}
          </h1>
          {child && (
            <p className="text-sm text-slate-600">
              {child.className} {child.sectionName} · {child.admissionNumber} · {child.campusName}
            </p>
          )}
        </div>
      )}
      <div
        className="sticky top-14 z-10 -mx-4 grid grid-cols-4 border-b border-slate-200 bg-white px-2 text-sm"
        role="tablist"
      >
        {(['homework', 'attendance', 'results', 'fees'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`relative py-3 ${tab === t ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
          >
            {t === 'homework'
              ? 'Homework'
              : t === 'attendance'
                ? 'Attendance'
                : t === 'results'
                  ? 'Results'
                  : 'Fees'}
            {tab === t && (
              <span
                aria-hidden
                className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-brand-600"
              />
            )}
          </button>
        ))}
      </div>
      {tab === 'homework' ? (
        <Homework id={id} />
      ) : tab === 'attendance' ? (
        <Attendance id={id} />
      ) : tab === 'results' ? (
        <Results id={id} />
      ) : (
        <Fees id={id} />
      )}
    </div>
  );
}

function Attendance({ id }: { id: string }) {
  const a = useApi<FamilyAttendance>(`/family/children/${id}/attendance`);
  const months = useMemo(() => {
    const m = [...new Set((a.data?.records ?? []).map((r) => r.date.slice(0, 7)))].sort().reverse();
    return m;
  }, [a.data]);
  const [month, setMonth] = useState<string | null>(null);
  const shown = month ?? months[0] ?? null;

  if (a.error) return <Alert>{a.error.message}</Alert>;
  if (!a.data) return <Skeleton rows={6} />;
  const t = a.data.totals;
  const byDate = new Map(a.data.records.map((r) => [r.date, r]));

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs text-slate-500">This year ({a.data.enrollment.yearName})</div>
            <div className={`text-3xl font-bold tabular-nums ${a.data.low ? 'text-red-700' : ''}`}>
              {t.percent === null ? '—' : `${t.percent}%`}
            </div>
          </div>
          <div className="text-right text-sm text-slate-600">
            {t.present} of {t.days} days present
          </div>
        </div>
        {a.data.low && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            Below the school&apos;s required {a.data.lowThreshold}%. Please speak to the class
            teacher.
          </p>
        )}
        <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
          {[
            ['Absent', t.absent],
            ['Late', t.late],
          ].map(([l, n]) => (
            <div key={l} className="rounded-lg bg-slate-50 py-2">
              <div className="text-base font-semibold">{n}</div>
              <div className="text-slate-500">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {shown && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              {new Date(`${shown}-01T00:00:00`).toLocaleDateString('en-IN', {
                month: 'long',
                year: 'numeric',
              })}
            </h2>
            {months.length > 1 && (
              <select
                aria-label="Month"
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                value={shown}
                onChange={(e) => setMonth(e.target.value)}
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </option>
                ))}
              </select>
            )}
          </div>
          <MonthGrid month={shown} byDate={byDate} />
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
            {Object.keys(CELL).map((k) => (
              <span key={k} className="flex items-center gap-1">
                <span className={`inline-block size-3 rounded ${CELL[k]}`} /> {ATTENDANCE_LABEL[k]}
              </span>
            ))}
          </div>
          <ul className="mt-4 divide-y divide-slate-100 text-sm">
            {a.data.records
              .filter((r) => r.date.startsWith(shown) && r.status !== 'present')
              .map((r) => (
                <li key={r.date} className="flex justify-between py-2">
                  <span>{formatDate(r.date)}</span>
                  <span className="flex items-center gap-2">
                    {r.remark && <span className="text-xs text-slate-500">{r.remark}</span>}
                    <Badge tone={ATTENDANCE_TONE[r.status] ?? 'neutral'}>
                      {ATTENDANCE_LABEL[r.status]}
                    </Badge>
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
      {!a.data.records.length && (
        <Alert tone="info">No attendance has been taken yet this year.</Alert>
      )}
      <LeaveRequests id={id} leaves={a.data.leaves} onChange={() => void a.reload()} />
    </div>
  );
}

function MonthGrid({ month, byDate }: { month: string; byDate: Map<string, { status: string }> }) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
        <div key={i} className="py-1 font-medium text-slate-400">
          {d}
        </div>
      ))}
      {cells.map((d, i) => {
        if (d === null) return <div key={`x${i}`} />;
        const iso = `${month}-${String(d).padStart(2, '0')}`;
        const r = byDate.get(iso);
        return (
          <div
            key={iso}
            title={r ? ATTENDANCE_LABEL[r.status] : undefined}
            className={`flex aspect-square items-center justify-center rounded-md ${r ? CELL[r.status] : 'bg-slate-50 text-slate-400'}`}
          >
            {d}
          </div>
        );
      })}
    </div>
  );
}

function Fees({ id }: { id: string }) {
  const router = useRouter();
  const f = useApi<FamilyFees>(`/family/children/${id}/fees`);
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const act = useAction();

  if (f.error) return <Alert>{f.error.message}</Alert>;
  if (!f.data) return <Skeleton rows={6} />;
  const d = f.data;
  const dueNow = d.demands.filter((v) => v.dueOn <= d.today).reduce((n, v) => n + v.balance, 0);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-500">Due now</div>
            <div className={`text-2xl font-bold tabular-nums ${dueNow > 0 ? 'text-red-700' : ''}`}>
              {inr(dueNow)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Total outstanding</div>
            <div className="text-2xl font-bold tabular-nums">{inr(d.totals.balance)}</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Paid {inr(d.totals.paid)} of {inr(d.totals.billed - d.totals.reduced)} for{' '}
          {d.enrollment.yearName}
          {d.totals.advance > 0 && ` · ${inr(d.totals.advance)} extra kept as advance`}
        </p>
        {d.totals.balance > 0 &&
          (d.canPayOnline ? (
            paying ? (
              <form
                className="mt-4 flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await act.run(() =>
                    post<{ token: string }>(`/family/children/${id}/pay`, amount ? { amount } : {}),
                  );
                  if (r) router.push(`/pay/${r.token}`);
                }}
              >
                <RupeeField
                  label="Amount to pay"
                  value={amount}
                  onChange={setAmount}
                  hint={`Leave empty to pay what is due now (${inr(dueNow || d.totals.balance)})`}
                />
                {act.error && <Alert>{act.error.message}</Alert>}
                <Button type="submit" loading={act.pending}>
                  Continue to school bank / UPI details
                </Button>
              </form>
            ) : (
              <Button className="mt-4 w-full" onClick={() => setPaying(true)}>
                Pay fees
              </Button>
            )
          ) : (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Please pay at the school fee counter.
            </p>
          ))}
      </section>

      {d.proofs.some((p) => p.status === 'pending' || p.status === 'rejected') && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Payments you sent</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {d.proofs
              .filter((p) => p.status !== 'approved')
              .map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <div className="font-medium tabular-nums">{inr(p.amount)}</div>
                    <div className="font-mono text-xs text-slate-500">{p.reference}</div>
                    {p.note && <div className="text-xs text-red-700">{p.note}</div>}
                  </div>
                  <Badge tone={p.status === 'pending' ? 'amber' : 'red'}>
                    {p.status === 'pending' ? 'Being checked' : 'Not accepted'}
                  </Badge>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Fees this year</h2>
        {!d.demands.length && (
          <p className="mt-2 text-sm text-slate-500">No fees have been raised yet.</p>
        )}
        <ul className="mt-2 divide-y divide-slate-100">
          {d.demands.map((v) => (
            <li key={v.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{v.label}</div>
                  <div className="text-xs text-slate-500">Due {formatDate(v.dueOn)}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">
                    {inr(v.balance > 0 ? v.balance : v.billed - v.reduced)}
                  </div>
                  <Badge tone={DEMAND_TONE[v.state]}>{DEMAND_LABEL[v.state]}</Badge>
                </div>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                {v.lines.map((l, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{l.headName}</span>
                    <span className="tabular-nums">
                      {inr(l.amount)}
                      {l.reduced > 0 && ` − ${inr(l.reduced)} concession`}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Receipts</h2>
        {!d.receipts.length && <p className="mt-2 text-sm text-slate-500">No payments yet.</p>}
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {d.receipts.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <div className="font-medium tabular-nums">{inr(r.amount)}</div>
                <div className="text-xs text-slate-500">
                  {formatDate(r.receivedOn)} ·{' '}
                  {MODE_LABEL[r.mode as keyof typeof MODE_LABEL] ?? r.mode}
                  {r.status === 'pending' && ' · cheque not yet cleared'}
                  {r.status === 'bounced' && ' · cheque bounced'}
                </div>
              </div>
              <a
                className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-slate-50"
                href={`/api/v1/family/receipts/${r.id}/receipt.pdf`}
                target="_blank"
                rel="noopener"
              >
                {r.receiptNumber} ↓
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Homework({ id }: { id: string }) {
  const h = useApi<{ items: HomeworkItem[] }>(`/family/children/${id}/homework`);
  if (h.error) return <Alert>{h.error.message}</Alert>;
  if (!h.data) return <Skeleton rows={4} />;
  if (!h.data.items.length)
    return <Alert tone="info">No homework from the teachers in the last few weeks.</Alert>;
  return <HomeworkList items={h.data.items} />;
}

const LEAVE_TONE = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
  cancelled: 'neutral',
} as const;
const LEAVE_LABEL = {
  pending: 'Waiting for teacher',
  approved: 'Approved',
  rejected: 'Not approved',
  cancelled: 'Withdrawn',
} as const;

/** Parent asks the class teacher for leave (instead of a note in the diary). */
function LeaveRequests({
  id,
  leaves,
  onChange,
}: {
  id: string;
  leaves: FamilyAttendance['leaves'];
  onChange: () => void;
}) {
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fromDate: '', toDate: '', reason: '' });
  const send = async () => {
    const ok = await act.run(() =>
      post(`/family/children/${id}/leave`, { ...f, toDate: f.toDate || f.fromDate }),
    );
    if (ok) {
      setOpen(false);
      setF({ fromDate: '', toDate: '', reason: '' });
      onChange();
    }
  };
  const cancel = async (leaveId: string) => {
    if (await act.run(() => post(`/family/leave/${leaveId}/cancel`, {}))) onChange();
  };
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Leave</h2>
        {!open && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Ask for leave
          </Button>
        )}
      </div>
      {act.error && (
        <div className="mt-3">
          <Alert>{act.error.message}</Alert>
        </div>
      )}
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              From
              <input
                type="date"
                value={f.fromDate}
                onChange={(e) => setF({ ...f, fromDate: e.target.value })}
                className="h-10 rounded-lg border border-slate-300 px-2 font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              To
              <input
                type="date"
                value={f.toDate}
                min={f.fromDate}
                onChange={(e) => setF({ ...f, toDate: e.target.value })}
                className="h-10 rounded-lg border border-slate-300 px-2 font-normal"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Reason
            <input
              value={f.reason}
              maxLength={300}
              placeholder="Fever / family function"
              onChange={(e) => setF({ ...f, reason: e.target.value })}
              className="h-10 rounded-lg border border-slate-300 px-3 font-normal"
            />
          </label>
          <div className="flex gap-2">
            <Button
              onClick={send}
              loading={act.pending}
              disabled={!f.fromDate || f.reason.trim().length < 3}
            >
              Send to class teacher
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {leaves.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {leaves.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                {formatDate(l.fromDate)}
                {l.toDate !== l.fromDate ? ` – ${formatDate(l.toDate)}` : ''}
                <span className="block truncate text-xs text-slate-500">{l.reason}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={LEAVE_TONE[l.status as keyof typeof LEAVE_TONE] ?? 'neutral'}>
                  {LEAVE_LABEL[l.status as keyof typeof LEAVE_LABEL] ?? l.status}
                </Badge>
                {l.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => cancel(l.id)}
                    className="text-xs text-slate-600 underline"
                  >
                    Withdraw
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Results({ id }: { id: string }) {
  const r = useApi<{ items: FamilyResult[] }>(`/family/children/${id}/results`);
  if (r.error) return <Alert>{r.error.message}</Alert>;
  if (!r.data) return <Skeleton rows={4} />;
  if (!r.data.items.length)
    return (
      <Alert tone="info">No results yet. They appear here when the school publishes them.</Alert>
    );
  return (
    <div className="flex flex-col gap-4">
      {r.data.items.map((e) => (
        <section key={e.examId} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">{e.examName}</h2>
              <p className="text-sm text-slate-500">
                {e.percent !== null ? `${e.percent.toFixed(2)}%` : '—'} · Grade {e.grade ?? '—'}
                {e.rank ? ` · Rank ${e.rank} of ${e.classSize}` : ''}
              </p>
            </div>
            <a
              href={`/api/v1/family/children/${id}/results/${e.examId}/report-card.pdf`}
              target="_blank"
              rel="noopener"
              className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium"
            >
              Report card
            </a>
          </div>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {e.subjects.map((x) => (
              <li key={x.subjectName} className="flex items-center justify-between py-2">
                <span>{x.subjectName}</span>
                <span
                  className={`tabular-nums ${x.passed === false ? 'font-semibold text-red-600' : ''}`}
                >
                  {x.status === null
                    ? '—'
                    : x.status === 'present'
                      ? fmtMarks(x.marks)
                      : MARK_SHORT[x.status]}
                  <span className="text-slate-400"> / {x.maxMarks}</span>
                  {x.grade && (
                    <span className="ml-2 inline-block w-6 text-slate-600">{x.grade}</span>
                  )}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between py-2 font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                {fmtMarks(e.total)}
                <span className="font-normal text-slate-400"> / {e.maxTotal}</span>
              </span>
            </li>
          </ul>
          {e.failedIn.length > 0 && (
            <p className="mt-2 text-sm text-red-700">
              Needs to improve in {e.failedIn.join(', ')}.
            </p>
          )}
          {e.remark && (
            <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm italic text-slate-700">
              Class teacher: {e.remark}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
