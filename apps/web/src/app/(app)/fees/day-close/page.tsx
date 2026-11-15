'use client';

import { useState } from 'react';
import { post } from '@/lib/api';
import type { DayClosing, DaySummary } from '@/lib/api';
import { dateTime, formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import { MODE_LABEL, RupeeField, inr } from '@/components/fees/money';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Skeleton,
  Table,
  Td,
} from '@/components/ui';

export default function DayClosePage() {
  const { can } = useSession();
  const { campus, picker } = useCampus();
  const [date, setDate] = useState('');
  const collect = campus ? can('fees.collect', campus.id) : false;
  const day = useApi<DaySummary>(
    campus && collect
      ? `/fees/day-close?campusId=${campus.id}${date ? `&date=${date}` : ''}`
      : null,
  );
  const closings = useApi<DayClosing[]>(campus ? `/fees/day-closings?campusId=${campus.id}` : null);
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const action = useAction();
  const d = day.data;
  const diff = d && counted !== null ? counted - d.cashExpected : 0;

  return (
    <>
      <PageHeader
        title="Day closing"
        description="At the end of the day, count the cash and close your collection. Receipts can't be added to a closed day."
        actions={picker}
      />
      {collect && (
        <Card
          title="My collection"
          className="mb-6"
          actions={
            <Field
              label="Day"
              type="date"
              value={date || d?.date || ''}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          }
        >
          {day.error && <Alert>{day.error.message}</Alert>}
          {!d ? (
            <Skeleton rows={3} />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(d.totals).map(([m, v]) => (
                  <div key={m} className="rounded-lg border border-slate-200 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {MODE_LABEL[m]}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">{inr(v ?? 0)}</p>
                  </div>
                ))}
                <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
                  <p className="text-lg font-semibold tabular-nums">{inr(d.total)}</p>
                </div>
              </div>
              <p className="text-sm text-slate-600">
                {d.receipts} receipt{d.receipts === 1 ? '' : 's'} on {formatDate(d.date)}
                {d.cancelled > 0 && <> ({d.cancelled} cancelled, not counted)</>}.
              </p>
              {d.closing ? (
                <Alert tone={d.closing.difference === 0 ? 'success' : 'warning'}>
                  Closed {dateTime(d.closing.closedAt)}. Cash counted {inr(d.closing.cashCounted)}{' '}
                  against {inr(d.closing.cashExpected)}
                  {d.closing.difference !== 0 && (
                    <>
                      {' '}
                      — {inr(Math.abs(d.closing.difference))}{' '}
                      {d.closing.difference < 0 ? 'short' : 'extra'}
                    </>
                  )}
                  {d.closing.note && <>. Note: {d.closing.note}</>}
                </Alert>
              ) : (
                <div className="flex flex-col gap-3 border-t border-slate-100 pt-4">
                  <p className="text-sm">
                    Cash you should have:{' '}
                    <strong className="tabular-nums">{inr(d.cashExpected)}</strong>
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <RupeeField
                      label="Cash counted"
                      value={counted}
                      onChange={setCounted}
                      className="w-44"
                    />
                    {counted !== null && diff !== 0 && (
                      <span
                        className={`pb-2 text-sm font-medium ${diff < 0 ? 'text-red-700' : 'text-amber-700'}`}
                      >
                        {inr(Math.abs(diff))} {diff < 0 ? 'short' : 'extra'}
                      </span>
                    )}
                  </div>
                  {counted !== null && diff !== 0 && (
                    <Field
                      label="Explain the difference"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      required
                    />
                  )}
                  {action.error && <Alert>{action.error.message}</Alert>}
                  <div>
                    <Button
                      loading={action.pending}
                      disabled={counted === null || (diff !== 0 && note.trim().length < 3)}
                      onClick={async () => {
                        const ok = await action.run(() =>
                          post('/fees/day-close', {
                            campusId: campus!.id,
                            date: d.date,
                            cashCounted: counted,
                            note,
                          }),
                        );
                        if (ok) {
                          await day.reload();
                          await closings.reload();
                        }
                      }}
                    >
                      Close the day
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
      <Card title="Closed days (last 30 days)">
        {!closings.data ? (
          <Skeleton rows={3} />
        ) : !closings.data.length ? (
          <EmptyState title="No days closed yet" />
        ) : (
          <Table
            head={['Day', 'Cashier', 'Receipts', 'Total', 'Cash expected', 'Counted', 'Difference']}
          >
            {closings.data.map((c) => (
              <tr key={c.id}>
                <Td>{formatDate(c.closedFor)}</Td>
                <Td>{c.cashier ?? '—'}</Td>
                <Td>{c.receipts}</Td>
                <Td className="tabular-nums">
                  {inr(Object.values(c.totals).reduce((n, v) => n + (v ?? 0), 0))}
                </Td>
                <Td className="tabular-nums">{inr(c.cashExpected)}</Td>
                <Td className="tabular-nums">{inr(c.cashCounted)}</Td>
                <Td className={`tabular-nums ${c.difference ? 'font-semibold text-red-700' : ''}`}>
                  {c.difference
                    ? `${c.difference < 0 ? '−' : '+'}${inr(Math.abs(c.difference))}`
                    : '—'}
                  {c.note && <div className="text-xs font-normal text-slate-500">{c.note}</div>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
