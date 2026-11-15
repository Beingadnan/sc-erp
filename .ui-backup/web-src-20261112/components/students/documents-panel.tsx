'use client';

import { useRef, useState } from 'react';
import { DOCUMENT_TYPES } from '@school-erp/validation';
import { del, post, upload } from '@/lib/api';
import type { DocumentItem } from '@/lib/api';
import { DOCUMENT_TYPE_LABELS, dateTime, fileSize } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Card, SelectField } from '@/components/ui';

/** Documents of a student or an application: list, open (5-minute link), upload, remove. */
export function DocumentsPanel({
  owner,
  canManage,
}: {
  owner: { studentId: string } | { applicationId: string };
  canManage: boolean;
}) {
  const path =
    'studentId' in owner
      ? `/students/${owner.studentId}/documents`
      : `/applications/${owner.applicationId}/documents`;
  const { data, loading, error, reload } = useApi<DocumentItem[]>(path);
  const action = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('birth_certificate');

  const open = async (d: DocumentItem) => {
    // Open the tab first (popup blockers), then point it at the short-lived link.
    const tab = window.open('about:blank', '_blank');
    const r = await action.run(() => post<{ url: string }>(`/documents/${d.id}/link`));
    if (r && tab) tab.location.href = r.url;
    else tab?.close();
  };

  return (
    <Card
      title="Documents"
      description="PDF, JPG, PNG or WebP, up to 5 MB. Opening a document is recorded."
    >
      <div className="space-y-4">
        {action.error && <Alert>{action.error.message}</Alert>}
        {loading && !data ? null : error ? (
          <Alert>{error.message}</Alert>
        ) : data?.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">
                    {DOCUMENT_TYPE_LABELS[d.docType] ?? d.docType}
                  </span>
                  {d.sensitive && (
                    <span className="ml-2">
                      <Badge tone="amber">Restricted</Badge>
                    </span>
                  )}
                  <span className="block text-xs text-slate-500">
                    {d.fileName} · {fileSize(d.sizeBytes)} · {dateTime(d.createdAt)}
                    {d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                  </span>
                </span>
                <span className="flex gap-1">
                  {d.canOpen && (
                    <Button variant="ghost" onClick={() => void open(d)}>
                      Open
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        if (
                          !confirm(
                            `Remove ${DOCUMENT_TYPE_LABELS[d.docType] ?? 'this document'}? The file will be deleted.`,
                          )
                        )
                          return;
                        if (await action.run(() => del(`/documents/${d.id}`))) void reload();
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No documents yet.</p>
        )}
        {canManage && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const file = fileRef.current?.files?.[0];
              if (!file) {
                action.setError(null);
                fileRef.current?.click();
                return;
              }
              const form = new FormData();
              form.set('docType', docType);
              form.set(
                'studentId' in owner ? 'studentId' : 'applicationId',
                'studentId' in owner ? owner.studentId : owner.applicationId,
              );
              form.set('file', file);
              if (await action.run(() => upload(`/documents`, form))) {
                if (fileRef.current) fileRef.current.value = '';
                void reload();
              }
            }}
          >
            <SelectField
              label="Type"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-56"
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </SelectField>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="doc-file" className="text-sm font-medium text-slate-800">
                File
              </label>
              <input
                id="doc-file"
                ref={fileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="text-sm"
              />
            </div>
            <Button type="submit" loading={action.pending}>
              Upload
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}
