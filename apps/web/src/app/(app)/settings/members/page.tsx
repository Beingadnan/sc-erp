'use client';

import { useState } from 'react';
import { patch, post, put } from '@/lib/api';
import type { Campus, Member, Role } from '@/lib/api';
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

type Assignment = { roleId: string; campusId: string | null };

function AssignmentEditor({
  roles,
  campuses,
  value,
  onChange,
}: {
  roles: Role[];
  campuses: Campus[];
  value: Assignment[];
  onChange: (v: Assignment[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {value.map((a, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <SelectField
            label="Role"
            value={a.roleId}
            onChange={(e) =>
              onChange(value.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)))
            }
            className="min-w-48 flex-1"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Campus"
            value={a.campusId ?? ''}
            onChange={(e) =>
              onChange(
                value.map((x, j) => (j === i ? { ...x, campusId: e.target.value || null } : x)),
              )
            }
            className="min-w-48 flex-1"
          >
            <option value="">All campuses</option>
            {campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            aria-label="Remove role"
          >
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            onChange([
              ...value,
              {
                roleId: roles.find((r) => r.key === 'teacher')?.id ?? roles[0]!.id,
                campusId: null,
              },
            ])
          }
        >
          Add role
        </Button>
      </div>
    </div>
  );
}

export default function MembersPage() {
  const { can, me } = useSession();
  const members = useApi<Member[]>('/members');
  const roles = useApi<Role[]>('/roles');
  const campuses = useApi<Campus[]>('/campuses');
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [byPhone, setByPhone] = useState(true);
  const [link, setLink] = useState<{
    url: string;
    message: string;
    phone: string;
    name: string;
  } | null>(null);
  const invite = useAction();
  const save = useAction();
  const status = useAction();
  const manage = can('members.manage');

  const campusName = (id: string | null) =>
    id === null ? 'All campuses' : (campuses.data?.find((c) => c.id === id)?.name ?? 'Campus');

  const startInvite = () => {
    setEditing(null);
    setInviting(true);
    const teacher = roles.data?.find((r) => r.key === 'teacher');
    setAssignments(teacher ? [{ roleId: teacher.id, campusId: null }] : []);
  };

  const submitInvite = async (form: FormData) => {
    const name = String(form.get('fullName') ?? '');
    const ok = await invite.run(() =>
      post<{ link: { url: string; message: string; phone: string } | null }>('/members/invite', {
        ...(byPhone ? { phone: form.get('phone') } : { email: form.get('email') }),
        fullName: name,
        designation: form.get('designation') ?? '',
        assignments,
      }),
    );
    if (ok) {
      setInviting(false);
      setLink(ok.link ? { ...ok.link, name } : null);
      void members.reload();
    }
  };

  const saveRoles = async () => {
    if (!editing) return;
    const ok = await save.run(async () => {
      await put(`/members/${editing.id}/roles`, { assignments });
      return true;
    });
    if (ok) {
      setEditing(null);
      void members.reload();
    }
  };

  const ready = roles.data && campuses.data;

  return (
    <>
      <PageHeader
        title="Staff & access"
        description="Who can sign in to this school, and what each person can do."
        actions={manage && ready && !inviting && <Button onClick={startInvite}>Add staff</Button>}
      />

      {inviting && ready && (
        <Card
          title="Add a staff member"
          description={
            byPhone
              ? 'You get a link to send on WhatsApp; they set a password and sign in with their mobile.'
              : 'They get an email to set their password.'
          }
          className="mb-6"
        >
          <form onSubmit={onSubmitForm(submitInvite)} className="flex flex-col gap-4">
            {invite.error && <Alert>{invite.error.message}</Alert>}
            <div
              className="flex gap-1 self-start rounded-lg bg-slate-100 p-1 text-sm"
              role="tablist"
            >
              {[
                [true, 'Mobile number'],
                [false, 'Email'],
              ].map(([v, l]) => (
                <button
                  key={String(v)}
                  type="button"
                  role="tab"
                  aria-selected={byPhone === v}
                  onClick={() => setByPhone(v as boolean)}
                  className={`rounded-md px-3 py-1 ${byPhone === v ? 'bg-white font-medium shadow-xs' : 'text-slate-600'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Full name"
                name="fullName"
                required
                error={invite.error?.fields.fullName}
              />
              {byPhone ? (
                <Field
                  label="Mobile number"
                  name="phone"
                  inputMode="tel"
                  placeholder="98290 12345"
                  required
                  error={invite.error?.fields.phone}
                />
              ) : (
                <Field
                  label="Email"
                  name="email"
                  type="email"
                  required
                  error={invite.error?.fields.email}
                />
              )}
              <Field
                label="Designation"
                name="designation"
                placeholder="e.g. PRT Hindi, Accountant"
              />
            </div>
            <AssignmentEditor
              roles={roles.data!}
              campuses={campuses.data!}
              value={assignments}
              onChange={setAssignments}
            />
            <div className="flex gap-2">
              <Button type="submit" loading={invite.pending} disabled={!assignments.length}>
                Add staff member
              </Button>
              <Button type="button" variant="secondary" onClick={() => setInviting(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {link && (
        <div className="mb-6 flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p>
            {link.name} is added. Send this link to {link.phone} so they can set a password (valid 7
            days).
          </p>
          <code className="break-all rounded bg-white px-2 py-1 text-xs">{link.url}</code>
          <div className="flex gap-2">
            <a
              href={`https://wa.me/${link.phone.replace(/\D/g, '')}?text=${encodeURIComponent(link.message)}`}
              target="_blank"
              rel="noopener"
            >
              <Button type="button">Send on WhatsApp</Button>
            </a>
            <Button variant="ghost" onClick={() => setLink(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {editing && ready && (
        <Card title={`Roles for ${editing.fullName}`} className="mb-6">
          <div className="flex flex-col gap-4">
            {save.error && <Alert>{save.error.message}</Alert>}
            <AssignmentEditor
              roles={roles.data!}
              campuses={campuses.data!}
              value={assignments}
              onChange={setAssignments}
            />
            <div className="flex gap-2">
              <Button onClick={saveRoles} loading={save.pending}>
                Save roles
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {status.error && (
        <div className="mb-4">
          <Alert>{status.error.message}</Alert>
        </div>
      )}

      <Card>
        {members.loading && !members.data ? (
          <Skeleton />
        ) : members.error ? (
          <Alert>{members.error.message}</Alert>
        ) : !members.data?.length ? (
          <EmptyState title="No staff yet">Invite your first colleague.</EmptyState>
        ) : (
          <Table head={['Name', 'Roles', 'Status', 'Last sign-in', '']}>
            {members.data.map((m) => (
              <tr key={m.id}>
                <Td>
                  <p className="font-medium">{m.fullName}</p>
                  <p className="text-xs text-slate-500">
                    {[m.designation, m.email ?? m.loginPhone].filter(Boolean).join(' · ')}
                  </p>
                </Td>
                <Td>
                  <ul className="flex flex-col gap-0.5">
                    {m.assignments.map((a) => (
                      <li key={`${a.roleId}:${a.campusId}`} className="text-sm">
                        {a.roleName}{' '}
                        <span className="text-slate-500">· {campusName(a.campusId)}</span>
                      </li>
                    ))}
                  </ul>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Badge
                      tone={
                        m.status === 'active' ? 'green' : m.status === 'invited' ? 'blue' : 'red'
                      }
                    >
                      {m.status}
                    </Badge>
                    {m.mfaEnabled && <Badge>2-step</Badge>}
                  </div>
                </Td>
                <Td>{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString('en-IN') : '—'}</Td>
                <Td className="text-right">
                  {manage && m.userId !== me.user.id && (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setInviting(false);
                          setEditing(m);
                          setAssignments(
                            m.assignments.map(({ roleId, campusId }) => ({ roleId, campusId })),
                          );
                        }}
                      >
                        Roles
                      </Button>
                      {m.status !== 'invited' && (
                        <Button
                          variant="ghost"
                          onClick={async () => {
                            const next = m.status === 'active' ? 'suspended' : 'active';
                            if (
                              next === 'suspended' &&
                              !confirm(`Suspend ${m.fullName}? They will lose access immediately.`)
                            )
                              return;
                            await status.run(() => patch(`/members/${m.id}`, { status: next }));
                            void members.reload();
                          }}
                        >
                          {m.status === 'active' ? 'Suspend' : 'Restore'}
                        </Button>
                      )}
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
