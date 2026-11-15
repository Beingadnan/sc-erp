'use client';

import { useRef, useState } from 'react';
import { del, upload } from '@/lib/api';
import type { HomeworkItem, MyClass, SectionTimetable } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { Alert, Button, Card, Skeleton } from '@/components/ui';

/** Teacher side: give homework to one class and see what is already set. */
export function HomeworkPanel({ sectionId }: { sectionId: string }) {
  const list = useApi<{ items: HomeworkItem[] }>(`/homework?sectionId=${sectionId}`);
  const tt = useApi<SectionTimetable>(`/timetable/sections/${sectionId}`);
  const mine = useApi<{ sections: MyClass[] }>('/teaching/mine');
  const act = useAction();
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subjectId: '', title: '', details: '', dueOn: '' });

  const myEntry = mine.data?.sections.find((s) => s.sectionId === sectionId);
  const subjects =
    myEntry && !myEntry.isClassTeacher ? myEntry.subjects : (tt.data?.subjects ?? []);
  const subjectId = form.subjectId || (subjects.length === 1 ? subjects[0]!.id : '');

  const submit = async () => {
    const fd = new FormData();
    fd.set('sectionId', sectionId);
    fd.set('subjectId', subjectId);
    fd.set('title', form.title);
    fd.set('details', form.details);
    fd.set('dueOn', form.dueOn);
    const f = file.current?.files?.[0];
    if (f) fd.set('file', f);
    if (await act.run(() => upload('/homework', fd))) {
      setForm({ subjectId: '', title: '', details: '', dueOn: '' });
      if (file.current) file.current.value = '';
      setOpen(false);
      void list.reload();
    }
  };
  const remove = async (id: string) => {
    if (await act.run(() => del(`/homework/${id}`))) void list.reload();
  };

  return (
    <Card
      title="Homework"
      description="Parents see it in their app the same day."
      actions={!open && <Button onClick={() => setOpen(true)}>Give homework</Button>}
    >
      {act.error && (
        <div className="mb-3">
          <Alert>{act.error.message}</Alert>
        </div>
      )}
      {open && (
        <div className="mb-5 flex flex-col gap-3 rounded-lg bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
              Subject
              <select
                value={subjectId}
                onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal"
              >
                <option value="">Choose…</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
              What to do
              <input
                value={form.title}
                maxLength={200}
                placeholder="Learn table of 7; write it 3 times"
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
            More details (optional)
            <textarea
              value={form.details}
              rows={2}
              maxLength={4000}
              onChange={(e) => setForm({ ...form, details: e.target.value })}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
            />
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
              Submit by (optional)
              <input
                type="date"
                value={form.dueOn}
                onChange={(e) => setForm({ ...form, dueOn: e.target.value })}
                className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-800">
              Photo of the board (optional)
              <input
                ref={file}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                capture="environment"
                className="text-sm font-normal"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={submit}
              loading={act.pending}
              disabled={!subjectId || form.title.trim().length < 2}
            >
              Send to parents
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {!list.data ? (
        <Skeleton rows={3} />
      ) : !list.data.items.length ? (
        <p className="text-sm text-slate-500">No homework given in the last few weeks.</p>
      ) : (
        <HomeworkList items={list.data.items} onRemove={remove} />
      )}
    </Card>
  );
}

export function HomeworkList({
  items,
  onRemove,
}: {
  items: HomeworkItem[];
  onRemove?: (id: string) => void;
}) {
  const byDay = new Map<string, HomeworkItem[]>();
  for (const h of items) byDay.set(h.givenOn, [...(byDay.get(h.givenOn) ?? []), h]);
  return (
    <div className="flex flex-col gap-4">
      {[...byDay.entries()].map(([day, list]) => (
        <div key={day}>
          <div className="mb-1 text-xs font-medium text-slate-500">{formatDate(day)}</div>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {list.map((h) => (
              <li key={h.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                <span className="w-20 shrink-0 font-medium text-brand-700">{h.subjectName}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{h.title}</span>
                  {h.details && (
                    <span className="block whitespace-pre-line text-slate-600">{h.details}</span>
                  )}
                  <span className="block text-xs text-slate-500">
                    {h.dueOn ? `Submit by ${formatDate(h.dueOn)}` : 'No due date'}
                    {h.teacherName ? ` · ${h.teacherName}` : ''}
                    {h.attachmentUrl && (
                      <>
                        {' · '}
                        <a
                          href={h.attachmentUrl}
                          target="_blank"
                          rel="noopener"
                          className="text-brand-700 underline"
                        >
                          {h.contentType === 'application/pdf' ? 'Open PDF' : 'See photo'}
                        </a>
                      </>
                    )}
                  </span>
                </span>
                {onRemove && h.canRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(h.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
