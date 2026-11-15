'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { patch, post } from '@/lib/api';
import type { Subject } from '@/lib/api';
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

const KIND_LABEL = { scholastic: 'Scholastic', co_scholastic: 'Co-scholastic' } as const;

function SubjectForm({ subject, onDone }: { subject?: Subject; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const submit = async (form: FormData) => {
    const body = { name: form.get('name'), kind: form.get('kind') };
    const ok = await run(() =>
      subject
        ? patch(`/subjects/${subject.id}`, body)
        : post('/subjects', { ...body, code: form.get('code') }),
    );
    if (ok) onDone();
  };
  return (
    <form onSubmit={onSubmitForm(submit)} className="grid gap-4 sm:grid-cols-4 sm:items-start">
      {error && !Object.keys(f).length && (
        <div className="sm:col-span-4">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field
        label="Subject name"
        name="name"
        defaultValue={subject?.name}
        error={f.name}
        required
      />
      <Field
        label="Code"
        name="code"
        defaultValue={subject?.code}
        disabled={Boolean(subject)}
        hint={subject ? 'Codes cannot be changed' : 'e.g. MATH'}
        error={f.code}
        required
      />
      <SelectField label="Type" name="kind" defaultValue={subject?.kind ?? 'scholastic'}>
        <option value="scholastic">Scholastic (marks)</option>
        <option value="co_scholastic">Co-scholastic (grades)</option>
      </SelectField>
      <div className="flex gap-2 sm:pt-6">
        <Button type="submit" loading={pending}>
          {subject ? 'Save' : 'Add subject'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function SubjectsPage() {
  const { canEverywhere } = useSession();
  const { data, loading, error, reload } = useApi<Subject[]>('/subjects');
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);
  const archive = useAction();
  const manage = canEverywhere('academic.manage');

  const done = () => {
    setEditing(null);
    void reload();
  };

  return (
    <>
      <PageHeader
        title="Subjects"
        description="Subjects are shared by all campuses. Choose which ones each class studies on the Classes page."
        actions={
          manage &&
          !editing && (
            <Button onClick={() => setEditing('new')} icon={Plus}>
              Add subject
            </Button>
          )
        }
      />
      {editing && (
        <Card title={editing === 'new' ? 'New subject' : `Edit ${editing.name}`} className="mb-6">
          <SubjectForm subject={editing === 'new' ? undefined : editing} onDone={done} />
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
          <EmptyState title="No subjects yet">
            The ready-made structure on the Classes page adds common subjects for you.
          </EmptyState>
        ) : (
          <Table head={['Subject', 'Code', 'Type', 'Status', '']}>
            {data.map((s) => (
              <tr key={s.id}>
                <Td>
                  <span className="font-medium">{s.name}</span>
                </Td>
                <Td>{s.code}</Td>
                <Td>{KIND_LABEL[s.kind]}</Td>
                <Td>
                  <Badge tone={s.status === 'active' ? 'green' : 'neutral'}>{s.status}</Badge>
                </Td>
                <Td className="text-right">
                  {manage && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await archive.run(() =>
                            patch(`/subjects/${s.id}`, {
                              status: s.status === 'active' ? 'archived' : 'active',
                            }),
                          );
                          void reload();
                        }}
                      >
                        {s.status === 'active' ? 'Archive' : 'Restore'}
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
