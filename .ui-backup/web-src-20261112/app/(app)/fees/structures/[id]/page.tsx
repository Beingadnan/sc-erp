'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { del, patch, post, put } from '@/lib/api';
import type {
  AcademicYear,
  FeeHead,
  FeeStructure,
  GradeLevel,
  LateFeeRule,
  StructureDemands,
  StudentListItem,
} from '@/lib/api';
import { formatDate, fullName } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { RupeeField, inr } from '@/components/fees/money';
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

type Row = { label: string; dueOn: string; amounts: Record<string, number | null> };

const STATUS_TONE = { draft: 'amber', published: 'green', archived: 'neutral' } as const;

export default function StructurePage() {
  const { id } = useParams<{ id: string }>();
  const s = useApi<FeeStructure>(`/fees/structures/${id}`);
  const heads = useApi<FeeHead[]>('/fees/heads');
  if (s.error) return <Alert>{s.error.message}</Alert>;
  if (!s.data || !heads.data) return <Skeleton rows={8} />;
  return <Editor s={s.data} heads={heads.data} reload={s.reload} />;
}

function Editor({
  s,
  heads,
  reload,
}: {
  s: FeeStructure;
  heads: FeeHead[];
  reload: () => Promise<void>;
}) {
  const router = useRouter();
  const action = useAction();
  const draft = s.status === 'draft' && s.canEdit;
  const setStatus = async (status: string) => {
    if (await action.run(() => post(`/fees/structures/${s.id}/status`, { status }))) await reload();
  };

  return (
    <>
      <PageHeader
        title={s.name}
        description={`${s.kind === 'optional' ? 'Optional fee' : 'Class fees'} · ${inr(s.total)} for the year`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[s.status]}>
              {s.status[0]!.toUpperCase() + s.status.slice(1)}
            </Badge>
            {s.canEdit && s.status === 'draft' && (
              <Button onClick={() => setStatus('published')} loading={action.pending}>
                Publish
              </Button>
            )}
            {s.canEdit && s.status === 'published' && s.demands === 0 && (
              <Button variant="secondary" onClick={() => setStatus('draft')}>
                Back to draft
              </Button>
            )}
            {s.canEdit && s.status === 'published' && (
              <Button variant="ghost" onClick={() => setStatus('archived')}>
                Archive
              </Button>
            )}
            {s.canEdit && s.status === 'archived' && (
              <Button variant="secondary" onClick={() => setStatus('published')}>
                Restore
              </Button>
            )}
            {draft && s.demands === 0 && (
              <Button
                variant="ghost"
                onClick={async () => {
                  if (await action.run(() => del(`/fees/structures/${s.id}`)))
                    router.push('/fees/structures');
                }}
              >
                Delete
              </Button>
            )}
          </div>
        }
      />
      {action.error && (
        <div className="mb-4">
          <Alert>{action.error.message}</Alert>
        </div>
      )}
      <div className="flex flex-col gap-6">
        {s.status === 'draft' && (
          <Alert tone="info">
            Set the installments and amounts, then publish. Amounts are locked once published so
            every student is billed the same; go back to draft only while no demands are raised.
          </Alert>
        )}
        <Plan s={s} heads={heads} editable={draft} reload={reload} />
        <Details s={s} reload={reload} />
        {s.status === 'published' && <Demands s={s} reload={reload} />}
        {s.kind === 'optional' && <OptionalStudents s={s} />}
      </div>
    </>
  );
}

/* ----------------------------------------- plan ----------------------------------------- */

const isoAdd = (iso: string, months: number, day = 10) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, day))
    .toISOString()
    .slice(0, 10);
};

function Plan({
  s,
  heads,
  editable,
  reload,
}: {
  s: FeeStructure;
  heads: FeeHead[];
  editable: boolean;
  reload: () => Promise<void>;
}) {
  const usable = heads.filter((h) => !h.system && h.active);
  const year = useApi<AcademicYear[]>(`/academic-years?campusId=${s.campusId}`);
  const y = year.data?.find((x) => x.id === s.academicYearId);
  const initialHeads = useMemo(
    () => [...new Set(s.installments.flatMap((i) => i.items.map((x) => x.feeHeadId)))],
    [s.installments],
  );
  const [cols, setCols] = useState<string[]>(initialHeads);
  const [rows, setRows] = useState<Row[]>(
    s.installments.map((i) => ({
      label: i.label,
      dueOn: i.dueOn,
      amounts: Object.fromEntries(i.items.map((x) => [x.feeHeadId, x.amount])),
    })),
  );
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const headName = (id: string) => heads.find((h) => h.id === id)?.name ?? '—';

  const template = (n: number, labels: (i: number) => string) => {
    if (!y) return;
    const step = 12 / n;
    setRows(
      Array.from({ length: n }, (_, i) => ({
        label: labels(i),
        dueOn: isoAdd(y.startsOn, i * step),
        amounts: rows[0]?.amounts ?? {},
      })),
    );
  };
  const MONTHS = [
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
    'Jan',
    'Feb',
    'Mar',
  ];

  const total = rows.reduce((n, r) => n + cols.reduce((m, c) => m + (r.amounts[c] ?? 0), 0), 0);
  const invalid = rows.some((r) => !r.label.trim() || !r.dueOn);

  const save = async () => {
    setSaved(false);
    const ok = await action.run(() =>
      put(`/fees/structures/${s.id}/plan`, {
        installments: rows.map((r) => ({
          label: r.label.trim(),
          dueOn: r.dueOn,
          items: cols
            .filter((c) => (r.amounts[c] ?? 0) > 0)
            .map((c) => ({ feeHeadId: c, amount: r.amounts[c]! })),
        })),
      }),
    );
    if (ok) {
      setSaved(true);
      await reload();
    }
  };

  if (!editable) {
    return (
      <Card title="Installments and amounts">
        {!s.installments.length ? (
          <EmptyState title="No installments" />
        ) : (
          <div className="overflow-x-auto">
            <Table head={['Installment', 'Due', ...initialHeads.map(headName), 'Total']}>
              {s.installments.map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium">{i.label}</Td>
                  <Td>{formatDate(i.dueOn)}</Td>
                  {initialHeads.map((h) => {
                    const it = i.items.find((x) => x.feeHeadId === h);
                    return (
                      <Td key={h} className="tabular-nums">
                        {it ? inr(it.amount) : '—'}
                      </Td>
                    );
                  })}
                  <Td className="font-medium tabular-nums">{inr(i.total)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card
      title="Installments and amounts"
      description="One row per installment; one column per fee head. Leave a cell empty when that fee is not charged then."
    >
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <span className="text-sm text-slate-600">Quick start:</span>
        <Button variant="secondary" disabled={!y} onClick={() => template(1, () => 'Annual')}>
          Yearly
        </Button>
        <Button
          variant="secondary"
          disabled={!y}
          onClick={() => template(2, (i) => `Half ${i + 1}`)}
        >
          Half-yearly
        </Button>
        <Button
          variant="secondary"
          disabled={!y}
          onClick={() => template(4, (i) => `Quarter ${i + 1}`)}
        >
          Quarterly
        </Button>
        <Button variant="secondary" disabled={!y} onClick={() => template(12, (i) => MONTHS[i]!)}>
          Monthly
        </Button>
        <SelectField
          label="Add fee head"
          value=""
          onChange={(e) => e.target.value && setCols((c) => [...c, e.target.value])}
          className="ml-auto w-52"
        >
          <option value="">Choose…</option>
          {usable
            .filter((h) => !cols.includes(h.id))
            .map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
        </SelectField>
      </div>
      {!usable.length && (
        <Alert tone="warning">
          No fee heads yet.{' '}
          <Link className="underline" href="/fees/heads">
            Add fee heads
          </Link>{' '}
          first.
        </Alert>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-2 py-2 font-medium">Installment</th>
              <th className="px-2 py-2 font-medium">Due on</th>
              {cols.map((c) => (
                <th key={c} className="px-2 py-2 font-medium">
                  {headName(c)}{' '}
                  <button
                    className="text-slate-400 hover:text-red-600"
                    aria-label={`Remove ${headName(c)}`}
                    onClick={() => setCols((x) => x.filter((y) => y !== c))}
                  >
                    ×
                  </button>
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="align-top">
                <td className="px-2 py-1">
                  <Field
                    label="Name"
                    value={r.label}
                    onChange={(e) =>
                      setRows((x) =>
                        x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)),
                      )
                    }
                    className="w-32"
                  />
                </td>
                <td className="px-2 py-1">
                  <Field
                    label="Due"
                    type="date"
                    value={r.dueOn}
                    min={y?.startsOn}
                    max={y?.endsOn}
                    onChange={(e) =>
                      setRows((x) =>
                        x.map((y2, j) => (j === i ? { ...y2, dueOn: e.target.value } : y2)),
                      )
                    }
                    className="w-40"
                  />
                </td>
                {cols.map((c) => (
                  <td key={c} className="px-2 py-1">
                    <RupeeField
                      label="₹"
                      value={r.amounts[c] ?? null}
                      onChange={(v) =>
                        setRows((x) =>
                          x.map((y2, j) =>
                            j === i ? { ...y2, amounts: { ...y2.amounts, [c]: v } } : y2,
                          ),
                        )
                      }
                      className="w-32"
                    />
                  </td>
                ))}
                <td className="px-2 py-1 pt-8 text-right tabular-nums">
                  {inr(cols.reduce((m, c) => m + (r.amounts[c] ?? 0), 0))}
                </td>
                <td className="px-2 py-1 pt-7">
                  <button
                    className="text-sm text-slate-400 hover:text-red-600"
                    aria-label="Remove installment"
                    onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() =>
            setRows((x) => [
              ...x,
              {
                label: `Installment ${x.length + 1}`,
                dueOn: x.at(-1)?.dueOn ?? y?.startsOn ?? '',
                amounts: {},
              },
            ])
          }
        >
          Add installment
        </Button>
        <div className="flex items-center gap-4">
          <span className="text-sm">
            Year total <strong className="tabular-nums">{inr(total)}</strong>
          </span>
          <Button onClick={save} loading={action.pending} disabled={!rows.length || invalid}>
            Save amounts
          </Button>
        </div>
      </div>
      {action.error && (
        <div className="mt-3">
          <Alert>{action.error.message}</Alert>
        </div>
      )}
      {saved && (
        <div className="mt-3">
          <Alert tone="success">Amounts saved.</Alert>
        </div>
      )}
    </Card>
  );
}

/* --------------------------------------- details --------------------------------------- */

function Details({ s, reload }: { s: FeeStructure; reload: () => Promise<void> }) {
  const classes = useApi<GradeLevel[]>(
    s.kind === 'class' ? `/classes?campusId=${s.campusId}` : null,
  );
  const [picked, setPicked] = useState(s.classes.map((c) => c.id));
  const [late, setLate] = useState<LateFeeRule>(s.lateFee);
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const edit = s.canEdit && s.status !== 'archived';
  useEffect(() => setSaved(false), [picked, late]);
  return (
    <Card title={s.kind === 'class' ? 'Classes and late fee' : 'Late fee'}>
      <fieldset disabled={!edit} className="flex flex-col gap-5">
        {s.kind === 'class' && (
          <div>
            <p className="mb-2 text-sm font-medium">Applies to every student of</p>
            <div className="grid grid-cols-2 gap-1.5 text-sm sm:grid-cols-4">
              {(classes.data ?? [])
                .filter((c) => c.status === 'active' || picked.includes(c.id))
                .map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={picked.includes(c.id)}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id),
                        )
                      }
                    />
                    {c.name}
                  </label>
                ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            label="Late fee"
            value={late.kind}
            onChange={(e) => setLate({ ...late, kind: e.target.value as LateFeeRule['kind'] })}
            className="w-48"
          >
            <option value="none">No late fee</option>
            <option value="fixed">Fixed amount</option>
            <option value="per_day">Per day late</option>
          </SelectField>
          {late.kind !== 'none' && (
            <>
              <RupeeField
                label={late.kind === 'fixed' ? 'Amount' : 'Per day'}
                value={late.amount || null}
                onChange={(v) => setLate({ ...late, amount: v ?? 0 })}
                className="w-32"
              />
              <Field
                label="Grace days"
                type="number"
                min={0}
                max={365}
                value={late.graceDays}
                onChange={(e) => setLate({ ...late, graceDays: Number(e.target.value) || 0 })}
                className="w-28"
              />
              {late.kind === 'per_day' && (
                <RupeeField
                  label="Most per installment"
                  value={late.cap || null}
                  onChange={(v) => setLate({ ...late, cap: v ?? 0 })}
                  hint="Empty = no limit"
                  className="w-40"
                />
              )}
            </>
          )}
        </div>
      </fieldset>
      {edit && (
        <div className="mt-4 flex items-center gap-3">
          <Button
            variant="secondary"
            loading={action.pending}
            onClick={async () => {
              const ok = await action.run(() =>
                patch(`/fees/structures/${s.id}`, {
                  ...(s.kind === 'class' ? { gradeLevelIds: picked } : {}),
                  lateFee: late,
                }),
              );
              if (ok) {
                await reload();
                setSaved(true);
              }
            }}
          >
            Save
          </Button>
          {saved && <span className="text-sm text-emerald-700">Saved</span>}
        </div>
      )}
      {action.error && (
        <div className="mt-3">
          <Alert>{action.error.message}</Alert>
        </div>
      )}
    </Card>
  );
}

/* --------------------------------------- demands --------------------------------------- */

function Demands({ s, reload }: { s: FeeStructure; reload: () => Promise<void> }) {
  const data = useApi<StructureDemands>(`/fees/structures/${s.id}/demands`);
  const action = useAction();
  const [result, setResult] = useState<string | null>(null);
  const raise = async (installmentIds?: string[]) => {
    setResult(null);
    const res = await action.run(() =>
      post<{
        created: number;
        billed: number;
        concessions: number;
        skippedExisting: number;
        skippedJoinedLater: number;
      }>('/fees/demands/generate', {
        structureId: s.id,
        ...(installmentIds ? { installmentIds } : {}),
      }),
    );
    if (res) {
      setResult(
        res.created
          ? `${res.created} demand${res.created === 1 ? '' : 's'} raised for ${inr(res.billed)}${res.concessions ? `, less ${inr(res.concessions)} in concessions` : ''}.` +
              (res.skippedJoinedLater
                ? ` ${res.skippedJoinedLater} skipped for students who joined after the due date.`
                : '')
          : 'Everyone was already billed; nothing new to raise.',
      );
      await data.reload();
      await reload();
    }
  };
  const d = data.data;
  return (
    <Card
      title="Demands"
      description={
        d
          ? `${d.eligible} student${d.eligible === 1 ? '' : 's'} ${s.kind === 'optional' ? 'on this fee' : 'in these classes'}. Raising again only bills students not yet billed.`
          : undefined
      }
      actions={
        s.canEdit && d && d.installments.length > 1 ? (
          <Button onClick={() => raise()} loading={action.pending}>
            Raise all installments
          </Button>
        ) : null
      }
    >
      {!d ? (
        <Skeleton rows={3} />
      ) : (
        <Table
          head={[
            'Installment',
            'Due',
            'Raised',
            'Billed',
            'Concessions & waivers',
            'Outstanding',
            '',
          ]}
        >
          {d.installments.map((i) => (
            <tr key={i.id}>
              <Td className="font-medium">{i.label}</Td>
              <Td>{formatDate(i.dueOn)}</Td>
              <Td>
                {i.raised} / {d.eligible}
              </Td>
              <Td className="tabular-nums">{inr(i.billed)}</Td>
              <Td className="tabular-nums">{inr(i.reduced)}</Td>
              <Td className="tabular-nums">{inr(i.balance)}</Td>
              <Td className="text-right">
                {s.canEdit && i.raised < d.eligible && (
                  <Button
                    variant="secondary"
                    loading={action.pending}
                    onClick={() => raise([i.id])}
                  >
                    Raise
                  </Button>
                )}
                {i.raised > 0 && (
                  <Link
                    className="ml-3 text-sm text-brand-700 hover:underline"
                    href={`/fees?structureId=${s.id}&installmentId=${i.id}`}
                  >
                    View
                  </Link>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {result && (
        <div className="mt-3">
          <Alert tone="success">{result}</Alert>
        </div>
      )}
      {action.error && (
        <div className="mt-3">
          <Alert>{action.error.message}</Alert>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------- optional students ---------------------------------- */

function OptionalStudents({ s }: { s: FeeStructure }) {
  const list = useApi<
    Array<{
      id: string;
      studentId: string;
      name: string;
      admissionNumber: string;
      className: string;
      sectionName: string;
    }>
  >(`/fees/structures/${s.id}/students`);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const found = useApi<{ data: StudentListItem[] }>(
    debounced.length >= 2
      ? `/students?limit=8&status=active&q=${encodeURIComponent(debounced)}`
      : null,
  );
  const action = useAction();
  const edit = s.canEdit && s.status !== 'archived';
  return (
    <Card
      title="Students on this fee"
      description="Students added here are billed when demands are raised."
    >
      {edit && (
        <div className="mb-4 flex flex-col gap-1">
          <Field
            label="Add a student"
            placeholder="Name or admission no."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-sm"
          />
          {found.data && (
            <ul className="max-w-sm rounded-lg border border-slate-200 text-sm">
              {found.data.data.length === 0 && (
                <li className="px-3 py-2 text-slate-500">No matching students</li>
              )}
              {found.data.data.map((st) => (
                <li key={st.id}>
                  <button
                    className="w-full px-3 py-2 text-left hover:bg-slate-50"
                    onClick={async () => {
                      if (
                        await action.run(() =>
                          post(`/fees/structures/${s.id}/students`, { studentId: st.id }),
                        )
                      ) {
                        setQ('');
                        await list.reload();
                      }
                    }}
                  >
                    {fullName(st)}{' '}
                    <span className="text-slate-500">
                      · {st.className} – {st.sectionName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {action.error && <Alert>{action.error.message}</Alert>}
        </div>
      )}
      {!list.data ? (
        <Skeleton rows={2} />
      ) : !list.data.length ? (
        <EmptyState title="No students yet" />
      ) : (
        <Table head={['Student', 'Class', '']}>
          {list.data.map((a) => (
            <tr key={a.id}>
              <Td>
                <Link className="hover:underline" href={`/students/${a.studentId}/fees`}>
                  {a.name}
                </Link>
                <div className="text-xs text-slate-500">{a.admissionNumber}</div>
              </Td>
              <Td>
                {a.className} – {a.sectionName}
              </Td>
              <Td className="text-right">
                {edit && (
                  <button
                    className="text-sm text-slate-500 hover:underline"
                    onClick={async () => {
                      if (await action.run(() => del(`/fees/structures/${s.id}/students/${a.id}`)))
                        await list.reload();
                    }}
                  >
                    Remove
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Removing a student stops future billing; demands already raised stay until cancelled.
      </p>
    </Card>
  );
}
