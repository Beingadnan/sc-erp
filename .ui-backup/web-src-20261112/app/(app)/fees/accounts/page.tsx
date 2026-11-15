'use client';

import type { TrialBalance } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { inr } from '@/components/fees/money';
import { Alert, Card, PageHeader, Skeleton, Table, Td } from '@/components/ui';

const TYPE_LABEL = { asset: 'Asset', liability: 'Liability', income: 'Income', expense: 'Expense' };

export default function AccountsPage() {
  const { campus, picker } = useCampus();
  const tb = useApi<TrialBalance>(campus ? `/fees/accounts?campusId=${campus.id}` : null);
  const t = tb.data;
  return (
    <>
      <PageHeader
        title="Fee accounts"
        description="Every fee, concession and late fee is posted here as balanced double entries. Balances are worked out from the entries; nothing is edited."
        actions={picker}
      />
      {tb.error && <Alert>{tb.error.message}</Alert>}
      {!t ? (
        <Skeleton rows={6} />
      ) : (
        <Card
          title="Trial balance"
          description={
            t.totals.debit === t.totals.credit
              ? 'Debits and credits agree.'
              : 'Debits and credits do not agree — contact support.'
          }
        >
          <Table head={['Code', 'Account', 'Type', 'Debits', 'Credits', 'Balance']}>
            {t.accounts.map((a) => (
              <tr key={a.id} className={a.debit || a.credit ? '' : 'text-slate-400'}>
                <Td className="font-mono text-xs">{a.code}</Td>
                <Td>{a.name}</Td>
                <Td>{TYPE_LABEL[a.type]}</Td>
                <Td className="tabular-nums">{inr(a.debit)}</Td>
                <Td className="tabular-nums">{inr(a.credit)}</Td>
                <Td className="font-medium tabular-nums">
                  {a.balance === 0
                    ? '—'
                    : a.balance > 0
                      ? `${inr(a.balance)} Dr`
                      : `${inr(-a.balance)} Cr`}
                </Td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 font-semibold">
              <Td>{''}</Td>
              <Td>Total</Td>
              <Td>{''}</Td>
              <Td className="tabular-nums">{inr(t.totals.debit)}</Td>
              <Td className="tabular-nums">{inr(t.totals.credit)}</Td>
              <Td>{''}</Td>
            </tr>
          </Table>
        </Card>
      )}
    </>
  );
}
