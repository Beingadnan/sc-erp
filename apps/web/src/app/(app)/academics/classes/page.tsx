'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  ChevronRight,
  Layers,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
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
  ActionMenu,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SearchInput,
  SectionTitle,
  SelectField,
  Skeleton,
  Td,
  Toolbar,
  confirmAction,
  cx,
  toast,
} from '@/components/ui';

/* ----------------------------------- quick setup ----------------------------------- */

function QuickSetup({
  campusId,
  board,
  onDone,
}: {
  campusId: string;
  board: string;
  onDone: () => void;
}) {
  const { pending, error, run } = useAction();

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
      toast.success(
        `Added ${res.classesCreated} classes, ${res.subjectsCreated} subjects and ${res.gradingScalesCreated} grading scales.`,
      );
      onDone();
    }
  };

  return (
    <Card
      icon={Sparkles}
      title="Quick setup"
      description="Create a ready-made class structure with common subjects and grading scales. You can edit everything afterwards; nothing already set up is changed."
      className="mb-6"
    >
      <form onSubmit={onSubmitForm(submit)} className="space-y-4">
        {error && <Alert>{error.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-end">
          <SelectField
            label="Education board"
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
          <Checkbox
            name="includePrePrimary"
            defaultChecked
            label="Include Nursery, LKG and UKG"
            className="lg:mb-2"
          />
          <Button type="submit" loading={pending} icon={Sparkles}>
            Set up classes
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* -------------------------------------- forms -------------------------------------- */

function ClassModal({
  open,
  campusName,
  campusId,
  cls,
  scales,
  nextSort,
  onClose,
  onSaved,
}: {
  open: boolean;
  campusName: string;
  campusId: string;
  cls?: GradeLevel;
  scales: GradingScale[];
  nextSort: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pending, error, run, setError } = useAction();
  const f = error?.fields ?? {};
  useEffect(() => {
    if (open) setError(null);
  }, [open, setError]);

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
    if (ok) {
      toast.success(cls ? 'Class updated.' : 'Class added.');
      onSaved();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={cls ? `Edit ${cls.name}` : 'Add class'}
      description={cls ? undefined : `New class for ${campusName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="class-form" loading={pending}>
            {cls ? 'Save changes' : 'Add class'}
          </Button>
        </>
      }
    >
      <form
        id="class-form"
        key={cls?.id ?? 'new'}
        onSubmit={onSubmitForm(submit)}
        className="grid gap-4 sm:grid-cols-2"
      >
        {error && !Object.keys(f).length && (
          <Alert className="sm:col-span-2">{error.message}</Alert>
        )}
        <Field
          label="Class name"
          name="name"
          placeholder="e.g. Class 5"
          defaultValue={cls?.name}
          error={f.name}
          required
        />
        <Field
          label="Class code"
          name="code"
          placeholder="e.g. 5 or UKG"
          defaultValue={cls?.code}
          disabled={Boolean(cls)}
          hint={cls ? 'Codes can’t be changed once created.' : 'Short code used in reports.'}
          error={f.code}
          required={!cls}
        />
        <SelectField label="Stage" name="stage" defaultValue={cls?.stage ?? 'primary'} required>
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
          label="Display order"
          name="sortOrder"
          type="number"
          min={0}
          max={1000}
          defaultValue={cls?.sortOrder ?? nextSort}
          hint="Lower numbers appear first."
          error={f.sortOrder}
        />
      </form>
    </Modal>
  );
}

function SectionModal({
  target,
  yearId,
  yearName,
  teachers,
  onClose,
  onSaved,
}: {
  target: { cls: GradeLevel; section?: Section } | null;
  yearId: string;
  yearName: string;
  teachers: Member[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pending, error, run, setError } = useAction();
  const f = error?.fields ?? {};
  const section = target?.section;
  useEffect(() => {
    if (target) setError(null);
  }, [target, setError]);

  const submit = async (form: FormData) => {
    if (!target) return;
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
        : post('/sections', { ...body, academicYearId: yearId, gradeLevelId: target.cls.id }),
    );
    if (ok) {
      toast.success(section ? 'Section updated.' : 'Section added.');
      onSaved();
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={
        section
          ? `Edit section ${target?.cls.name} ${section.name}`
          : `Add section to ${target?.cls.name ?? ''}`
      }
      description={`Session ${yearName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="section-form" loading={pending}>
            {section ? 'Save changes' : 'Add section'}
          </Button>
        </>
      }
    >
      <form
        id="section-form"
        key={section?.id ?? target?.cls.id ?? 'none'}
        onSubmit={onSubmitForm(submit)}
        className="grid gap-4 sm:grid-cols-2"
      >
        {error && !Object.keys(f).length && (
          <Alert className="sm:col-span-2">{error.message}</Alert>
        )}
        <Field
          label="Section name"
          name="name"
          placeholder="e.g. A"
          defaultValue={section?.name}
          error={f.name}
          required
        />
        <Field
          label="Capacity"
          name="capacity"
          type="number"
          min={1}
          max={200}
          placeholder="Seats"
          defaultValue={section?.capacity ?? ''}
          error={f.capacity}
        />
        <Field
          label="Room"
          name="room"
          placeholder="e.g. 204"
          defaultValue={section?.room ?? ''}
          error={f.room}
        />
        {teachers && (
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
        )}
      </form>
    </Modal>
  );
}

function SubjectsModal({
  cls,
  subjects,
  current,
  onClose,
  onSaved,
}: {
  cls: GradeLevel | null;
  subjects: Subject[];
  current: ClassSubject[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Map<string, boolean>>(new Map());
  const save = useAction();
  useEffect(() => {
    if (cls) {
      setDraft(new Map((current ?? []).map((s) => [s.subjectId, s.isOptional])));
      save.setError(null);
    }
  }, [cls, current]);

  const active = subjects.filter((s) => s.status === 'active' || draft.has(s.id));
  const toggle = (id: string, on: boolean) =>
    setDraft((d) => {
      const n = new Map(d);
      if (on) n.set(id, false);
      else n.delete(id);
      return n;
    });

  const submit = async () => {
    if (!cls) return;
    // Keep the existing order, then append newly ticked subjects in list order.
    const order = [
      ...(current ?? []).map((s) => s.subjectId).filter((id) => draft.has(id)),
      ...active
        .map((s) => s.id)
        .filter((id) => draft.has(id) && !current?.some((x) => x.subjectId === id)),
    ];
    const ok = await save.run(() =>
      put(`/classes/${cls.id}/subjects`, {
        subjects: order.map((subjectId) => ({ subjectId, isOptional: draft.get(subjectId) })),
      }),
    );
    if (ok) {
      toast.success(`Subjects for ${cls.name} saved.`);
      onSaved();
    }
  };

  return (
    <Modal
      open={Boolean(cls)}
      onClose={onClose}
      size="lg"
      title={`Subjects · ${cls?.name ?? ''}`}
      description={`${draft.size} selected. Mark a subject optional if students choose it.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.pending} onClick={() => void submit()}>
            Save subjects
          </Button>
        </>
      }
    >
      {save.error && <Alert className="mb-3">{save.error.message}</Alert>}
      {!active.length ? (
        <EmptyState compact icon={BookOpen} title="No subjects yet">
          <Link href="/academics/subjects" className="text-brand-700 hover:underline">
            Create subjects
          </Link>{' '}
          first, then assign them here.
        </EmptyState>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {active.map((s) => {
            const on = draft.has(s.id);
            return (
              <div
                key={s.id}
                className={cx(
                  'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                  on ? 'border-brand-200 bg-brand-50/50' : 'border-line',
                )}
              >
                <label className="flex min-w-0 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggle(s.id, e.target.checked)}
                  />
                  <span className="truncate">{s.name}</span>
                </label>
                {on && (
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={draft.get(s.id)}
                      onChange={(e) => setDraft((d) => new Map(d).set(s.id, e.target.checked))}
                    />
                    Optional
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/* --------------------------------- expanded class row -------------------------------- */

function ClassDetail({
  cls,
  list,
  year,
  manage,
  yearLocked,
  onAddSection,
  onEditSection,
  onDeleteSection,
  onEditSubjects,
}: {
  cls: GradeLevel;
  list: Section[];
  year: AcademicYear | null;
  manage: boolean;
  yearLocked: boolean;
  onAddSection: () => void;
  onEditSection: (s: Section) => void;
  onDeleteSection: (s: Section) => void;
  onEditSubjects: (current: ClassSubject[] | null) => void;
}) {
  const subjects = useApi<ClassSubject[]>(`/classes/${cls.id}/subjects`);
  const canEditSections = manage && !yearLocked && cls.status === 'active' && Boolean(year);

  return (
    <div className="grid gap-6 bg-slate-50/60 px-5 py-4 lg:grid-cols-2">
      <div className="min-w-0">
        <SectionTitle
          actions={
            canEditSections && (
              <Button size="sm" variant="secondary" icon={Plus} onClick={onAddSection}>
                Add section
              </Button>
            )
          }
        >
          Sections {year ? `· ${year.name}` : ''}
        </SectionTitle>
        {!year ? (
          <p className="text-sm text-slate-500">Create an academic year to add sections.</p>
        ) : list.length ? (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-line bg-white">
            {list.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-700">
                  {s.name}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium text-ink">
                    {cls.name} {s.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {[
                      s.capacity ? `${s.capacity} seats` : null,
                      s.room ? `Room ${s.room}` : null,
                      s.classTeacherName
                        ? `Class teacher: ${s.classTeacherName}`
                        : 'No class teacher',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {manage && !yearLocked && (
                  <ActionMenu
                    label={`Actions for section ${s.name}`}
                    items={[
                      { label: 'Edit section', icon: Pencil, onClick: () => onEditSection(s) },
                      {
                        label: 'Delete section',
                        icon: Trash2,
                        danger: true,
                        onClick: () => onDeleteSection(s),
                      },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm text-slate-500">
            No sections in {year.name} yet.
          </div>
        )}
      </div>

      <div className="min-w-0">
        <SectionTitle
          actions={
            manage && (
              <Button
                size="sm"
                variant="secondary"
                icon={Pencil}
                disabled={subjects.loading && !subjects.data}
                onClick={() => onEditSubjects(subjects.data)}
              >
                Edit subjects
              </Button>
            )
          }
        >
          Subjects
        </SectionTitle>
        {subjects.loading && !subjects.data ? (
          <Skeleton rows={1} />
        ) : subjects.error ? (
          <Alert>{subjects.error.message}</Alert>
        ) : subjects.data?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {subjects.data.map((s) => (
              <Badge key={s.subjectId} tone={s.kind === 'scholastic' ? 'blue' : 'neutral'}>
                {s.name}
                {s.isOptional && <span className="font-normal opacity-70">· optional</span>}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No subjects assigned.</p>
        )}
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

  const [classModal, setClassModal] = useState<GradeLevel | 'new' | null>(null);
  const [sectionModal, setSectionModal] = useState<{ cls: GradeLevel; section?: Section } | null>(
    null,
  );
  const [subjectsModal, setSubjectsModal] = useState<{
    cls: GradeLevel;
    current: ClassSubject[] | null;
  } | null>(null);
  const [subjectsVersion, setSubjectsVersion] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
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
  const term = q.trim().toLowerCase();
  const visible = (classes.data ?? [])
    .filter((c) => showArchived || c.status === 'active')
    .filter(
      (c) => !term || c.name.toLowerCase().includes(term) || c.code.toLowerCase().includes(term),
    );
  const yearLocked = year?.status === 'closed';
  const sectionsOf = (id: string) => (sections.data ?? []).filter((s) => s.gradeLevelId === id);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const archive = async (c: GradeLevel) => {
    const archiving = c.status === 'active';
    if (
      archiving &&
      !(await confirmAction({
        title: `Archive ${c.name}?`,
        message: 'The class is hidden from new admissions and lists. You can restore it later.',
        confirmLabel: 'Archive class',
      }))
    )
      return;
    const ok = await remove.run(() =>
      patch(`/classes/${c.id}`, { status: archiving ? 'archived' : 'active' }),
    );
    if (ok) toast.success(archiving ? `${c.name} archived.` : `${c.name} restored.`);
    void classes.reload();
  };

  const deleteSection = async (c: GradeLevel, s: Section) => {
    if (
      !(await confirmAction({
        title: `Delete section ${c.name} ${s.name}?`,
        message: 'This cannot be undone. Sections with students enrolled can’t be deleted.',
        confirmLabel: 'Delete section',
      }))
    )
      return;
    const ok = await remove.run(() => del(`/sections/${s.id}`));
    if (ok) toast.success(`Section ${c.name} ${s.name} deleted.`);
    void sections.reload();
  };

  const empty = classes.data && classes.data.length === 0;

  return (
    <>
      <PageHeader
        title="Classes & Sections"
        description="Classes belong to a campus. Sections are created for each academic year."
        actions={
          manage && (
            <Button icon={Plus} onClick={() => setClassModal('new')}>
              Add class
            </Button>
          )
        }
      />

      {campus && schoolWide && empty && (
        <QuickSetup
          campusId={campus.id}
          board={campus.board}
          onDone={() => {
            void classes.reload();
            void subjects.reload();
            void scales.reload();
          }}
        />
      )}

      {years.data && years.data.length === 0 && (
        <Alert
          tone="info"
          className="mb-4"
          action={
            <Link href="/academics/years" className="text-sm font-medium underline">
              Add academic year
            </Link>
          }
        >
          Add an academic year first to create sections.
        </Alert>
      )}
      {yearLocked && (
        <Alert tone="warning" className="mb-4">
          {year?.name} is closed. Its sections are read-only.
        </Alert>
      )}
      {remove.error && <Alert className="mb-4">{remove.error.message}</Alert>}

      <Card flush>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-3.5">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Search classes"
            className="w-full sm:w-56"
          />
          <Toolbar className="flex-1 justify-end">
            {picker}
            {years.data && years.data.length > 0 && (
              <SelectField
                label="Academic year"
                value={yearId ?? ''}
                onChange={(e) => setYearId(e.target.value)}
                className="w-48"
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
              <Checkbox
                label="Show archived"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="mb-2"
              />
            )}
          </Toolbar>
        </div>

        {campusLoading || (classes.loading && !classes.data) ? (
          <div className="p-5">
            <Skeleton rows={5} />
          </div>
        ) : !campus ? (
          <EmptyState title="No active campus" icon={Layers}>
            Add a campus before setting up classes.
          </EmptyState>
        ) : classes.error ? (
          <div className="p-5">
            <Alert>{classes.error.message}</Alert>
          </div>
        ) : !visible.length ? (
          <EmptyState
            icon={Layers}
            title={term ? 'No classes match your search' : 'No classes yet'}
            action={
              !term &&
              manage && (
                <Button icon={Plus} onClick={() => setClassModal('new')}>
                  Add class
                </Button>
              )
            }
          >
            {term
              ? 'Try a different name or code.'
              : schoolWide
                ? 'Use Quick setup above to create a standard structure, or add classes one by one.'
                : 'Ask a school administrator to set up classes.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th scope="col" className="w-10 py-2.5 pl-5">
                    <span className="sr-only">Expand</span>
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Class name
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Code
                  </th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
                    Stage
                  </th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
                    Grading scale
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Sections
                  </th>
                  <th scope="col" className="py-2.5 pr-5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((c) => {
                  const list = sectionsOf(c.id);
                  const open = expanded.has(c.id);
                  return (
                    <Fragment key={c.id}>
                      <tr
                        className={cx(
                          'cursor-pointer transition-colors hover:bg-slate-50/70',
                          open && 'bg-slate-50/70',
                          c.status === 'archived' && 'text-slate-400',
                        )}
                        onClick={() => toggle(c.id)}
                      >
                        <td className="py-3 pl-5">
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-label={`${open ? 'Hide' : 'Show'} sections and subjects for ${c.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(c.id);
                            }}
                            className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
                          >
                            <ChevronRight
                              className={cx('size-4 transition-transform', open && 'rotate-90')}
                              aria-hidden
                            />
                          </button>
                        </td>
                        <Td className="font-medium text-ink">
                          <span className="flex items-center gap-2">
                            {c.name}
                            {c.status === 'archived' && <Badge>Archived</Badge>}
                          </span>
                        </Td>
                        <Td>
                          <span className="font-mono text-[13px] text-slate-600">{c.code}</span>
                        </Td>
                        <Td className="hidden text-slate-600 md:table-cell">
                          {STAGE_LABELS[c.stage]}
                        </Td>
                        <Td className="hidden text-slate-600 lg:table-cell">
                          {scaleName(c.gradingScaleId) ?? <span className="text-slate-400">—</span>}
                        </Td>
                        <Td>
                          {!year ? (
                            <span className="text-slate-400">—</span>
                          ) : list.length ? (
                            <span className="flex flex-wrap items-center gap-1">
                              {list.slice(0, 6).map((s) => (
                                <span
                                  key={s.id}
                                  className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-slate-100 px-1.5 text-xs font-medium text-slate-700"
                                >
                                  {s.name}
                                </span>
                              ))}
                              {list.length > 6 && (
                                <span className="text-xs text-slate-500">+{list.length - 6}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">None</span>
                          )}
                        </Td>
                        <td className="py-2 pr-5 text-right" onClick={(e) => e.stopPropagation()}>
                          {manage && (
                            <ActionMenu
                              label={`Actions for ${c.name}`}
                              items={[
                                {
                                  label: 'Edit class',
                                  icon: Pencil,
                                  onClick: () => setClassModal(c),
                                },
                                {
                                  label: 'Add section',
                                  icon: Plus,
                                  hidden: !year || yearLocked || c.status !== 'active',
                                  onClick: () => setSectionModal({ cls: c }),
                                },
                                {
                                  label: 'Sections & subjects',
                                  icon: BookOpen,
                                  hidden: open,
                                  onClick: () => setExpanded((s) => new Set(s).add(c.id)),
                                },
                                c.status === 'active'
                                  ? {
                                      label: 'Archive class',
                                      icon: Archive,
                                      danger: true,
                                      onClick: () => void archive(c),
                                    }
                                  : {
                                      label: 'Restore class',
                                      icon: ArchiveRestore,
                                      onClick: () => void archive(c),
                                    },
                              ]}
                            />
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7} className="p-0">
                            <ClassDetail
                              key={`${c.id}-${subjectsVersion}`}
                              cls={c}
                              list={list}
                              year={year}
                              manage={manage}
                              yearLocked={yearLocked}
                              onAddSection={() => setSectionModal({ cls: c })}
                              onEditSection={(s) => setSectionModal({ cls: c, section: s })}
                              onDeleteSection={(s) => void deleteSection(c, s)}
                              onEditSubjects={(current) => setSubjectsModal({ cls: c, current })}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
              {visible.length} {visible.length === 1 ? 'class' : 'classes'}
              {year &&
                ` · ${(sections.data ?? []).filter((s) => visible.some((c) => c.id === s.gradeLevelId)).length} sections in ${year.name}`}
            </p>
          </div>
        )}
      </Card>

      {campus && (
        <ClassModal
          open={Boolean(classModal)}
          campusId={campus.id}
          campusName={campus.name}
          cls={classModal && classModal !== 'new' ? classModal : undefined}
          scales={scales.data ?? []}
          nextSort={Math.max(0, ...(classes.data ?? []).map((c) => c.sortOrder)) + 1}
          onClose={() => setClassModal(null)}
          onSaved={() => {
            setClassModal(null);
            void classes.reload();
          }}
        />
      )}
      {year && (
        <SectionModal
          target={sectionModal}
          yearId={year.id}
          yearName={year.name}
          teachers={teachers}
          onClose={() => setSectionModal(null)}
          onSaved={() => {
            setSectionModal(null);
            void sections.reload();
          }}
        />
      )}
      <SubjectsModal
        cls={subjectsModal?.cls ?? null}
        current={subjectsModal?.current ?? null}
        subjects={subjects.data ?? []}
        onClose={() => setSubjectsModal(null)}
        onSaved={() => {
          setSubjectsModal(null);
          setSubjectsVersion((v) => v + 1);
        }}
      />
    </>
  );
}
