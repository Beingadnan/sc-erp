'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { patch, post } from '@/lib/api';
import type { ConcessionType, FeeHead, StudentConcessionRow, StudentListItem } from '@/lib/api';
import { formatDate, fullName } from '@/lib/format';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import {
  CONCESSION_KIND_LABEL,
  RupeeField,
  concessionValue,
  inr,
  useYear,
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

const TONE = { pending: 'amber', approved: 'green', rejected: 'red', revoked: 'neutral' } as const;

export default function ConcessionsPage() {
  const { can, canEverywhere } = useSession();
  const { campus, picker } = useCampus();
  const [status, setStatus] = useState('pending');
  const types = useApi<ConcessionType[]>('/fees/concession-types');
  const list = useApi<StudentConcessionRow[]>(
    campus ? `/fees/concessions?campusId=${campus.id}${status ? `&status=${status}` : ''}` : null,
  );
  const give = campus
    ? can('fees.configure', campus.id) || can('fees.concession.approve', campus.id)
    : false;
  return (
    <>
      <PageHeader
        title="Concessions"
        description="Sibling, staff ward, scholarship and RTE concessions. Approved ones reduce the student's demands, including ones already raised."
        actions={picker}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-6">
          <Card
            title="Students"
            actions={
              <SelectField
                label="Show"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-36"
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="revoked">Revoked</option>
                <option value="">All</option>
              </SelectField>
            }
          >
            {list.error && <Alert>{list.error.message}</Alert>}
            {!list.data ? (
              <Skeleton rows={3} />
            ) : !list.data.length ? (
              <EmptyState title={status === 'pending' ? 'Nothing waiting for approval' : 'None'} />
            ) : (
              <Table head={['Student', 'Concession', 'Reason', 'Status', '']}>
                {list.data.map((c) => (
                  <ConcessionRow key={c.id} c={c} onDone={list.reload} />
                ))}
              </Table>
            )}
          </Card>
          <Types
            types={types.data ?? undefined}
            manage={canEverywhere('fees.configure')}
            onDone={types.reload}
          />
        </div>
        {give && campus && types.data && (
          <Give
            campusId={campus.id}
            types={types.data.filter((t) => t.active)}
            onDone={list.reload}
          />
        )}
      </div>
    </>
  );
}

function ConcessionRow({ c, onDone }: { c: StudentConcessionRow; onDone: () => Promise<void> }) {
  const action = useAction();
  const [mode, setMode] = useState<null | 'reject' | 'revoke'>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const decide = async (status: 'approved' | 'rejected') => {
    const res = await action.run(() =>
      post<{ demands: number; amount: number }>(`/fees/concessions/${c.id}/decision`, {
        status,
        note,
      }),
    );
    if (res) {
      if (status === 'approved' && res.amount)
        setDone(`${inr(res.amount)} taken off ${res.demands} demand(s)`);
      setMode(null);
      await onDone();
    }
  };
  return (
    <tr>
      <Td>
        <Link className="font-medium hover:underline" href={`/students/${c.studentId}/fees`}>
          {c.studentName}
        </Link>
        <div className="text-xs text-slate-500">
          {c.admissionNumber} · {c.className} – {c.sectionName} · {c.yearName}
        </div>
      </Td>
      <Td>
        {c.typeName}
        <div className="text-xs text-slate-500">{concessionValue(c.mode, c.value)}</div>
      </Td>
      <Td className="max-w-xs">
        {c.reason}
        <div className="text-xs text-slate-500">
          {c.requestedBy ?? '—'}, {formatDate(c.createdAt.slice(0, 10))}
          {c.decisionNote && <> · {c.decisionNote}</>}
        </div>
      </Td>
      <Td>
        <Badge tone={TONE[c.status]}>{c.status[0]!.toUpperCase() + c.status.slice(1)}</Badge>
        {done && <div className="mt-1 text-xs text-emerald-700">{done}</div>}
      </Td>
      <Td className="text-right">
        {action.error && <p className="mb-1 text-xs text-red-600">{action.error.message}</p>}
        {c.canDecide && c.status === 'pending' && !mode && (
          <div className="flex justify-end gap-1">
            <Button loading={action.pending} onClick={() => decide('approved')}>
              Approve
            </Button>
            <Button variant="secondary" onClick={() => setMode('reject')}>
              Reject
            </Button>
          </div>
        )}
        {c.canDecide && c.status === 'approved' && !mode && (
          <button className="text-xs text-slate-500 underline" onClick={() => setMode('revoke')}>
            Revoke
          </button>
        )}
        {mode && (
          <div className="flex flex-col items-end gap-1">
            <Field
              label="Reason"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-48"
            />
            <div className="flex gap-1">
              <Button
                variant="danger"
                disabled={note.trim().length < 3}
                loading={action.pending}
                onClick={async () => {
                  if (mode === 'reject') return decide('rejected');
                  if (await action.run(() => post(`/fees/concessions/${c.id}/revoke`, { note }))) {
                    setMode(null);
                    await onDone();
                  }
                }}
              >
                {mode === 'reject' ? 'Reject' : 'Revoke'}
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

function Give({
  campusId,
  types,
  onDone,
}: {
  campusId: string;
  types: ConcessionType[];
  onDone: () => Promise<void>;
}) {
  const { yearId, picker } = useYear(campusId);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [typeId, setTypeId] = useState('');
  const [value, setValue] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const found = useApi<{ data: StudentListItem[] }>(
    debounced.length >= 2 && !student
      ? `/students?limit=8&status=active&q=${encodeURIComponent(debounced)}`
      : null,
  );
  const type = types.find((t) => t.id === typeId);
  const action = useAction();
  const f = action.error?.fields ?? {};
  return (
    <Card
      title="Give a concession"
      description="Goes for approval unless you can approve concessions yourself."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={onSubmitForm(async (form) => {
          if (!student || !type || !yearId) return;
          setDone(null);
          const res = await action.run(() =>
            post<{ status: string; amount: number }>('/fees/concessions', {
              studentId: student.id,
              academicYearId: yearId,
              concessionTypeId: type.id,
              // The value is in the type's own unit: whole percent, or paise.
              ...(value !== null && value !== type.value ? { value } : {}),
              reason: form.get('reason'),
            }),
          );
          if (res) {
            setDone(
              res.status === 'approved'
                ? `Approved${res.amount ? `; ${inr(res.amount)} taken off demands already raised` : ''}.`
                : 'Sent for approval.',
            );
            setStudent(null);
            setQ('');
            await onDone();
          }
        })}
      >
        {picker}
        {student ? (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{fullName(student)}</span>
              <span className="text-slate-500">
                {' '}
                · {student.className} – {student.sectionName}
              </span>
            </span>
            <button
              type="button"
              className="text-xs text-brand-700 underline"
              onClick={() => setStudent(null)}
            >
              Change
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Field
              label="Student"
              placeholder="Name or admission no."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {found.data && (
              <ul className="max-h-56 overflow-auto rounded-lg border border-slate-200 text-sm">
                {found.data.data.length === 0 && (
                  <li className="px-3 py-2 text-slate-500">No matching students</li>
                )}
                {found.data.data.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-slate-50"
                      onClick={() => setStudent(s)}
                    >
                      {fullName(s)}{' '}
                      <span className="text-slate-500">
                        · {s.className} – {s.sectionName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <SelectField
          label="Concession"
          value={typeId}
          onChange={(e) => {
            setTypeId(e.target.value);
            setValue(null);
          }}
          required
        >
          <option value="">Choose…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {concessionValue(t.mode, t.value)}
            </option>
          ))}
        </SelectField>
        {type?.mode === 'fixed' && (
          <RupeeField
            label="Amount per installment"
            value={value ?? type.value}
            onChange={setValue}
            hint="Change for this student if needed (e.g. scholarship amount)."
          />
        )}
        {type?.mode === 'percent' && (
          <Field
            label="Percent"
            type="number"
            min={1}
            max={100}
            value={value ?? type.value}
            onChange={(e) => setValue(Number(e.target.value) || null)}
            hint="Change for this student if needed."
            error={f.value}
          />
        )}
        <Field
          label="Reason"
          name="reason"
          required
          minLength={3}
          maxLength={300}
          placeholder="Elder sister in Class 7"
          error={f.reason}
        />
        {action.error && !Object.keys(f).length && <Alert>{action.error.message}</Alert>}
        {done && <Alert tone="success">{done}</Alert>}
        <Button type="submit" disabled={!student || !type || !yearId} loading={action.pending}>
          Give concession
        </Button>
      </form>
    </Card>
  );
}

function Types({
  types,
  manage,
  onDone,
}: {
  types?: ConcessionType[];
  manage: boolean;
  onDone: () => Promise<void>;
}) {
  const heads = useApi<FeeHead[]>('/fees/heads');
  const action = useAction();
  const [mode, setMode] = useState<'percent' | 'fixed'>('percent');
  const [amount, setAmount] = useState<number | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [key, setKey] = useState(0);
  const f = action.error?.fields ?? {};
  const headName = (id: string) => heads.data?.find((h) => h.id === id)?.name ?? '?';
  return (
    <Card title="Concession types" description="Shared by all campuses.">
      {!types ? (
        <Skeleton rows={2} />
      ) : !types.length ? (
        <EmptyState title="No concession types yet" />
      ) : (
        <Table head={['Name', 'Kind', 'Value', 'Applies to', '']}>
          {types.map((t) => (
            <tr key={t.id} className={t.active ? '' : 'text-slate-400'}>
              <Td className="font-medium">{t.name}</Td>
              <Td>{CONCESSION_KIND_LABEL[t.kind] ?? t.kind}</Td>
              <Td>{concessionValue(t.mode, t.value)}</Td>
              <Td>{t.feeHeadIds.length ? t.feeHeadIds.map(headName).join(', ') : 'All fees'}</Td>
              <Td className="text-right">
                {manage && (
                  <button
                    className="text-sm text-slate-500 hover:underline"
                    onClick={async () => {
                      if (
                        await action.run(() =>
                          patch(`/fees/concession-types/${t.id}`, { active: !t.active }),
                        )
                      )
                        await onDone();
                    }}
                  >
                    {t.active ? 'Switch off' : 'Switch on'}
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {manage && (
        <form
          key={key}
          className="mt-6 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2"
          onSubmit={onSubmitForm(async (form) => {
            const value = mode === 'percent' ? Number(form.get('percent')) : amount;
            const ok = await action.run(() =>
              post('/fees/concession-types', {
                name: form.get('name'),
                kind: form.get('kind'),
                mode,
                value,
                feeHeadIds: picked,
              }),
            );
            if (ok) {
              setKey((k) => k + 1);
              setPicked([]);
              setAmount(null);
              await onDone();
            }
          })}
        >
          <Field
            label="Name"
            name="name"
            required
            placeholder="Sibling concession"
            error={f.name}
          />
          <SelectField label="Kind" name="kind" defaultValue="sibling">
            {Object.entries(CONCESSION_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Type"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'percent' | 'fixed')}
          >
            <option value="percent">Percentage</option>
            <option value="fixed">Fixed amount per installment</option>
          </SelectField>
          {mode === 'percent' ? (
            <Field
              label="Percent"
              name="percent"
              type="number"
              min={1}
              max={100}
              required
              error={f.value}
            />
          ) : (
            <RupeeField
              label="Amount"
              value={amount}
              onChange={setAmount}
              error={f.value}
              required
            />
          )}
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">Reduces</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {(heads.data ?? [])
                .filter((h) => !h.system && h.active)
                .map((h) => (
                  <label key={h.id} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={picked.includes(h.id)}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked ? [...p, h.id] : p.filter((x) => x !== h.id),
                        )
                      }
                    />
                    {h.name}
                  </label>
                ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Leave all unticked to reduce every fee (late fees are never reduced).
            </p>
          </fieldset>
          {action.error && !Object.keys(f).length && (
            <div className="sm:col-span-2">
              <Alert>{action.error.message}</Alert>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" loading={action.pending}>
              Add concession type
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
