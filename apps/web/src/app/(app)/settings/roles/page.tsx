'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { del, post, put } from '@/lib/api';
import type { Permission, Role } from '@/lib/api';
import { useAction, useApi, onSubmitForm } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  Skeleton,
  confirmAction,
} from '@/components/ui';

function PermissionPicker({
  catalogue,
  value,
  onChange,
}: {
  catalogue: Permission[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const modules = [...new Set(catalogue.map((p) => p.module))];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {modules.map((mod) => (
        <fieldset key={mod} className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {mod}
          </legend>
          {catalogue
            .filter((p) => p.module === mod)
            .map((p) => (
              <label key={p.key} className="flex items-start gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={value.includes(p.key)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...value, p.key] : value.filter((k) => k !== p.key),
                    )
                  }
                />
                <span>
                  {p.description}
                  <span className="block font-mono text-xs text-slate-400">{p.key}</span>
                </span>
              </label>
            ))}
        </fieldset>
      ))}
    </div>
  );
}

export default function RolesPage() {
  const { can } = useSession();
  const manage = can('roles.manage');
  const roles = useApi<Role[]>('/roles');
  const catalogue = useApi<Permission[]>(manage ? '/permissions' : null);
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [perms, setPerms] = useState<string[]>([]);
  const action = useAction();

  const open = (r: Role | 'new', base?: Role) => {
    setEditing(r);
    setPerms(r === 'new' ? (base?.permissions ?? []) : r.permissions);
  };

  const submitNew = async (form: FormData) => {
    const ok = await action.run(() =>
      post('/roles', {
        key: form.get('key'),
        name: form.get('name'),
        description: form.get('description'),
        permissions: perms,
      }),
    );
    if (ok) {
      setEditing(null);
      void roles.reload();
    }
  };

  const savePerms = async () => {
    if (!editing || editing === 'new') return;
    const ok = await action.run(async () => {
      await put(`/roles/${editing.id}/permissions`, { permissions: perms });
      return true;
    });
    if (ok) {
      setEditing(null);
      void roles.reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Roles"
        description="Built-in roles follow the product defaults. Create custom roles for anything else."
        actions={
          manage &&
          !editing && (
            <Button onClick={() => open('new')} icon={Plus}>
              New custom role
            </Button>
          )
        }
      />
      {editing && catalogue.data && (
        <Card
          title={editing === 'new' ? 'New custom role' : `Permissions for ${editing.name}`}
          className="mb-6"
        >
          {action.error && (
            <div className="mb-4">
              <Alert>{action.error.message}</Alert>
            </div>
          )}
          {editing === 'new' ? (
            <form onSubmit={onSubmitForm(submitNew)} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" name="name" required error={action.error?.fields.name} />
                <Field
                  label="Key"
                  name="key"
                  hint="e.g. exam_cell"
                  required
                  error={action.error?.fields.key}
                />
                <Field label="Description" name="description" className="sm:col-span-2" />
              </div>
              <PermissionPicker catalogue={catalogue.data} value={perms} onChange={setPerms} />
              <div className="flex gap-2">
                <Button type="submit" loading={action.pending}>
                  Create role
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <PermissionPicker catalogue={catalogue.data} value={perms} onChange={setPerms} />
              <div className="flex gap-2">
                <Button onClick={savePerms} loading={action.pending}>
                  Save permissions
                </Button>
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {roles.loading && !roles.data ? (
        <Skeleton rows={5} />
      ) : roles.error ? (
        <Alert>{roles.error.message}</Alert>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {roles.data?.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {r.name}{' '}
                    {r.isSystem ? <Badge>Built-in</Badge> : <Badge tone="blue">Custom</Badge>}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">{r.description}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-500">
                  {r.assignmentCount} assigned
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-600">
                {r.permissions.length ? r.permissions.join(' · ') : 'No permissions yet'}
              </p>
              {manage && (
                <div className="mt-3 flex gap-1">
                  {r.isSystem ? (
                    <Button variant="ghost" size="sm" onClick={() => open('new', r)}>
                      Copy as custom role
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => open(r)}>
                        Edit permissions
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (
                            !(await confirmAction({
                              title: `Delete the role ${r.name}?`,
                              confirmLabel: 'Delete role',
                            }))
                          )
                            return;
                          await action.run(() => del(`/roles/${r.id}`));
                          void roles.reload();
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
