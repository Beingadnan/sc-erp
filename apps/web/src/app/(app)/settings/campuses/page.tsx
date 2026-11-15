'use client';

import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, MapPin, Pencil, Plus } from 'lucide-react';
import { BOARDS } from '@school-erp/validation';
import { patch, post } from '@/lib/api';
import type { Campus } from '@/lib/api';
import { useAction, useApi, onSubmitForm } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import {
  ActionMenu,
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SelectField,
  Skeleton,
  Table,
  Td,
  TextareaField,
  confirmAction,
  toast,
} from '@/components/ui';

const blank = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

function CampusModal({
  target,
  onClose,
  onSaved,
}: {
  target: Campus | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pending, error, run, setError } = useAction();
  const f = error?.fields ?? {};
  const campus = target && target !== 'new' ? target : undefined;
  useEffect(() => {
    if (target) setError(null);
  }, [target, setError]);

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
    if (ok) {
      toast.success(campus ? 'Campus updated.' : 'Campus added.');
      onSaved();
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      size="lg"
      title={campus ? `Edit ${campus.name}` : 'Add campus'}
      description="Board, contact details and identifiers for this campus."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="campus-form" loading={pending}>
            {campus ? 'Save changes' : 'Add campus'}
          </Button>
        </>
      }
    >
      <form
        id="campus-form"
        key={campus?.id ?? 'new'}
        onSubmit={onSubmitForm(submit)}
        className="grid gap-4 sm:grid-cols-2"
      >
        {error && !Object.keys(f).length && (
          <Alert className="sm:col-span-2">{error.message}</Alert>
        )}
        <Field
          label="Campus name"
          name="name"
          placeholder="e.g. Jaipur Main Campus"
          defaultValue={campus?.name}
          error={f.name}
          required
        />
        <Field
          label="Campus code"
          name="code"
          placeholder="e.g. JPR-01"
          defaultValue={campus?.code}
          disabled={Boolean(campus)}
          hint={
            campus
              ? 'Codes can’t be changed once created.'
              : 'Used in admission numbers and reports.'
          }
          error={f.code}
          required={!campus}
        />
        <SelectField
          label="Education board"
          name="board"
          defaultValue={campus?.board ?? 'CBSE'}
          error={f.board}
          required
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
          inputMode="numeric"
          placeholder="11 digits"
          defaultValue={campus?.udiseCode ?? ''}
          hint="Optional"
          error={f.udiseCode}
        />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          defaultValue={campus?.phone ?? ''}
          error={f.phone}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          defaultValue={campus?.email ?? ''}
          error={f.email}
        />
        <TextareaField
          label="Address"
          name="address"
          rows={2}
          defaultValue={campus?.address ?? ''}
          className="sm:col-span-2"
          error={f.address}
        />
      </form>
    </Modal>
  );
}

export default function CampusesPage() {
  const { can } = useSession();
  const { data, loading, error, reload } = useApi<Campus[]>('/campuses');
  const [editing, setEditing] = useState<Campus | 'new' | null>(null);
  const archive = useAction();
  const manage = can('settings.manage');

  const toggleArchive = async (c: Campus) => {
    const next = c.status === 'active' ? 'archived' : 'active';
    if (
      next === 'archived' &&
      !(await confirmAction({
        title: `Archive ${c.name}?`,
        message: 'It will be hidden from daily use. You can restore it later.',
        confirmLabel: 'Archive campus',
      }))
    )
      return;
    if (await archive.run(() => patch(`/campuses/${c.id}`, { status: next })))
      toast.success(next === 'archived' ? `${c.name} archived.` : `${c.name} restored.`);
    void reload();
  };

  return (
    <>
      <PageHeader
        title="Campuses"
        description="Each campus has its own board, contact details, classes and staff."
        actions={
          manage && (
            <Button icon={Plus} onClick={() => setEditing('new')}>
              Add campus
            </Button>
          )
        }
      />
      {archive.error && <Alert className="mb-4">{archive.error.message}</Alert>}
      <Card flush>
        {loading && !data ? (
          <div className="p-5">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="p-5">
            <Alert>{error.message}</Alert>
          </div>
        ) : !data?.length ? (
          <EmptyState
            icon={MapPin}
            title="No campuses yet"
            action={
              manage && (
                <Button icon={Plus} onClick={() => setEditing('new')}>
                  Add campus
                </Button>
              )
            }
          >
            Add your first campus to start setting up classes and admissions.
          </EmptyState>
        ) : (
          <Table head={['Campus', 'Code', 'Board', 'Contact', 'Status', '']}>
            {data.map((c) => (
              <tr key={c.id}>
                <Td>
                  <p className="font-medium text-ink">{c.name}</p>
                  {c.address && (
                    <p className="max-w-xs truncate text-xs text-slate-500">{c.address}</p>
                  )}
                </Td>
                <Td>
                  <span className="font-mono text-[13px] text-slate-600">{c.code}</span>
                </Td>
                <Td>
                  {c.board}
                  {c.udiseCode && <p className="text-xs text-slate-500">UDISE {c.udiseCode}</p>}
                </Td>
                <Td className="text-slate-600">
                  {c.phone || c.email ? (
                    <>
                      {c.phone && <p>{c.phone}</p>}
                      {c.email && <p className="text-xs text-slate-500">{c.email}</p>}
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </Td>
                <Td>
                  <Badge dot tone={c.status === 'active' ? 'green' : 'neutral'}>
                    {c.status === 'active' ? 'Active' : 'Archived'}
                  </Badge>
                </Td>
                <Td className="w-12 text-right">
                  {manage && (
                    <ActionMenu
                      label={`Actions for ${c.name}`}
                      items={[
                        { label: 'Edit campus', icon: Pencil, onClick: () => setEditing(c) },
                        c.status === 'active'
                          ? {
                              label: 'Archive',
                              icon: Archive,
                              danger: true,
                              onClick: () => void toggleArchive(c),
                            }
                          : {
                              label: 'Restore',
                              icon: ArchiveRestore,
                              onClick: () => void toggleArchive(c),
                            },
                      ]}
                    />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <CampusModal
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void reload();
        }}
      />
    </>
  );
}
