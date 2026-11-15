import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from '@school-erp/db';
import { schema } from '@school-erp/db';

const acc = schema.ledgerAccounts;
const heads = schema.feeHeads;
const jr = schema.ledgerJournals;
const le = schema.ledgerEntries;

/** Accounts the system posts to, created per school on first use. */
export const SYSTEM_ACCOUNTS = [
  { key: 'cash', code: '1000', name: 'Cash in hand', type: 'asset' },
  { key: 'bank', code: '1010', name: 'Bank', type: 'asset' },
  { key: 'gateway', code: '1020', name: 'Online payments in transit', type: 'asset' },
  { key: 'cheques', code: '1030', name: 'Cheques and DDs awaiting clearance', type: 'asset' },
  { key: 'receivable', code: '1100', name: 'Fees receivable from students', type: 'asset' },
  { key: 'advance', code: '2100', name: 'Fees received in advance', type: 'liability' },
  /** Balances brought in from the school's old records (previous dues, old advances). */
  { key: 'opening', code: '3900', name: 'Opening balances (old records)', type: 'liability' },
  { key: 'late_fee_income', code: '4900', name: 'Late fee income', type: 'income' },
  { key: 'concessions', code: '5100', name: 'Concessions and waivers', type: 'expense' },
] as const;
export type SystemAccount = (typeof SYSTEM_ACCOUNTS)[number]['key'];

export interface FeeBooks {
  accounts: Record<SystemAccount, string>;
  lateFeeHeadId: string;
}

/** Creates the chart of accounts and the late fee head the first time fees are used. */
export async function ensureFeeBooks(tx: Transaction, tenantId: string): Promise<FeeBooks> {
  const existing = await loadBooks(tx);
  // Accounts added in later versions are created for schools set up before them.
  if (existing && SYSTEM_ACCOUNTS.every((a) => existing.accounts[a.key])) return existing;
  await tx
    .insert(acc)
    .values(
      SYSTEM_ACCOUNTS.map((a) => ({
        tenantId,
        code: a.code,
        name: a.name,
        type: a.type,
        systemKey: a.key,
      })),
    )
    .onConflictDoNothing();
  const accounts = await systemAccounts(tx);
  await tx
    .insert(heads)
    .values({
      tenantId,
      code: 'LATE',
      name: 'Late fee',
      category: 'late_fee',
      incomeAccountId: accounts.late_fee_income,
      system: true,
      sortOrder: 999,
    })
    .onConflictDoNothing();
  return (await loadBooks(tx))!;
}

/** The books if already set up (usable in read-only transactions). */
export async function loadBooks(tx: Transaction): Promise<FeeBooks | null> {
  const [late] = await tx
    .select({ id: heads.id })
    .from(heads)
    .where(and(eq(heads.system, true), eq(heads.category, 'late_fee')));
  if (!late) return null;
  return { accounts: await systemAccounts(tx), lateFeeHeadId: late.id };
}

async function systemAccounts(tx: Transaction) {
  const rows = await tx
    .select({ id: acc.id, key: acc.systemKey })
    .from(acc)
    .where(sql`${acc.systemKey} is not null`);
  return Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<SystemAccount, string>;
}

/** Next free account code in a range, for fee-head income accounts. */
export async function createIncomeAccount(
  tx: Transaction,
  tenantId: string,
  name: string,
  liability: boolean,
): Promise<string> {
  const base = liability ? 2300 : 4000;
  const [{ next }] = (
    await tx.execute(sql`
    select coalesce(max(code::int), ${base}) + 1 as next from ledger_accounts
    where tenant_id = ${tenantId} and code ~ '^[0-9]+$' and code::int between ${base + 1} and ${base + 99}`)
  ).rows as [{ next: number }];
  if (next > base + 99) throw new Error('No free account codes');
  const [row] = await tx
    .insert(acc)
    .values({
      tenantId,
      code: String(next),
      name: liability ? `${name} (refundable)` : `${name} income`,
      type: liability ? 'liability' : 'income',
    })
    .returning({ id: acc.id });
  return row!.id;
}

export interface EntryInput {
  accountId: string;
  studentId?: string | null;
  debit?: number;
  credit?: number;
}

export interface JournalInput {
  id?: string;
  campusId: string;
  postedOn: string;
  sourceType: string;
  sourceId: string;
  memo?: string;
  reversesId?: string | null;
  entries: EntryInput[];
}

/** Fresh UUIDv7 ids from the database, for linking rows inserted in bulk. */
export async function newIds(tx: Transaction, n: number): Promise<string[]> {
  if (n <= 0) return [];
  const res = await tx.execute(sql`select app.uuid_v7()::text as id from generate_series(1, ${n})`);
  return (res.rows as Array<{ id: string }>).map((r) => r.id);
}

const CHUNK = 2000;
const chunks = <T>(a: T[]) =>
  Array.from({ length: Math.ceil(a.length / CHUNK) }, (_, i) =>
    a.slice(i * CHUNK, (i + 1) * CHUNK),
  );

/**
 * Posts journals in two statements however many there are. Each journal must balance;
 * the database checks this again when the transaction commits.
 */
export async function postJournals(
  tx: Transaction,
  ctx: { tenantId: string; userId: string },
  journals: JournalInput[],
): Promise<string[]> {
  if (!journals.length) return [];
  const missing = journals.filter((j) => !j.id).length;
  const fresh = (await newIds(tx, missing)).sort();
  // Ids are time-ordered; hand them out in posting order so statements read naturally.
  const ids = journals.map((j) => j.id ?? fresh.shift()!);
  const entries: Array<typeof le.$inferInsert> = [];
  journals.forEach((j, i) => {
    let d = 0;
    let c = 0;
    for (const e of j.entries) {
      const debit = e.debit ?? 0;
      const credit = e.credit ?? 0;
      if (debit === 0 && credit === 0) continue;
      d += debit;
      c += credit;
      entries.push({
        tenantId: ctx.tenantId,
        journalId: ids[i]!,
        accountId: e.accountId,
        studentId: e.studentId ?? null,
        debit,
        credit,
      });
    }
    if (d !== c || d === 0) throw new Error(`Unbalanced journal for ${j.sourceType} ${j.sourceId}`);
  });
  for (const part of chunks(journals.map((j, i) => ({ j, id: ids[i]! })))) {
    await tx.insert(jr).values(
      part.map(({ j, id }) => ({
        id,
        tenantId: ctx.tenantId,
        campusId: j.campusId,
        postedOn: j.postedOn,
        sourceType: j.sourceType,
        sourceId: j.sourceId,
        memo: j.memo ?? '',
        reversesId: j.reversesId ?? null,
        createdBy: ctx.userId,
      })),
    );
  }
  for (const part of chunks(entries)) await tx.insert(le).values(part);
  return ids;
}

/**
 * Reverses journals not already reversed: a mirror journal with debits and credits swapped.
 * Returns how many were reversed.
 */
export async function reverseJournals(
  tx: Transaction,
  ctx: { tenantId: string; userId: string },
  journalIds: string[],
  postedOn: string,
  memo: string,
): Promise<number> {
  if (!journalIds.length) return 0;
  const reversed = await tx
    .select({ id: jr.reversesId })
    .from(jr)
    .where(inArray(jr.reversesId, journalIds));
  const done = new Set(reversed.map((r) => r.id));
  const todo = journalIds.filter((id) => !done.has(id));
  if (!todo.length) return 0;
  const originals = await tx.select().from(jr).where(inArray(jr.id, todo));
  const lines = await tx.select().from(le).where(inArray(le.journalId, todo));
  await postJournals(
    tx,
    ctx,
    originals.map((o) => ({
      campusId: o.campusId,
      postedOn,
      sourceType: o.sourceType,
      sourceId: o.sourceId,
      memo,
      reversesId: o.id,
      entries: lines
        .filter((l) => l.journalId === o.id)
        .map((l) => ({
          accountId: l.accountId,
          studentId: l.studentId,
          debit: l.credit,
          credit: l.debit,
        })),
    })),
  );
  return todo.length;
}
