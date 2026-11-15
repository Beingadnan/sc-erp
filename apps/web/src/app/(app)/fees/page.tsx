'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { post } from '@/lib/api';
import type { DemandList, FeeStructureSummary } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import { DemandBadge, inr, useYear } from '@/components/fees/money';
import {
  Alert,
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

export default function DemandsPage() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Demands />
    </Suspense>
  );
}

function Demands() {
  const params = useSearchParams();
  const router = useRouter();
  const { can } = useSession();
  const { campus, picker } = useCampus();
  const { yearId, picker: yearPicker } = useYear(campus?.id ?? null);
  const structureId = params.get('structureId') ?? '';
  const installmentId = params.get('installmentId') ?? '';
  const status = params.get('status') ?? 'due';
  const page = Number(params.get('page') ?? 1) || 1;
  const [q, setQ] = useState(params.get('q') ?? '');
  const set = (next: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!('page' in next)) p.delete('page');
    router.replace(`/fees?${p}`);
  };
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== q.trim()) set({ q: q.trim() });
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const structures = useApi<FeeStructureSummary[]>(
    campus && yearId ? `/fees/structures?campusId=${campus.id}&academicYearId=${yearId}` : null,
  );
  const query = new URLSearchParams();
  if (campus) query.set('campusId', campus.id);
  if (yearId) query.set('academicYearId', yearId);
  if (structureId) query.set('structureId', structureId);
  if (installmentId) query.set('installmentId', installmentId);
  if (status !== 'all') query.set('status', status);
  if (params.get('q')) query.set('q', params.get('q')!);
  query.set('page', String(page));
  const list = useApi<DemandList>(campus && yearId ? `/fees/demands?${query}` : null);
  const d = list.data;

  const late = useAction();
  const [lateResult, setLateResult] = useState<string | null>(null);
  const configure = campus ? can('fees.configure', campus.id) : false;

  return (
    <>
      <PageHeader
        title="Fee demands"
        description="What each student has been billed and what is still outstanding."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            {picker}
            {yearPicker}
          </div>
        }
      />
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            label="Show"
            value={status}
            onChange={(e) => set({ status: e.target.value })}
            className="w-40"
          >
            <option value="due">Outstanding</option>
            <option value="overdue">Overdue</option>
            <option value="settled">Settled</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </SelectField>
          <SelectField
            label="Fee structure"
            value={structureId}
            onChange={(e) => set({ structureId: e.target.value, installmentId: '' })}
            className="w-56"
          >
            <option value="">All structures</option>
            {(structures.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <Field
            label="Search"
            placeholder="Name or admission no."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-56"
          />
          {configure && campus && (
            <div className="ml-auto">
              <Button
                variant="secondary"
                loading={late.pending}
                onClick={async () => {
                  setLateResult(null);
                  const res = await late.run(() =>
                    post<{ demands: number; amount: number }>('/fees/demands/late-fees', {
                      campusId: campus.id,
                    }),
                  );
                  if (res) {
                    setLateResult(
                      res.demands
                        ? `Late fee of ${inr(res.amount)} added to ${res.demands} overdue demand${res.demands === 1 ? '' : 's'}.`
                        : 'No late fees are due today.',
                    );
                    await list.reload();
                  }
                }}
              >
                Apply late fees
              </Button>
            </div>
          )}
        </div>
        {lateResult && (
          <div className="mt-3">
            <Alert tone="success">{lateResult}</Alert>
          </div>
        )}
        {late.error && (
          <div className="mt-3">
            <Alert>{late.error.message}</Alert>
          </div>
        )}
      </Card>

      {list.error && <Alert>{list.error.message}</Alert>}
      {!d ? (
        <Skeleton rows={6} />
      ) : (
        <Card
          title={`${d.total} demand${d.total === 1 ? '' : 's'}`}
          description={`Billed ${inr(d.totals.billed)} · concessions and waivers ${inr(d.totals.reduced)} · outstanding ${inr(d.totals.balance)}`}
        >
          {!d.data.length ? (
            <EmptyState title="Nothing here">
              Raise demands from a published fee structure.
            </EmptyState>
          ) : (
            <>
              <Table head={['Student', 'Fee', 'Due', 'Billed', 'Outstanding', 'Status']}>
                {d.data.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link
                        className="font-medium hover:underline"
                        href={`/students/${r.studentId}/fees`}
                      >
                        {r.studentName}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {r.admissionNumber} · {r.className} – {r.sectionName}
                      </div>
                    </Td>
                    <Td>
                      {r.structureName}
                      <div className="text-xs text-slate-500">{r.installmentLabel}</div>
                    </Td>
                    <Td>{formatDate(r.dueOn)}</Td>
                    <Td className="tabular-nums">
                      {inr(r.billed)}
                      {r.reduced > 0 && (
                        <div className="text-xs text-slate-500">− {inr(r.reduced)}</div>
                      )}
                    </Td>
                    <Td className="font-medium tabular-nums">{inr(Math.max(r.balance, 0))}</Td>
                    <Td>
                      <DemandBadge state={r.status} />
                    </Td>
                  </tr>
                ))}
              </Table>
              {d.total > d.pageSize && (
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-slate-500">
                    Page {d.page} of {Math.ceil(d.total / d.pageSize)}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={d.page <= 1}
                      onClick={() => set({ page: String(d.page - 1) })}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={d.page >= Math.ceil(d.total / d.pageSize)}
                      onClick={() => set({ page: String(d.page + 1) })}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </>
  );
}
