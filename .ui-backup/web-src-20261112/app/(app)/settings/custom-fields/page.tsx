'use client';

import { useState } from 'react';
import { patch, post } from '@/lib/api';
import type { CustomFieldDefinition } from '@/lib/api';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
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

const TYPE_LABEL = { text: 'Text', number: 'Number', date: 'Date', select: 'List' } as const;

function NewField({ entity, onDone }: { entity: 'student' | 'guardian'; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const [type, setType] = useState<'text' | 'number' | 'date' | 'select'>('text');
  const f = error?.fields ?? {};
  const submit = async (form: FormData) => {
    const label = String(form.get('label') ?? '').trim();
    const ok = await run(() =>
      post('/custom-fields', {
        entity,
        label,
        key:
          String(form.get('key') ?? '').trim() ||
          label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .replace(/^(\d)/, 'f_$1'),
        fieldType: type,
        options:
          type === 'select'
            ? String(form.get('options') ?? '')
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
            : [],
        required: form.get('required') === 'on',
        sortOrder: Number(form.get('sortOrder') || 0),
      }),
    );
    if (ok) onDone();
  };
  return (
    <form onSubmit={onSubmitForm(submit)} className="grid gap-4 sm:grid-cols-3">
      {error && !Object.keys(f).length && (
        <div className="sm:col-span-3">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field label="Label" name="label" placeholder="e.g. House" error={f.label} />
      <SelectField
        label="Type"
        value={type}
        onChange={(e) => setType(e.target.value as typeof type)}
      >
        {Object.entries(TYPE_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </SelectField>
      <Field label="Key (optional)" name="key" hint="Used in imports as cf_<key>" error={f.key} />
      {type === 'select' && (
        <Field
          label="Choices"
          name="options"
          placeholder="Red, Blue, Green, Yellow"
          hint="Separate with commas"
          className="sm:col-span-3"
          error={f.options}
        />
      )}
      <Field label="Order" name="sortOrder" type="number" defaultValue={0} />
      <label className="flex items-center gap-2 text-sm sm:pt-6">
        <input type="checkbox" name="required" /> Required
      </label>
      <div className="flex gap-2 sm:col-span-3">
        <Button type="submit" loading={pending}>
          Add field
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function CustomFieldsPage() {
  const { canEverywhere } = useSession();
  const { data, loading, error, reload } = useApi<{
    student: CustomFieldDefinition[];
    guardian: CustomFieldDefinition[];
  }>('/custom-fields');
  const [adding, setAdding] = useState<'student' | 'guardian' | null>(null);
  const action = useAction();
  const manage = canEverywhere('settings.manage');

  return (
    <>
      <PageHeader
        title="Custom fields"
        description="Extra information your school records, such as house, bus route or previous school board."
      />
      {action.error && (
        <div className="mb-4">
          <Alert>{action.error.message}</Alert>
        </div>
      )}
      {loading && !data ? (
        <Skeleton />
      ) : error ? (
        <Alert>{error.message}</Alert>
      ) : (
        <div className="space-y-6">
          {(['student', 'guardian'] as const).map((entity) => (
            <Card
              key={entity}
              title={entity === 'student' ? 'Student fields' : 'Parent / guardian fields'}
              actions={
                manage &&
                adding !== entity && (
                  <Button variant="ghost" onClick={() => setAdding(entity)}>
                    Add field
                  </Button>
                )
              }
            >
              {adding === entity && (
                <div className="mb-4">
                  <NewField
                    entity={entity}
                    onDone={() => {
                      setAdding(null);
                      void reload();
                    }}
                  />
                </div>
              )}
              {!data?.[entity].length ? (
                <EmptyState title="No custom fields" />
              ) : (
                <Table head={['Label', 'Key', 'Type', 'Required', 'Status', '']}>
                  {data[entity].map((d) => (
                    <tr key={d.id}>
                      <Td>
                        <span className="font-medium">{d.label}</span>
                        {d.fieldType === 'select' && (
                          <span className="block text-xs text-slate-500">
                            {d.options.join(', ')}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <code className="text-xs">cf_{d.key}</code>
                      </Td>
                      <Td>{TYPE_LABEL[d.fieldType]}</Td>
                      <Td>{d.required ? 'Yes' : 'No'}</Td>
                      <Td>
                        <Badge tone={d.archived ? 'neutral' : 'green'}>
                          {d.archived ? 'hidden' : 'in use'}
                        </Badge>
                      </Td>
                      <Td className="text-right">
                        {manage && (
                          <span className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              onClick={async () => {
                                if (
                                  await action.run(() =>
                                    patch(`/custom-fields/${d.id}`, { required: !d.required }),
                                  )
                                )
                                  void reload();
                              }}
                            >
                              {d.required ? 'Make optional' : 'Make required'}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={async () => {
                                if (
                                  await action.run(() =>
                                    patch(`/custom-fields/${d.id}`, { archived: !d.archived }),
                                  )
                                )
                                  void reload();
                              }}
                            >
                              {d.archived ? 'Show again' : 'Hide'}
                            </Button>
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          ))}
          <p className="text-xs text-slate-500">
            Hidden fields keep their saved values but no longer appear on forms. Fields cannot be
            deleted, so old records keep their meaning.
          </p>
        </div>
      )}
    </>
  );
}
