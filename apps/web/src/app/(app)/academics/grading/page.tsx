'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { del, patch, post } from '@/lib/api';
import type { GradingBand, GradingScale } from '@/lib/api';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Skeleton,
  Table,
  Td,
  confirmAction,
} from '@/components/ui';

type DraftBand = {
  label: string;
  minPercent: string;
  maxPercent: string;
  gradePoint: string;
  remark: string;
};

const toDraft = (b: GradingBand): DraftBand => ({
  label: b.label,
  minPercent: String(b.minPercent),
  maxPercent: String(b.maxPercent),
  gradePoint: b.gradePoint === null ? '' : String(b.gradePoint),
  remark: b.remark,
});

const emptyBand = (): DraftBand => ({
  label: '',
  minPercent: '',
  maxPercent: '',
  gradePoint: '',
  remark: '',
});

const cell =
  'h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20';

function ScaleEditor({ scale, onDone }: { scale?: GradingScale; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const [name, setName] = useState(scale?.name ?? '');
  const [description, setDescription] = useState(scale?.description ?? '');
  const [bands, setBands] = useState<DraftBand[]>(
    scale?.bands.map(toDraft) ?? [emptyBand(), emptyBand()],
  );

  const set = (i: number, k: keyof DraftBand, v: string) =>
    setBands((bs) => bs.map((b, j) => (j === i ? { ...b, [k]: v } : b)));

  const save = async () => {
    const body = {
      name,
      description,
      bands: bands.map((b) => ({
        label: b.label,
        minPercent: Number(b.minPercent),
        maxPercent: Number(b.maxPercent),
        gradePoint: b.gradePoint.trim() === '' ? null : Number(b.gradePoint),
        remark: b.remark,
      })),
    };
    const ok = await run(() =>
      scale ? patch(`/grading-scales/${scale.id}`, body) : post('/grading-scales', body),
    );
    if (ok) onDone();
  };

  return (
    <div className="space-y-4">
      {error && <Alert>{error.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Scale name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Field
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="pb-1 font-medium">Grade</th>
              <th className="pb-1 font-medium">From %</th>
              <th className="pb-1 font-medium">To %</th>
              <th className="pb-1 font-medium">Grade point</th>
              <th className="pb-1 font-medium">Remark</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i}>
                {(['label', 'minPercent', 'maxPercent', 'gradePoint', 'remark'] as const).map(
                  (k) => (
                    <td key={k} className="py-1 pr-2">
                      <input
                        aria-label={`${k} row ${i + 1}`}
                        className={cell}
                        inputMode={k === 'label' || k === 'remark' ? 'text' : 'decimal'}
                        value={b[k]}
                        onChange={(e) => set(i, k, e.target.value)}
                      />
                    </td>
                  ),
                )}
                <td className="py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={bands.length <= 1}
                    onClick={() => setBands((bs) => bs.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Ranges must not overlap. Use two decimals to avoid gaps, e.g. 81 to 90.99 and 91 to 100.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setBands((bs) => [...bs, emptyBand()])}>
          Add grade
        </Button>
        <Button loading={pending} onClick={save}>
          {scale ? 'Save scale' : 'Create scale'}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function GradingPage() {
  const { canEverywhere } = useSession();
  const { data, loading, error, reload } = useApi<GradingScale[]>('/grading-scales');
  const [editing, setEditing] = useState<GradingScale | 'new' | null>(null);
  const remove = useAction();
  const manage = canEverywhere('academic.manage');

  const done = () => {
    setEditing(null);
    void reload();
  };

  return (
    <>
      <PageHeader
        title="Grading scales"
        description="Grade bands used on report cards. Assign a scale to each class on the Classes page."
        actions={
          manage &&
          !editing && (
            <Button onClick={() => setEditing('new')} icon={Plus}>
              New scale
            </Button>
          )
        }
      />
      {editing && (
        <Card
          title={editing === 'new' ? 'New grading scale' : `Edit ${editing.name}`}
          className="mb-6"
        >
          <ScaleEditor scale={editing === 'new' ? undefined : editing} onDone={done} />
        </Card>
      )}
      {remove.error && (
        <div className="mb-4">
          <Alert>{remove.error.message}</Alert>
        </div>
      )}
      {loading && !data ? (
        <Card>
          <Skeleton />
        </Card>
      ) : error ? (
        <Alert>{error.message}</Alert>
      ) : !data?.length ? (
        <Card>
          <EmptyState title="No grading scales yet">
            The ready-made structure on the Classes page adds board scales for you.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((s) => (
            <Card
              key={s.id}
              title={s.name}
              description={s.description}
              actions={
                manage && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (
                          !(await confirmAction({
                            title: `Delete ${s.name}?`,
                            confirmLabel: 'Delete scale',
                          }))
                        )
                          return;
                        await remove.run(() => del(`/grading-scales/${s.id}`));
                        void reload();
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                )
              }
            >
              <Table head={['Grade', 'Marks %', 'Grade point', 'Remark']}>
                {s.bands.map((b) => (
                  <tr key={b.label}>
                    <Td>
                      <span className="font-medium">{b.label}</span>
                    </Td>
                    <Td>
                      {b.minPercent} – {b.maxPercent}
                    </Td>
                    <Td>{b.gradePoint ?? '—'}</Td>
                    <Td>{b.remark || '—'}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
