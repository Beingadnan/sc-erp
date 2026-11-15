'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { post, upload } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { Alert, Badge, Button, Card, PageHeader, Table, Td } from '@/components/ui';
import { OpeningBalancesButtons, OpeningBalancesPanel } from '@/components/setup/opening-balances';
import type { OpeningPreview } from '@/components/setup/opening-balances';

interface Preview {
  id: string;
  summary: Record<string, number | string>;
  problems: Array<{ sheet: string; row: number; message: string }>;
  problemCount: number;
  plan: {
    classes: Array<{ name: string; isNew: boolean }>;
    sections: Array<{
      className: string;
      name: string;
      isNew: boolean;
      classTeacher: string | null;
    }>;
    subjects: Array<{ code: string; name: string; isNew: boolean; classes: string[] }>;
    staff: Array<{
      fullName: string;
      contact: string;
      role: string;
      designation: string;
      isNew: boolean;
    }>;
    teaching: Array<{ className: string; section: string; subject: string; teacher: string }>;
  };
}
interface Applied {
  added: Record<string, number>;
  staffLinks: Array<{ fullName: string; phone: string; url: string; message: string }>;
}
interface History {
  items: Array<{
    id: string;
    status: 'previewed' | 'applied' | 'undone' | 'cancelled';
    fileName: string;
    summary: Record<string, number>;
    problemCount: number;
    createdAt: string;
    byName: string | null;
  }>;
}

const TABS = ['sections', 'subjects', 'staff', 'teaching'] as const;
const TAB_LABEL = {
  sections: 'Classes',
  subjects: 'Subjects',
  staff: 'Staff',
  teaching: 'Who teaches what',
};

export default function ImportOldDataPage() {
  const { campus, picker } = useCampus();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('sections');
  const act = useAction();
  const [opening, setOpening] = useState<OpeningPreview | null>(null);
  const history = useApi<History>(campus ? `/setup-imports?campusId=${campus.id}` : null);

  const choose = async (f: File | undefined) => {
    if (!f || !campus) return;
    setApplied(null);
    const form = new FormData();
    form.set('file', f);
    const r = await act.run(() => upload<Preview>(`/setup-imports?campusId=${campus.id}`, form));
    if (r) setPreview(r);
    if (fileRef.current) fileRef.current.value = '';
    void history.reload();
  };

  const p = preview;
  const s = p?.summary ?? {};

  return (
    <>
      <PageHeader
        title="Import old data"
        description="Bring your school's existing records in from Excel instead of typing them again. Nothing is saved until you check the preview, and an import can be undone."
        actions={picker}
      />
      {act.error && (
        <div className="mb-4">
          <Alert>{act.error.message}</Alert>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card
          title="1. Classes, subjects and staff"
          description="One workbook: classes & sections, subjects, staff and who teaches what."
        >
          <div className="flex flex-wrap gap-2">
            <a href="/api/v1/setup-imports/template" className="inline-flex">
              <Button variant="secondary" type="button">
                Download template
              </Button>
            </a>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            <Button loading={act.pending} onClick={() => fileRef.current?.click()}>
              Upload workbook
            </Button>
          </div>
        </Card>
        <Card
          title="2. Students and parents"
          description="Excel or CSV with admission numbers, classes and parents' mobiles."
        >
          <Link href="/students/import">
            <Button variant="secondary">Import students</Button>
          </Link>
        </Card>
        <Card
          title="3. Old fee balances"
          description="Previous dues and advance per student, by admission number."
        >
          {campus && <OpeningBalancesButtons campusId={campus.id} onPreview={setOpening} />}
        </Card>
      </div>

      {p && !applied && (
        <Card
          className="mt-6"
          title={
            p.problemCount
              ? `${p.problemCount} problem${p.problemCount > 1 ? 's' : ''} to fix`
              : 'Ready to import'
          }
          description={`Year ${s.yearName}. ${
            p.problemCount
              ? 'Fix these rows in Excel and upload the workbook again. Nothing has been saved.'
              : 'Check what will be added, then import.'
          }`}
        >
          {p.problemCount > 0 ? (
            <Table head={['Sheet', 'Row', 'Problem']}>
              {p.problems.map((x, i) => (
                <tr key={i}>
                  <Td>{x.sheet}</Td>
                  <Td className="tabular-nums">{x.row}</Td>
                  <Td className="text-red-700">{x.message}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['New classes', s.newClasses],
                  ['New sections', s.newSections],
                  ['New subjects', s.newSubjects],
                  ['New staff', s.newStaff],
                  ['Staff already here', s.existingStaff],
                  ['Class teachers', s.classTeachers],
                  ['Subject teachers', s.teaching],
                  ['Subject–class links', s.subjectLinks],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">{l}</div>
                    <div className="text-xl font-semibold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-1 border-b border-slate-200 text-sm">
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`border-b-2 px-3 py-2 ${tab === t ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-slate-600'}`}
                  >
                    {TAB_LABEL[t]} ({p.plan[t].length})
                  </button>
                ))}
              </div>
              <div className="max-h-96 overflow-y-auto">
                {tab === 'sections' && (
                  <Table head={['Class', 'Section', 'Class teacher', '']}>
                    {p.plan.sections.map((x, i) => (
                      <tr key={i}>
                        <Td>{x.className}</Td>
                        <Td>{x.name}</Td>
                        <Td>{x.classTeacher ?? '—'}</Td>
                        <Td>
                          {x.isNew ? <Badge tone="blue">New</Badge> : <Badge>Already here</Badge>}
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
                {tab === 'subjects' && (
                  <Table head={['Code', 'Subject', 'Classes', '']}>
                    {p.plan.subjects.map((x) => (
                      <tr key={x.code}>
                        <Td className="font-mono text-xs">{x.code}</Td>
                        <Td>{x.name}</Td>
                        <Td className="text-slate-600">{x.classes.join(', ')}</Td>
                        <Td>
                          {x.isNew ? <Badge tone="blue">New</Badge> : <Badge>Already here</Badge>}
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
                {tab === 'staff' && (
                  <Table head={['Name', 'Mobile / email', 'Role', '']}>
                    {p.plan.staff.map((x, i) => (
                      <tr key={i}>
                        <Td>
                          {x.fullName}
                          {x.designation && (
                            <div className="text-xs text-slate-500">{x.designation}</div>
                          )}
                        </Td>
                        <Td>{x.contact}</Td>
                        <Td>{x.role}</Td>
                        <Td>
                          {x.isNew ? <Badge tone="blue">New</Badge> : <Badge>Already here</Badge>}
                        </Td>
                      </tr>
                    ))}
                  </Table>
                )}
                {tab === 'teaching' && (
                  <Table head={['Class', 'Subject', 'Teacher']}>
                    {p.plan.teaching.map((x, i) => (
                      <tr key={i}>
                        <Td>
                          {x.className} {x.section}
                        </Td>
                        <Td>{x.subject}</Td>
                        <Td>{x.teacher}</Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  loading={act.pending}
                  onClick={async () => {
                    const r = await act.run(() =>
                      post<Applied>(`/setup-imports/${p.id}/apply`, {}),
                    );
                    if (r) {
                      setApplied(r);
                      void history.reload();
                    }
                  }}
                >
                  Import now
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await act.run(() => post(`/setup-imports/${p.id}/cancel`, {}));
                    setPreview(null);
                    void history.reload();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {applied && (
        <Card
          className="mt-6"
          title="Imported"
          description="You can undo this import from the list below."
        >
          <p className="text-sm text-slate-700">
            Added {applied.added.gradeLevels} classes, {applied.added.sections} sections,{' '}
            {applied.added.subjects} subjects, {applied.added.memberships} staff,{' '}
            {applied.added.classTeachers} class teachers and {applied.added.teaching} subject
            teachers.
          </p>
          {applied.staffLinks.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 font-medium">Send each teacher their sign-in link</h3>
              <Table head={['Name', 'Mobile', '']}>
                {applied.staffLinks.map((l) => (
                  <tr key={l.url}>
                    <Td>{l.fullName}</Td>
                    <Td>{l.phone}</Td>
                    <Td>
                      <a
                        className="font-medium text-brand-700 hover:underline"
                        href={`https://wa.me/${l.phone.replace(/\D/g, '')}?text=${encodeURIComponent(l.message)}`}
                        target="_blank"
                        rel="noopener"
                      >
                        Send on WhatsApp
                      </a>
                    </Td>
                  </tr>
                ))}
              </Table>
              <p className="mt-2 text-xs text-slate-500">
                These links are shown only now and are valid for 7 days.
              </p>
            </div>
          )}
        </Card>
      )}

      {campus && (
        <OpeningBalancesPanel
          key={opening?.id ?? 'none'}
          campusId={campus.id}
          preview={opening}
          onDone={() => setOpening(null)}
        />
      )}

      {!!history.data?.items.length && (
        <Card className="mt-6" title="Past imports">
          <Table head={['When', 'File', 'Status', '']}>
            {history.data.items.map((h) => (
              <tr key={h.id}>
                <Td className="whitespace-nowrap">
                  {formatDate(h.createdAt)}
                  <div className="text-xs text-slate-500">{h.byName}</div>
                </Td>
                <Td>{h.fileName}</Td>
                <Td>
                  <Badge
                    tone={
                      h.status === 'applied' ? 'green' : h.status === 'undone' ? 'amber' : 'neutral'
                    }
                  >
                    {h.status === 'previewed'
                      ? h.problemCount
                        ? 'Had problems'
                        : 'Not imported'
                      : h.status}
                  </Badge>
                </Td>
                <Td>
                  {h.status === 'applied' && (
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        if (await act.run(() => post(`/setup-imports/${h.id}/undo`, {})))
                          void history.reload();
                      }}
                    >
                      Undo
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
