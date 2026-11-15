'use client';

import { useState } from 'react';
import { post, put } from '@/lib/api';
import type { NoticeAudience, NoticeRow } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui';

const AUDIENCE: Record<NoticeAudience, string> = {
  everyone: 'Parents and staff',
  parents: 'Parents only',
  staff: 'Staff only',
};
const STATUS_TONE = { draft: 'amber', published: 'green', archived: 'neutral' } as const;
const STATUS_LABEL = { draft: 'Draft', published: 'Sent', archived: 'Taken down' } as const;

interface Grid {
  classes: Array<{
    gradeLevelId: string;
    name: string;
    sections: Array<{ id: string; name: string }>;
  }>;
}

type Draft = {
  id?: string;
  title: string;
  body: string;
  audience: NoticeAudience;
  gradeLevelIds: string[];
  sectionIds: string[];
  pinned: boolean;
  expiresOn: string;
};
const EMPTY: Draft = {
  title: '',
  body: '',
  audience: 'everyone',
  gradeLevelIds: [],
  sectionIds: [],
  pinned: false,
  expiresOn: '',
};

export default function NoticesPage() {
  const { campus, picker } = useCampus();
  const list = useApi<{ items: NoticeRow[] }>('/notices');
  const grid = useApi<Grid>(campus ? `/teaching/grid?campusId=${campus.id}` : null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const act = useAction();

  const classNameOf = (id: string) => grid.data?.classes.find((c) => c.gradeLevelId === id)?.name;
  const sectionNameOf = (id: string) => {
    for (const c of grid.data?.classes ?? []) {
      const s = c.sections.find((x) => x.id === id);
      if (s) return `${c.name} ${s.name}`;
    }
    return undefined;
  };
  const whoFor = (n: NoticeRow) => {
    const parts = [
      ...n.gradeLevelIds.map((id) => classNameOf(id) ?? 'a class'),
      ...n.sectionIds.map((id) => sectionNameOf(id) ?? 'a section'),
    ];
    return `${AUDIENCE[n.audience]}${parts.length ? ` · ${parts.join(', ')}` : ' · whole school'}`;
  };

  const save = async (publish: boolean) => {
    if (!draft) return;
    const body = {
      campusId: campus?.id ?? null,
      title: draft.title,
      body: draft.body,
      audience: draft.audience,
      gradeLevelIds: draft.audience === 'staff' ? [] : draft.gradeLevelIds,
      sectionIds: draft.audience === 'staff' ? [] : draft.sectionIds,
      pinned: draft.pinned,
      expiresOn: draft.expiresOn || null,
    };
    const res = await act.run(() =>
      draft.id
        ? put<{ id: string }>(`/notices/${draft.id}`, body)
        : post<{ id: string }>('/notices', body),
    );
    if (!res) return;
    const id = draft.id ?? (res as { id: string }).id;
    if (publish && !(await act.run(() => post(`/notices/${id}/publish`, {})))) return;
    setDraft(null);
    void list.reload();
  };
  const setStatus = async (id: string, to: 'publish' | 'archive') => {
    if (await act.run(() => post(`/notices/${id}/${to}`, {}))) void list.reload();
  };

  const toggle = (key: 'gradeLevelIds' | 'sectionIds', id: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            [key]: d[key].includes(id) ? d[key].filter((x) => x !== id) : [...d[key], id],
          }
        : d,
    );

  return (
    <>
      <PageHeader
        title="Notices"
        description="Circulars for parents and staff. Parents see them in their app; staff on their Today page."
        actions={
          <div className="flex items-end gap-3">
            {picker}
            {!draft && <Button onClick={() => setDraft(EMPTY)}>New notice</Button>}
          </div>
        }
      />
      {(list.error || act.error) && (
        <div className="mb-4">
          <Alert>{(act.error ?? list.error)!.message}</Alert>
        </div>
      )}

      {draft && (
        <Card title={draft.id ? 'Edit notice' : 'New notice'} className="mb-6">
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
              Title
              <input
                value={draft.title}
                maxLength={200}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="School closed on Monday"
                className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
              Message
              <textarea
                value={draft.body}
                rows={5}
                maxLength={5000}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              />
            </label>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="mb-1.5 font-medium text-slate-800">Who should see it</legend>
              {(Object.keys(AUDIENCE) as NoticeAudience[]).map((a) => (
                <label key={a} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="audience"
                    checked={draft.audience === a}
                    onChange={() => setDraft({ ...draft, audience: a })}
                  />
                  {AUDIENCE[a]}
                </label>
              ))}
            </fieldset>
            {draft.audience !== 'staff' && grid.data && (
              <div className="text-sm">
                <div className="mb-1.5 font-medium text-slate-800">
                  Only some classes?{' '}
                  <span className="font-normal text-slate-500">
                    (leave empty for the whole school)
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {grid.data.classes.map((c) => (
                    <div key={c.gradeLevelId} className="flex flex-wrap items-center gap-2">
                      <Chip
                        on={draft.gradeLevelIds.includes(c.gradeLevelId)}
                        onClick={() => toggle('gradeLevelIds', c.gradeLevelId)}
                      >
                        {c.name} (all)
                      </Chip>
                      {c.sections.length > 1 &&
                        c.sections.map((s) => (
                          <Chip
                            key={s.id}
                            on={draft.sectionIds.includes(s.id)}
                            onClick={() => toggle('sectionIds', s.id)}
                          >
                            {s.name}
                          </Chip>
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={draft.pinned}
                  onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
                />
                Keep at the top
              </label>
              <label className="flex flex-col gap-1.5 font-medium text-slate-800">
                Hide after (optional)
                <input
                  type="date"
                  value={draft.expiresOn}
                  onChange={(e) => setDraft({ ...draft, expiresOn: e.target.value })}
                  className="h-9 rounded-lg border border-slate-300 px-2 font-normal"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => save(true)} loading={act.pending}>
                Send now
              </Button>
              <Button variant="secondary" onClick={() => save(false)} disabled={act.pending}>
                Save as draft
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {!list.data ? (
        <Skeleton rows={5} />
      ) : !list.data.items.length ? (
        <EmptyState title="No notices yet">
          Send your first circular — a holiday, a PTM, a fee reminder.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {list.data.items.map((n) => (
            <Card key={n.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{n.title}</h3>
                    <Badge tone={STATUS_TONE[n.status]}>{STATUS_LABEL[n.status]}</Badge>
                    {n.pinned && <Badge tone="blue">Pinned</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {whoFor(n)}
                    {n.publishedAt ? ` · sent ${formatDate(n.publishedAt.slice(0, 10))}` : ''}
                    {n.byName ? ` by ${n.byName}` : ''}
                    {n.status !== 'draft' ? ` · read by ${n.reads}` : ''}
                  </p>
                  <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-slate-700">
                    {n.body}
                  </p>
                </div>
                <div className="flex gap-2">
                  {n.status === 'draft' && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setDraft({
                            id: n.id,
                            title: n.title,
                            body: n.body,
                            audience: n.audience,
                            gradeLevelIds: n.gradeLevelIds,
                            sectionIds: n.sectionIds,
                            pinned: n.pinned,
                            expiresOn: n.expiresOn ?? '',
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button onClick={() => setStatus(n.id, 'publish')} disabled={act.pending}>
                        Send
                      </Button>
                    </>
                  )}
                  {n.status === 'published' && (
                    <Button
                      variant="ghost"
                      onClick={() => setStatus(n.id, 'archive')}
                      disabled={act.pending}
                    >
                      Take down
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 text-xs ${
        on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
