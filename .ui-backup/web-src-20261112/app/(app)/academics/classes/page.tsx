'use client';

import { useEffect, useMemo, useState } from 'react';
import { BOARDS, STAGES } from '@school-erp/validation';
import { del, patch, post, put } from '@/lib/api';
import type {
  AcademicYear,
  ClassSubject,
  GradeLevel,
  GradingScale,
  Member,
  Section,
  Subject,
} from '@/lib/api';
import { blank, STAGE_LABELS } from '@/lib/format';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
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
} from '@/components/ui';

/* ----------------------------------- starter setup ----------------------------------- */

function StarterSetup({
  campusId,
  board,
  onDone,
}: {
  campusId: string;
  board: string;
  onDone: () => void;
}) {
  const { pending, error, run } = useAction();
  const [result, setResult] = useState<Record<string, number> | null>(null);

  const submit = async (form: FormData) => {
    const res = await run(() =>
      post<Record<string, number>>('/academic/setup-template', {
        campusId,
        board: form.get('board'),
        includePrePrimary: form.get('includePrePrimary') === 'on',
        highestClass: Number(form.get('highestClass')),
      }),
    );
    if (res) {
      setResult(res);
      onDone();
    }
  };

  return (
    <Card
      title="Start with a ready-made structure"
      description="Adds Nursery to Class 12, common subjects for each stage and grading scales. Everything can be edited afterwards, and nothing already set up is changed."
      className="mb-6"
    >
      {result ? (
        <Alert tone="success">
          Added {result.classesCreated} classes, {result.subjectsCreated} subjects,{' '}
          {result.gradingScalesCreated} grading scales and {result.classSubjectsCreated} class
          subject links.
        </Alert>
      ) : (
        <form onSubmit={onSubmitForm(submit)} className="grid gap-4 sm:grid-cols-4 sm:items-end">
          {error && (
            <div className="sm:col-span-4">
              <Alert>{error.message}</Alert>
            </div>
          )}
          <SelectField
            label="Board"
            name="board"
            defaultValue={BOARDS.includes(board as never) ? board : 'CBSE'}
          >
            {BOARDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </SelectField>
          <SelectField label="Highest class" name="highestClass" defaultValue="12">
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>
                Class {i + 1}
              </option>
            ))}
          </SelectField>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" name="includePrePrimary" defaultChecked />
            Include Nursery, LKG, UKG
          </label>
          <Button type="submit" loading={pending}>
            Set up classes
          </Button>
        </form>
      )}
    </Card>
  );
}

/* -------------------------------------- forms -------------------------------------- */

function ClassForm({
  campusId,
  cls,
  scales,
  nextSort,
  onDone,
}: {
  campusId: string;
  cls?: GradeLevel;
  scales: GradingScale[];
  nextSort: number;
  onDone: () => void;
}) {
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const submit = async (form: FormData) => {
    const body = {
      name: form.get('name'),
      stage: form.get('stage'),
      sortOrder: Number(form.get('sortOrder')),
      gradingScaleId: blank(form.get('gradingScaleId')),
    };
    const ok = await run(() =>
      cls
        ? patch(`/classes/${cls.id}`, body)
        : post('/classes', { ...body, campusId, code: form.get('code') }),
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
      <Field label="Class name" name="name" defaultValue={cls?.name} error={f.name} required />
      <Field
        label="Code"
        name="code"
        defaultValue={cls?.code}
        disabled={Boolean(cls)}
        hint={cls ? 'Codes cannot be changed' : 'e.g. 5 or UKG'}
        error={f.code}
        required
      />
      <SelectField label="Stage" name="stage" defaultValue={cls?.stage ?? 'primary'}>
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Grading scale"
        name="gradingScaleId"
        defaultValue={cls?.gradingScaleId ?? ''}
      >
        <option value="">None</option>
        {scales.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </SelectField>
      <Field
        label="Order"
        name="sortOrder"
        type="number"
        min={0}
        max={1000}
        defaultValue={cls?.sortOrder ?? nextSort}
        hint="Lower numbers are listed first"
        error={f.sortOrder}
      />
      <div className="flex items-end gap-2">
        <Button type="submit" loading={pending}>
          {cls ? 'Save class' : 'Add class'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SectionForm({
  yearId,
  classId,
  section,
  teachers,
  onDone,
}: {
  yearId: string;
  classId: string;
  section?: Section;
  teachers: Member[] | null;
  onDone: () => void;
}) {
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const submit = async (form: FormData) => {
    const capacity = blank(form.get('capacity'));
    const body = {
      name: form.get('name'),
      capacity: capacity === null ? null : Number(capacity),
      room: blank(form.get('room')),
      ...(teachers ? { classTeacherMembershipId: blank(form.get('classTeacher')) } : {}),
    };
    const ok = await run(() =>
      section
        ? patch(`/sections/${section.id}`, body)
        : post('/sections', { ...body, academicYearId: yearId, gradeLevelId: classId }),
    );
    if (ok) onDone();
  };
  return (
    <form
      onSubmit={onSubmitForm(submit)}
      className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-5 sm:items-end"
    >
      {error && !Object.keys(f).length && (
        <div className="sm:col-span-5">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field label="Section" name="name" defaultValue={section?.name} error={f.name} required />
      <Field
        label="Capacity"
        name="capacity"
        type="number"
        min={1}
        max={200}
        defaultValue={section?.capacity ?? ''}
        error={f.capacity}
      />
      <Field label="Room" name="room" defaultValue={section?.room ?? ''} error={f.room} />
      {teachers ? (
        <SelectField
          label="Class teacher"
          name="classTeacher"
          defaultValue={section?.classTeacherMembershipId ?? ''}
        >
          <option value="">Not assigned</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.fullName}
            </option>
          ))}
        </SelectField>
      ) : (
        <div />
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>
          {section ? 'Save' : 'Add'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SubjectsEditor({
  cls,
  subjects,
  manage,
}: {
  cls: GradeLevel;
  subjects: Subject[];
  manage: boolean;
}) {
  const { data, loading, error, reload } = useApi<ClassSubject[]>(`/classes/${cls.id}/subjects`);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Map<string, boolean>>(new Map());
  const save = useAction();

  useEffect(() => {
    if (data) setDraft(new Map(data.map((s) => [s.subjectId, s.isOptional])));
  }, [data]);

  if (loading && !data) return <Skeleton rows={1} />;
  if (error) return <Alert>{error.message}</Alert>;

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {data?.length ? (
          data.map((s) => (
            <Badge key={s.subjectId} tone={s.kind === 'scholastic' ? 'blue' : 'neutral'}>
              {s.name}
              {s.isOptional ? ' (optional)' : ''}
            </Badge>
          ))
        ) : (
          <span className="text-sm text-slate-500">No subjects yet.</span>
        )}
        {manage && (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Edit subjects
          </Button>
        )}
      </div>
    );
  }

  const active = subjects.filter((s) => s.status === 'active' || draft.has(s.id));
  const toggle = (id: string, on: boolean) =>
    setDraft((d) => {
      const n = new Map(d);
      if (on) n.set(id, false);
      else n.delete(id);
      return n;
    });

  return (
    <div className="space-y-3">
      {save.error && <Alert>{save.error.message}</Alert>}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-md border border-slate-200 px-2.5 py-1.5 text-sm"
          >
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.has(s.id)}
                onChange={(e) => toggle(s.id, e.target.checked)}
              />
              {s.name}
            </label>
            {draft.has(s.id) && (
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={draft.get(s.id)}
                  onChange={(e) => setDraft((d) => new Map(d).set(s.id, e.target.checked))}
                />
                optional
              </label>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          loading={save.pending}
          onClick={async () => {
            // Keep the existing order, then append newly ticked subjects in list order.
            const order = [
              ...(data ?? []).map((s) => s.subjectId).filter((id) => draft.has(id)),
              ...active
                .map((s) => s.id)
                .filter((id) => draft.has(id) && !data?.some((x) => x.subjectId === id)),
            ];
            const ok = await save.run(() =>
              put(`/classes/${cls.id}/subjects`, {
                subjects: order.map((subjectId) => ({
                  subjectId,
                  isOptional: draft.get(subjectId),
                })),
              }),
            );
            if (ok) {
              setEditing(false);
              void reload();
            }
          }}
        >
          Save subjects
        </Button>
        <Button variant="secondary" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------- page --------------------------------------- */

export default function ClassesPage() {
  const { can, canEverywhere } = useSession();
  const { campus, picker, loading: campusLoading } = useCampus();
  const manage = campus ? can('academic.manage', campus.id) : false;
  const schoolWide = canEverywhere('academic.manage');

  const classes = useApi<GradeLevel[]>(campus ? `/classes?campusId=${campus.id}` : null);
  const years = useApi<AcademicYear[]>(campus ? `/academic-years?campusId=${campus.id}` : null);
  const subjects = useApi<Subject[]>('/subjects');
  const scales = useApi<GradingScale[]>('/grading-scales');
  const members = useApi<Member[]>(can('members.view') ? '/members' : null);

  const [yearId, setYearId] = useState<string | null>(null);
  useEffect(() => {
    const list = years.data ?? [];
    setYearId((cur) =>
      cur && list.some((y) => y.id === cur)
        ? cur
        : ((
            list.find((y) => y.isCurrent) ??
            list.findLast((y) => y.status !== 'closed') ??
            list.at(-1)
          )?.id ?? null),
    );
  }, [years.data]);
  const year = years.data?.find((y) => y.id === yearId) ?? null;
  const sections = useApi<Section[]>(yearId ? `/sections?academicYearId=${yearId}` : null);

  const [editingClass, setEditingClass] = useState<GradeLevel | 'new' | null>(null);
  const [sectionForm, setSectionForm] = useState<{ classId: string; section?: Section } | null>(
    null,
  );
  const [showArchived, setShowArchived] = useState(false);
  const remove = useAction();

  const teachers = useMemo(
    () =>
      members.data
        ? members.data.filter(
            (m) =>
              m.status === 'active' &&
              m.assignments.some((a) => a.campusId === null || a.campusId === campus?.id),
          )
        : null,
    [members.data, campus?.id],
  );
  const scaleName = (id: string | null) => scales.data?.find((s) => s.id === id)?.name;
  const visible = (classes.data ?? []).filter((c) => showArchived || c.status === 'active');
  const yearLocked = year?.status === 'closed';

  const refreshClasses = () => {
    setEditingClass(null);
    void classes.reload();
  };
  const refreshSections = () => {
    setSectionForm(null);
    void sections.reload();
  };

  return (
    <>
      <PageHeader
        title="Classes & sections"
        description="Classes belong to a campus; sections are created for each academic year."
        actions={
          manage &&
          !editingClass && <Button onClick={() => setEditingClass('new')}>Add class</Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-4">
        {picker}
        {years.data && years.data.length > 0 && (
          <SelectField
            label="Academic year"
            value={yearId ?? ''}
            onChange={(e) => setYearId(e.target.value)}
            className="w-56"
          >
            {years.data.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
                {y.isCurrent ? ' (current)' : y.status === 'closed' ? ' (closed)' : ''}
              </option>
            ))}
          </SelectField>
        )}
        {classes.data?.some((c) => c.status === 'archived') && (
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived classes
          </label>
        )}
      </div>

      {campus && schoolWide && classes.data && classes.data.length === 0 && (
        <StarterSetup
          campusId={campus.id}
          board={campus.board}
          onDone={() => {
            void classes.reload();
            void subjects.reload();
            void scales.reload();
          }}
        />
      )}

      {campus && editingClass && (
        <Card
          title={
            editingClass === 'new' ? `New class · ${campus.name}` : `Edit ${editingClass.name}`
          }
          className="mb-6"
        >
          <ClassForm
            campusId={campus.id}
            cls={editingClass === 'new' ? undefined : editingClass}
            scales={scales.data ?? []}
            nextSort={Math.max(0, ...(classes.data ?? []).map((c) => c.sortOrder)) + 1}
            onDone={refreshClasses}
          />
        </Card>
      )}

      {years.data && years.data.length === 0 && (
        <div className="mb-4">
          <Alert tone="info">
            Add an academic year first to create sections.{' '}
            <a className="underline" href="/academics/years">
              Go to academic years
            </a>
          </Alert>
        </div>
      )}
      {yearLocked && (
        <div className="mb-4">
          <Alert tone="warning">{year?.name} is closed. Its sections are read-only.</Alert>
        </div>
      )}
      {remove.error && (
        <div className="mb-4">
          <Alert>{remove.error.message}</Alert>
        </div>
      )}

      {campusLoading || (classes.loading && !classes.data) ? (
        <Card>
          <Skeleton />
        </Card>
      ) : !campus ? (
        <Card>
          <EmptyState title="No active campus" />
        </Card>
      ) : classes.error ? (
        <Alert>{classes.error.message}</Alert>
      ) : !visible.length ? (
        <Card>
          <EmptyState title="No classes yet">
            {schoolWide
              ? 'Use the ready-made structure above or add classes one by one.'
              : 'Ask a school administrator to set up classes.'}
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {visible.map((c) => {
            const list = (sections.data ?? []).filter((s) => s.gradeLevelId === c.id);
            return (
              <Card
                key={c.id}
                title={c.name}
                description={[STAGE_LABELS[c.stage], scaleName(c.gradingScaleId)]
                  .filter(Boolean)
                  .join(' · ')}
                actions={
                  <div className="flex items-center gap-1">
                    {c.status === 'archived' && <Badge>archived</Badge>}
                    {manage && (
                      <>
                        <Button variant="ghost" onClick={() => setEditingClass(c)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={async () => {
                            await remove.run(() =>
                              patch(`/classes/${c.id}`, {
                                status: c.status === 'active' ? 'archived' : 'active',
                              }),
                            );
                            void classes.reload();
                          }}
                        >
                          {c.status === 'active' ? 'Archive' : 'Restore'}
                        </Button>
                      </>
                    )}
                  </div>
                }
              >
                <div className="space-y-4">
                  <div>
                    <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      Subjects
                    </h3>
                    <SubjectsEditor cls={c} subjects={subjects.data ?? []} manage={manage} />
                  </div>
                  {year && (
                    <div>
                      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                        Sections · {year.name}
                      </h3>
                      {list.length ? (
                        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                          {list.map((s) => (
                            <li
                              key={s.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                            >
                              <span>
                                <span className="font-medium">
                                  {c.name} {s.name}
                                </span>
                                <span className="ml-3 text-slate-500">
                                  {[
                                    s.capacity ? `${s.capacity} seats` : null,
                                    s.room ? `Room ${s.room}` : null,
                                    s.classTeacherName
                                      ? `Class teacher: ${s.classTeacherName}`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              </span>
                              {manage && !yearLocked && (
                                <span className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    onClick={() => setSectionForm({ classId: c.id, section: s })}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    onClick={async () => {
                                      if (!confirm(`Delete section ${c.name} ${s.name}?`)) return;
                                      await remove.run(() => del(`/sections/${s.id}`));
                                      void sections.reload();
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-500">No sections for this year.</p>
                      )}
                      {sectionForm?.classId === c.id ? (
                        <SectionForm
                          key={sectionForm.section?.id ?? 'new'}
                          yearId={year.id}
                          classId={c.id}
                          section={sectionForm.section}
                          teachers={teachers}
                          onDone={refreshSections}
                        />
                      ) : (
                        manage &&
                        !yearLocked &&
                        c.status === 'active' && (
                          <Button
                            variant="secondary"
                            className="mt-2"
                            onClick={() => setSectionForm({ classId: c.id })}
                          >
                            Add section
                          </Button>
                        )
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
