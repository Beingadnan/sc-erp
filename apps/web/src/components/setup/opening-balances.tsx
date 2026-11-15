'use client';

import { useRef, useState } from 'react';
import { post, upload } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { inr } from '@/components/fees/money';
import { Alert, Badge, Button, Card, Table, Td } from '@/components/ui';

interface Preview {
  id: string;
  summary: { yearName: string; students: number; dues: number; advance: number };
  problems: Array<{ row: number; message: string }>;
  problemCount: number;
  rows: Array<{
    row: number;
    admissionNumber: string;
    name: string;
    className: string;
    dues: number;
    advance: number;
    note: string;
  }>;
}
interface History {
  items: Array<{
    id: string;
    status: 'previewed' | 'applied' | 'undone' | 'cancelled';
    fileName: string;
    summary: { students?: number; dues?: number; advance?: number };
    problemCount: number;
    createdAt: string;
    byName: string | null;
  }>;
}

/** Step 3 of "Import old data": previous dues and advance per student. */
export function OpeningBalancesButtons({
  campusId,
  onPreview,
}: {
  campusId: string;
  onPreview: (p: Preview) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const act = useAction();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <a href="/api/v1/opening-balances/template">
          <Button variant="secondary" type="button">
            Download template
          </Button>
        </a>
        <input
          ref={ref}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const form = new FormData();
            form.set('file', f);
            const r = await act.run(() =>
              upload<Preview>(`/opening-balances?campusId=${campusId}`, form),
            );
            if (r) onPreview(r);
            e.target.value = '';
          }}
        />
        <Button loading={act.pending} onClick={() => ref.current?.click()}>
          Upload balances
        </Button>
      </div>
      {act.error && <Alert>{act.error.message}</Alert>}
    </div>
  );
}

export function OpeningBalancesPanel({
  campusId,
  preview,
  onDone,
}: {
  campusId: string;
  preview: Preview | null;
  onDone: () => void;
}) {
  const history = useApi<History>(`/opening-balances?campusId=${campusId}`);
  const act = useAction();
  const [done, setDone] = useState<string | null>(null);
  const p = preview;

  return (
    <>
      {p && !done && (
        <Card
          className="mt-6"
          title={
            p.problemCount
              ? `Old fee balances: ${p.problemCount} problem${p.problemCount > 1 ? 's' : ''} to fix`
              : 'Old fee balances: ready to import'
          }
          description={
            p.problemCount
              ? 'Fix these rows and upload the file again. Nothing has been saved.'
              : `${p.summary.students} students · previous dues ${inr(p.summary.dues)} · advance ${inr(p.summary.advance)} · year ${p.summary.yearName}. Dues become a "Previous year dues" demand; advance can be used for fees or refunded.`
          }
        >
          {p.problemCount ? (
            <Table head={['Row', 'Problem']}>
              {p.problems.map((x, i) => (
                <tr key={i}>
                  <Td className="tabular-nums">{x.row}</Td>
                  <Td className="text-red-700">{x.message}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="max-h-80 overflow-y-auto">
                <Table head={['Adm. no.', 'Student', 'Previous dues', 'Advance']}>
                  {p.rows.map((x) => (
                    <tr key={x.admissionNumber}>
                      <Td>{x.admissionNumber}</Td>
                      <Td>
                        {x.name}
                        <div className="text-xs text-slate-500">{x.className}</div>
                      </Td>
                      <Td className="tabular-nums">{x.dues ? inr(x.dues) : '—'}</Td>
                      <Td className="tabular-nums">{x.advance ? inr(x.advance) : '—'}</Td>
                    </tr>
                  ))}
                </Table>
              </div>
              {act.error && <Alert>{act.error.message}</Alert>}
              <div className="flex gap-2">
                <Button
                  loading={act.pending}
                  onClick={async () => {
                    const r = await act.run(() =>
                      post<{ demands: number; advances: number }>(
                        `/opening-balances/${p.id}/apply`,
                        {},
                      ),
                    );
                    if (r) {
                      setDone(
                        `Added previous dues for ${r.demands} and advance for ${r.advances} students.`,
                      );
                      void history.reload();
                    }
                  }}
                >
                  Import balances
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await act.run(() => post(`/opening-balances/${p.id}/cancel`, {}));
                    onDone();
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
      {done && (
        <div className="mt-6">
          <Alert tone="success">{done}</Alert>
        </div>
      )}
      {!!history.data?.items.length && (
        <Card className="mt-6" title="Past fee balance imports">
          <Table head={['When', 'File', 'Amounts', 'Status', '']}>
            {history.data.items.map((h) => (
              <tr key={h.id}>
                <Td className="whitespace-nowrap">
                  {formatDate(h.createdAt)}
                  <div className="text-xs text-slate-500">{h.byName}</div>
                </Td>
                <Td>{h.fileName}</Td>
                <Td className="text-xs text-slate-600">
                  {h.summary.students ?? 0} students · dues {inr(h.summary.dues ?? 0)} · advance{' '}
                  {inr(h.summary.advance ?? 0)}
                </Td>
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
                        if (await act.run(() => post(`/opening-balances/${h.id}/undo`, {})))
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
          {act.error && !p && (
            <div className="mt-3">
              <Alert>{act.error.message}</Alert>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

export type OpeningPreview = Preview;
