'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { AuditEntry } from '@/lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  Table,
  Td,
} from '@/components/ui';

const ENTITIES = ['', 'tenant', 'campus', 'membership', 'role'];

export default function AuditPage() {
  const [entity, setEntity] = useState('');
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (next: string | null, replace: boolean) => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ limit: '25' });
        if (entity) q.set('entity', entity);
        if (next) q.set('cursor', next);
        const page = await api<{ data: AuditEntry[]; nextCursor: string | null }>(
          `/audit-logs?${q}`,
        );
        setRows((r) => (replace ? page.data : [...r, ...page.data]));
        setCursor(page.nextCursor);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not load the audit log');
      } finally {
        setLoading(false);
      }
    },
    [entity],
  );

  useEffect(() => {
    void load(null, true);
  }, [load]);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change to settings, roles and staff access. Entries cannot be edited or deleted."
        actions={
          <select
            aria-label="Filter by type"
            className="ui-control w-48"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
          >
            {ENTITIES.map((e) => (
              <option key={e} value={e}>
                {e ? e[0]!.toUpperCase() + e.slice(1) : 'All changes'}
              </option>
            ))}
          </select>
        }
      />
      <Card>
        {error && <Alert>{error}</Alert>}
        {loading && !rows.length ? (
          <Skeleton rows={6} />
        ) : !rows.length ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <>
            <Table head={['When', 'Who', 'What', 'Details']}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-slate-600">
                    {new Date(r.createdAt).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </Td>
                  <Td>
                    {r.actorName ?? 'System'}{' '}
                    {r.actorType === 'platform' && <Badge tone="amber">Platform</Badge>}
                  </Td>
                  <Td className="font-mono text-xs">{r.action}</Td>
                  <Td>
                    {r.diff && (
                      <pre className="max-w-md overflow-x-auto whitespace-pre-wrap text-xs text-slate-600">
                        {JSON.stringify(r.diff, null, 1)}
                      </pre>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            {cursor && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  loading={loading}
                  onClick={() => void load(cursor, false)}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
