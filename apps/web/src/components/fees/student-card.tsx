'use client';

import Link from 'next/link';
import type { StudentFeeAccount } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { inr } from './money';
import { Badge, Card, Skeleton } from '@/components/ui';

/** Fee summary for the student's latest year; hidden for staff without fee rights. */
export function FeesCard({ studentId }: { studentId: string }) {
  const { can } = useSession();
  const allowed = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'].some(
    (p) => can(p),
  );
  const data = useApi<StudentFeeAccount>(allowed ? `/fees/students/${studentId}` : null);
  if (!allowed || data.error?.status === 404) return null;
  const d = data.data;
  return (
    <Card
      title="Fees"
      actions={
        <Link
          className="text-sm text-brand-700 hover:underline"
          href={`/students/${studentId}/fees`}
        >
          Open account
        </Link>
      }
    >
      {!d ? (
        <Skeleton rows={2} />
      ) : !d.invoices.length ? (
        <p className="text-sm text-slate-500">Nothing billed in {d.enrollment.yearName}.</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold tabular-nums">
              {inr(Math.max(d.totals.balance, 0))}
            </span>
            <span className="text-slate-500">outstanding</span>
            {d.totals.overdue > 0 && <Badge tone="red">{inr(d.totals.overdue)} overdue</Badge>}
          </p>
          <p className="text-slate-600">
            Billed {inr(d.totals.billed)}
            {d.totals.reduced > 0 && <> · concessions {inr(d.totals.reduced)}</>}
          </p>
        </div>
      )}
    </Card>
  );
}
