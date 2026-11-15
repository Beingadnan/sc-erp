'use client';

import { useState } from 'react';
import { BOARDS } from '@school-erp/validation';
import { patch, post } from '@/lib/api';
import type { Campus } from '@/lib/api';
import { useAction, useApi, onSubmitForm } from '@/lib/use-api';
import { useSession } from '@/lib/session';
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

const blank = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

function CampusForm({ campus, onDone }: { campus?: Campus; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};

  const submit = async (form: FormData) => {
    const body = {
      name: form.get('name'),
      board: form.get('board'),
      udiseCode: blank(form.get('udiseCode')),
      address: blank(form.get('address')),
      phone: blank(form.get('phone')),
      email: blank(form.get('email')),
    };
    const ok = await run(() =>
      campus
        ? patch(`/campuses/${campus.id}`, body)
        : post('/campuses', { ...body, code: form.get('code') }),
    );
    if (ok) onDone();
  };

  return (
    <form onSubmit={onSubmitForm(submit)} className="grid gap-4 sm:grid-cols-2">
      {error && !Object.keys(f).length && (
        <div className="sm:col-span-2">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field label="Campus name" name="name" defaultValue={campus?.name} error={f.name} required />
      <Field
        label="Code"
        name="code"
        defaultValue={campus?.code}
        disabled={Boolean(campus)}
        hint={campus ? 'Codes cannot be changed' : 'Short code, e.g. JPR-01'}
        error={f.code}
        required
      />
      <SelectField
        label="Board"
        name="board"
        defaultValue={campus?.board ?? 'CBSE'}
        error={f.board}
      >
        {BOARDS.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </SelectField>
      <Field
        label="UDISE code"
        name="udiseCode"
        defaultValue={campus?.udiseCode ?? ''}
        hint="11 digits, optional"
        error={f.udiseCode}
      />
      <Field label="Phone" name="phone" defaultValue={campus?.phone ?? ''} error={f.phone} />
      <Field
        label="Email"
        name="email"
        type="email"
        defaultValue={campus?.email ?? ''}
        error={f.email}
      />
      <Field
        label="Address"
        name="address"
        defaultValue={campus?.address ?? ''}
        className="sm:col-span-2"
        error={f.address}
      />
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={pending}>
          {campus ? 'Save campus' : 'Add campus'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function CampusesPage() {
  const { can } = useSession();
  const { data, loading, error, reload } = useApi<Campus[]>('/campuses');
  const [editing, setEditing] = useState<Campus | 'new' | null>(null);
  const archive = useAction();
  const manage = can('settings.manage');

  const done = () => {
    setEditing(null);
    void reload();
  };

  return (
    <>
      <PageHeader
        title="Campuses"
        description="Each campus has its own board, contact details and staff."
        actions={
          manage && !editing && <Button onClick={() => setEditing('new')}>Add campus</Button>
        }
      />
      {editing && (
        <Card title={editing === 'new' ? 'New campus' : `Edit ${editing.name}`} className="mb-6">
          <CampusForm campus={editing === 'new' ? undefined : editing} onDone={done} />
        </Card>
      )}
      {archive.error && (
        <div className="mb-4">
          <Alert>{archive.error.message}</Alert>
        </div>
      )}
      <Card>
        {loading && !data ? (
          <Skeleton />
        ) : error ? (
          <Alert>{error.message}</Alert>
        ) : !data?.length ? (
          <EmptyState title="No campuses yet" />
        ) : (
          <Table head={['Campus', 'Code', 'Board', 'UDISE', 'Status', '']}>
            {data.map((c) => (
              <tr key={c.id}>
                <Td>
                  <p className="font-medium">{c.name}</p>
                  {c.address && <p className="text-xs text-slate-500">{c.address}</p>}
                </Td>
                <Td>{c.code}</Td>
                <Td>{c.board}</Td>
                <Td>{c.udiseCode ?? '—'}</Td>
                <Td>
                  <Badge tone={c.status === 'active' ? 'green' : 'neutral'}>{c.status}</Badge>
                </Td>
                <Td className="text-right">
                  {manage && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => setEditing(c)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          const next = c.status === 'active' ? 'archived' : 'active';
                          if (
                            next === 'archived' &&
                            !confirm(`Archive ${c.name}? It will be hidden from daily use.`)
                          )
                            return;
                          await archive.run(() => patch(`/campuses/${c.id}`, { status: next }));
                          void reload();
                        }}
                      >
                        {c.status === 'active' ? 'Archive' : 'Restore'}
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
