'use client';

import Link from 'next/link';
import { useState } from 'react';
import { post } from '@/lib/api';
import type { ExamListItem } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { EXAM_STATUS } from '@/components/exams/labels';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui';

const SUGGESTED = ['Periodic Test 1', 'Half-yearly', 'Periodic Test 2', 'Annual'];

export default function ExamsPage() {
  const { campus, picker } = useCampus();
  const list = useApi<{ canManage: boolean; items: ExamListItem[] }>(
    campus ? `/exams?campusId=${campus.id}` : null,
  );
  const act = useAction();
  const [form, setForm] = useState<{ name: string; startsOn: string; endsOn: string } | null>(null);
  const items = list.data?.items ?? [];

  const create = async () => {
    if (!form || !campus) return;
    const r = await act.run(() =>
      post<{ id: string }>('/exams', {
        campusId: campus.id,
        name: form.name,
        startsOn: form.startsOn || null,
        endsOn: form.endsOn || null,
      }),
    );
    if (r) window.location.href = `/exams/${(r as { id: string }).id}`;
  };

  return (
    <>
      <PageHeader
        title="Exams"
        description="Make the date sheet, let subject teachers enter marks, then publish results and report cards."
        actions={
          <div className="flex items-end gap-3">
            {picker}
            {list.data?.canManage && !form && (
              <Button
                onClick={() =>
                  setForm({
                    name: SUGGESTED.find((s) => !items.some((i) => i.name === s)) ?? '',
                    startsOn: '',
                    endsOn: '',
                  })
                }
              >
                New exam
              </Button>
            )}
          </div>
        }
      />
      {(list.error || act.error) && (
        <div className="mb-4">
          <Alert>{(act.error ?? list.error)!.message}</Alert>
        </div>
      )}
      {form && (
        <Card title="New exam" className="mb-6">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
              Name
              <input
                list="exam-names"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-9 w-56 rounded-lg border border-slate-300 px-3 text-sm font-normal"
              />
              <datalist id="exam-names">
                {SUGGESTED.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
              From (optional)
              <input
                type="date"
                value={form.startsOn}
                onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
                className="h-9 rounded-lg border border-slate-300 px-2 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
              To (optional)
              <input
                type="date"
                value={form.endsOn}
                min={form.startsOn}
                onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
                className="h-9 rounded-lg border border-slate-300 px-2 text-sm font-normal"
              />
            </label>
            <Button onClick={create} loading={act.pending} disabled={form.name.trim().length < 2}>
              Create and add date sheet
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
      {!list.data ? (
        <Skeleton rows={4} />
      ) : !items.length ? (
        <EmptyState title="No exams this year">
          {list.data.canManage
            ? 'Create the first one — for example Periodic Test 1.'
            : 'The exam in-charge has not created any exams yet.'}
        </EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((e) => (
            <Link
              key={e.id}
              href={`/exams/${e.id}`}
              className="rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-300"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{e.name}</h3>
                <Badge tone={EXAM_STATUS[e.status].tone}>{EXAM_STATUS[e.status].label}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {e.startsOn
                  ? `${formatDate(e.startsOn)}${e.endsOn ? ` – ${formatDate(e.endsOn)}` : ''}`
                  : 'Dates not set'}
                {' · '}
                {e.papers
                  ? `${e.classes} class${e.classes === 1 ? '' : 'es'}, ${e.papers} papers`
                  : 'No date sheet yet'}
              </p>
              {e.status !== 'draft' && e.toSubmit > 0 && (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.round((e.submitted / e.toSubmit) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Marks handed in: {e.submitted} of {e.toSubmit}
                  </p>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
