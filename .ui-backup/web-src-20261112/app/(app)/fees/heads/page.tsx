'use client';

import { useState } from 'react';
import { patch, post } from '@/lib/api';
import type { FeeHead } from '@/lib/api';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { FEE_CATEGORY_LABEL } from '@/components/fees/money';
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

const CATEGORIES = [
  'tuition',
  'admission',
  'annual',
  'exam',
  'transport',
  'activity',
  'deposit',
  'other',
];

export default function FeeHeadsPage() {
  const { canEverywhere } = useSession();
  const heads = useApi<FeeHead[]>('/fees/heads');
  const manage = canEverywhere('fees.configure');
  return (
    <>
      <PageHeader
        title="Fee heads"
        description="The kinds of fees the school charges (tuition, transport…). Shared by all campuses; each has its own income account."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          {heads.error && <Alert>{heads.error.message}</Alert>}
          {!heads.data ? (
            <Skeleton rows={4} />
          ) : !heads.data.length ? (
            <EmptyState title="No fee heads yet">
              Add tuition, annual charges, transport and the like.
            </EmptyState>
          ) : (
            <Table head={['Code', 'Name', 'Kind', 'GST', '']}>
              {heads.data.map((h) => (
                <HeadRow key={h.id} head={h} manage={manage && !h.system} onDone={heads.reload} />
              ))}
            </Table>
          )}
        </Card>
        {manage ? (
          <NewHead onDone={heads.reload} />
        ) : (
          <Alert tone="info">
            Fee heads are shared by all campuses, so only school-wide fee managers can change them.
          </Alert>
        )}
      </div>
    </>
  );
}

function HeadRow({
  head: h,
  manage,
  onDone,
}: {
  head: FeeHead;
  manage: boolean;
  onDone: () => Promise<void>;
}) {
  const action = useAction();
  const [editing, setEditing] = useState(false);
  return (
    <tr className={h.active ? '' : 'text-slate-400'}>
      <Td className="font-mono text-xs">{h.code}</Td>
      <Td>
        {editing ? (
          <form
            className="flex items-end gap-2"
            onSubmit={onSubmitForm(async (f) => {
              if (
                await action.run(() =>
                  patch(`/fees/heads/${h.id}`, {
                    name: f.get('name'),
                    gstRate: Number(f.get('gstRate')),
                  }),
                )
              ) {
                setEditing(false);
                await onDone();
              }
            })}
          >
            <Field label="Name" name="name" defaultValue={h.name} required className="w-48" />
            <SelectField
              label="GST"
              name="gstRate"
              defaultValue={String(h.gstRate)}
              className="w-24"
            >
              {[0, 5, 12, 18, 28].map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </SelectField>
            <Button type="submit" loading={action.pending}>
              Save
            </Button>
          </form>
        ) : (
          <>
            {h.name}
            {h.refundable && (
              <span className="ml-2">
                <Badge tone="blue">Refundable</Badge>
              </span>
            )}
            {!h.active && (
              <span className="ml-2">
                <Badge tone="neutral">Off</Badge>
              </span>
            )}
          </>
        )}
        {action.error && <p className="mt-1 text-xs text-red-600">{action.error.message}</p>}
      </Td>
      <Td>{FEE_CATEGORY_LABEL[h.category] ?? h.category}</Td>
      <Td>{h.gstRate ? `${h.gstRate}%` : 'Exempt'}</Td>
      <Td className="whitespace-nowrap text-right">
        {manage && !editing && (
          <>
            <button
              className="text-sm text-brand-700 hover:underline"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              className="ml-3 text-sm text-slate-500 hover:underline"
              onClick={async () => {
                if (await action.run(() => patch(`/fees/heads/${h.id}`, { active: !h.active })))
                  await onDone();
              }}
            >
              {h.active ? 'Switch off' : 'Switch on'}
            </button>
          </>
        )}
      </Td>
    </tr>
  );
}

function NewHead({ onDone }: { onDone: () => Promise<void> }) {
  const action = useAction();
  const [key, setKey] = useState(0);
  const f = action.error?.fields ?? {};
  return (
    <Card title="Add a fee head">
      <form
        key={key}
        className="flex flex-col gap-4"
        onSubmit={onSubmitForm(async (form) => {
          const ok = await action.run(() =>
            post('/fees/heads', {
              code: form.get('code'),
              name: form.get('name'),
              category: form.get('category'),
              gstRate: Number(form.get('gstRate')),
            }),
          );
          if (ok) {
            setKey((k) => k + 1);
            await onDone();
          }
        })}
      >
        <Field label="Name" name="name" required placeholder="Tuition fee" error={f.name} />
        <Field
          label="Short code"
          name="code"
          required
          maxLength={16}
          placeholder="TUI"
          error={f.code}
          hint="Shown on receipts and exports."
        />
        <SelectField label="Kind" name="category" defaultValue="tuition">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {FEE_CATEGORY_LABEL[c]}
            </option>
          ))}
        </SelectField>
        <SelectField label="GST" name="gstRate" defaultValue="0">
          {[0, 5, 12, 18, 28].map((r) => (
            <option key={r} value={r}>
              {r ? `${r}%` : 'Exempt'}
            </option>
          ))}
        </SelectField>
        <p className="-mt-2 text-xs text-slate-500">
          School education fees are exempt. Amounts include any tax.
        </p>
        {action.error && !Object.keys(f).length && <Alert>{action.error.message}</Alert>}
        <Button type="submit" loading={action.pending}>
          Add fee head
        </Button>
      </form>
    </Card>
  );
}
