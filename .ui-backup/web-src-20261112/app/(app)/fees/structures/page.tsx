'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { post } from '@/lib/api';
import type { FeeStructureSummary, GradeLevel } from '@/lib/api';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import { inr, useYear } from '@/components/fees/money';
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

const STATUS_TONE = { draft: 'amber', published: 'green', archived: 'neutral' } as const;

export default function StructuresPage() {
  const { can } = useSession();
  const { campus, picker } = useCampus();
  const { yearId, picker: yearPicker } = useYear(campus?.id ?? null);
  const list = useApi<FeeStructureSummary[]>(
    campus && yearId ? `/fees/structures?campusId=${campus.id}&academicYearId=${yearId}` : null,
  );
  const manage = campus ? can('fees.configure', campus.id) : false;
  return (
    <>
      <PageHeader
        title="Fee structures"
        description="What each class pays and when. Optional fees (transport, hostel) are given to chosen students."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            {picker}
            {yearPicker}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          {list.error && <Alert>{list.error.message}</Alert>}
          {!list.data ? (
            <Skeleton rows={4} />
          ) : !list.data.length ? (
            <EmptyState title="No fee structures for this year">
              Create one for each group of classes that pays the same fees.
            </EmptyState>
          ) : (
            <Table head={['Structure', 'Applies to', 'Installments', 'Year total', 'Status']}>
              {list.data.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link
                      className="font-medium text-brand-700 hover:underline"
                      href={`/fees/structures/${s.id}`}
                    >
                      {s.name}
                    </Link>
                  </Td>
                  <Td>
                    {s.kind === 'optional' ? (
                      <span>
                        Optional · {s.assigned} student{s.assigned === 1 ? '' : 's'}
                      </span>
                    ) : s.classes.length ? (
                      s.classes.join(', ')
                    ) : (
                      <span className="text-slate-400">No classes</span>
                    )}
                  </Td>
                  <Td>{s.installments}</Td>
                  <Td className="tabular-nums">{inr(s.total)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[s.status]}>
                      {s.status[0]!.toUpperCase() + s.status.slice(1)}
                    </Badge>
                    {s.demands > 0 && (
                      <div className="mt-1 text-xs text-slate-500">{s.demands} demands raised</div>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {manage && campus && yearId && (
          <NewStructure campusId={campus.id} academicYearId={yearId} />
        )}
      </div>
    </>
  );
}

function NewStructure({ campusId, academicYearId }: { campusId: string; academicYearId: string }) {
  const router = useRouter();
  const classes = useApi<GradeLevel[]>(`/classes?campusId=${campusId}`);
  const [kind, setKind] = useState<'class' | 'optional'>('class');
  const [picked, setPicked] = useState<string[]>([]);
  const action = useAction();
  const f = action.error?.fields ?? {};
  return (
    <Card title="New fee structure">
      <form
        className="flex flex-col gap-4"
        onSubmit={onSubmitForm(async (form) => {
          const res = await action.run(() =>
            post<{ id: string }>('/fees/structures', {
              campusId,
              academicYearId,
              name: form.get('name'),
              kind,
              gradeLevelIds: kind === 'class' ? picked : [],
            }),
          );
          if (res) router.push(`/fees/structures/${res.id}`);
        })}
      >
        <Field label="Name" name="name" required placeholder="Classes 1–5 fees" error={f.name} />
        <SelectField
          label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'class' | 'optional')}
        >
          <option value="class">Class fees — every student of the chosen classes</option>
          <option value="optional">Optional fee — only students you add (transport…)</option>
        </SelectField>
        {kind === 'class' && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Classes</legend>
            <div className="grid grid-cols-2 gap-1.5 text-sm">
              {(classes.data ?? [])
                .filter((c) => c.status === 'active')
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
          </fieldset>
        )}
        {action.error && !Object.keys(f).length && <Alert>{action.error.message}</Alert>}
        <Button type="submit" loading={action.pending}>
          Create and add amounts
        </Button>
      </form>
    </Card>
  );
}
