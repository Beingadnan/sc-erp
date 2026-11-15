'use client';

import { useState } from 'react';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { MODE_LABEL, inr, useYear } from '@/components/fees/money';
import { Alert, Card, EmptyState, Field, PageHeader, Skeleton, Table, Td } from '@/components/ui';

type Tab = 'collection' | 'outstanding' | 'concessions';

interface Collection {
  from: string;
  to: string;
  total: number;
  receipts: Array<Record<string, string | number>>;
  byMode: Array<{ mode: string; receipts: number; amount: number }>;
  byCashier: Array<{ cashier: string; receipts: number; amount: number }>;
  byHead: Array<{ head: string; amount: number }>;
}
interface Outstanding {
  today: string;
  classes: Array<{
    className: string;
    sectionName: string;
    students: number;
    billed: number;
    reduced: number;
    paid: number;
    outstanding: number;
    overdue: number;
    defaulters: number;
  }>;
  totals: {
    students: number;
    billed: number;
    reduced: number;
    paid: number;
    outstanding: number;
    overdue: number;
    defaulters: number;
  };
}
interface Concessions {
  total: number;
  rows: Array<Record<string, string | number>>;
}

export default function FeeReportsPage() {
  const { campus, picker } = useCampus();
  const { yearId, picker: yearPicker } = useYear(campus?.id ?? null);
  const [tab, setTab] = useState<Tab>('collection');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = new URLSearchParams();
  if (campus) q.set('campusId', campus.id);
  if (tab === 'outstanding' && yearId) q.set('academicYearId', yearId);
  if (tab !== 'outstanding') {
    if (from) q.set('from', from);
    if (to) q.set('to', to);
  }
  const path = `/fees/reports/${tab}?${q}`;
  const data = useApi<Collection | Outstanding | Concessions>(
    campus && (tab !== 'outstanding' || yearId) ? path : null,
  );
  const download = (format: 'csv' | 'xlsx') => `/api/v1${path}&format=${format}`;

  return (
    <>
      <PageHeader
        title="Fee reports"
        description="Download any report as CSV or Excel."
        actions={picker}
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {(
            [
              ['collection', 'Collection'],
              ['outstanding', 'Outstanding by class'],
              ['concessions', 'Concessions & waivers'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 ${tab === k ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {tab === 'outstanding' ? (
            yearPicker
          ) : (
            <>
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
            </>
          )}
          {campus && (
            <div className="flex gap-2 pb-0.5 text-sm">
              <a
                className="rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                href={download('csv')}
              >
                CSV
              </a>
              <a
                className="rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                href={download('xlsx')}
              >
                Excel
              </a>
            </div>
          )}
        </div>
      </div>
      {data.error && <Alert>{data.error.message}</Alert>}
      {(() => {
        // While a new tab loads, the previous tab's data may still be held; show each view
        // only with data of its own shape.
        const d = data.data;
        if (tab === 'collection' && d && 'byMode' in d) return <CollectionView d={d} />;
        if (tab === 'outstanding' && d && 'classes' in d) return <OutstandingView d={d} />;
        if (tab === 'concessions' && d && 'rows' in d && !('byMode' in d))
          return <ConcessionsView d={d} />;
        return <Skeleton rows={6} />;
      })()}
    </>
  );
}

function Mini({ title, rows }: { title: string; rows: Array<[string, number, number?]> }) {
  return (
    <Card title={title}>
      {!rows.length ? (
        <p className="text-sm text-slate-500">—</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map(([k, amount, n]) => (
              <tr key={k}>
                <td className="py-1.5">{k}</td>
                <td className="py-1.5 text-right text-slate-500">{n !== undefined ? n : ''}</td>
                <td className="py-1.5 text-right tabular-nums">{inr(amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function CollectionView({ d }: { d: Collection }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-slate-600">
        {formatDate(d.from)} to {formatDate(d.to)} · <strong>{inr(d.total)}</strong> received
      </p>
      <div className="grid gap-6 lg:grid-cols-3">
        <Mini
          title="By mode"
          rows={d.byMode.map((m) => [MODE_LABEL[m.mode] ?? m.mode, m.amount, m.receipts])}
        />
        <Mini title="By cashier" rows={d.byCashier.map((m) => [m.cashier, m.amount, m.receipts])} />
        <Mini title="By fee head" rows={d.byHead.map((m) => [m.head, m.amount])} />
      </div>
      <Card title={`${d.receipts.length} receipts`}>
        {!d.receipts.length ? (
          <EmptyState title="No receipts in this period" />
        ) : (
          <Table head={['Date', 'Receipt', 'Student', 'Class', 'Mode', 'Status', 'Amount']}>
            {d.receipts.map((r) => (
              <tr
                key={String(r.receiptNumber)}
                className={
                  r.status === 'cleared' || r.status === 'pending'
                    ? ''
                    : 'text-slate-400 line-through'
                }
              >
                <Td>{formatDate(String(r.date))}</Td>
                <Td className="font-mono text-xs">{r.receiptNumber}</Td>
                <Td>{r.student}</Td>
                <Td>{r.class}</Td>
                <Td>{MODE_LABEL[String(r.mode)] ?? r.mode}</Td>
                <Td>{r.status}</Td>
                <Td className="tabular-nums">{inr(Number(r.amount))}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function OutstandingView({ d }: { d: Outstanding }) {
  return (
    <Card
      title={`${inr(d.totals.outstanding)} outstanding`}
      description={`${inr(d.totals.overdue)} overdue from ${d.totals.defaulters} student${d.totals.defaulters === 1 ? '' : 's'} as of ${formatDate(d.today)}`}
    >
      {!d.classes.length ? (
        <EmptyState title="No demands raised for this year" />
      ) : (
        <Table
          head={['Class', 'Students', 'Billed', 'Concessions', 'Paid', 'Outstanding', 'Overdue']}
        >
          {d.classes.map((c) => (
            <tr key={`${c.className}-${c.sectionName}`}>
              <Td className="font-medium">
                {c.className} – {c.sectionName}
              </Td>
              <Td>{c.students}</Td>
              <Td className="tabular-nums">{inr(c.billed)}</Td>
              <Td className="tabular-nums">{inr(c.reduced)}</Td>
              <Td className="tabular-nums">{inr(c.paid)}</Td>
              <Td className="font-medium tabular-nums">{inr(c.outstanding)}</Td>
              <Td className={`tabular-nums ${c.overdue ? 'text-red-700' : ''}`}>
                {inr(c.overdue)}
                {c.defaulters > 0 && (
                  <div className="text-xs">
                    {c.defaulters} student{c.defaulters === 1 ? '' : 's'}
                  </div>
                )}
              </Td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200 font-semibold">
            <Td>Total</Td>
            <Td>{d.totals.students}</Td>
            <Td className="tabular-nums">{inr(d.totals.billed)}</Td>
            <Td className="tabular-nums">{inr(d.totals.reduced)}</Td>
            <Td className="tabular-nums">{inr(d.totals.paid)}</Td>
            <Td className="tabular-nums">{inr(d.totals.outstanding)}</Td>
            <Td className="tabular-nums">{inr(d.totals.overdue)}</Td>
          </tr>
        </Table>
      )}
    </Card>
  );
}

function ConcessionsView({ d }: { d: Concessions }) {
  return (
    <Card
      title={`${inr(d.total)} given`}
      description="Concessions and waivers approved in the period; reversed ones are shown struck through."
    >
      {!d.rows.length ? (
        <EmptyState title="None in this period" />
      ) : (
        <Table head={['Date', 'Student', 'Class', 'Kind', 'Reason', 'Amount']}>
          {d.rows.map((r, i) => (
            <tr key={i} className={r.status === 'reversed' ? 'text-slate-400 line-through' : ''}>
              <Td>{formatDate(String(r.date))}</Td>
              <Td>{r.student}</Td>
              <Td>{r.class}</Td>
              <Td>{r.kind === 'waiver' ? 'Waiver' : 'Concession'}</Td>
              <Td>{r.reason}</Td>
              <Td className="tabular-nums">{inr(Number(r.amount))}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
