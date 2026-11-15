import { z } from 'zod';
import { isoDateSchema } from './academic.js';

/* --------------------------------- money and rules --------------------------------- */

/** Paise → "₹1,23,456.50" (Indian digit grouping; paise shown only when not zero). */
export const formatInr = (paise: number, opts: { paise?: boolean } = {}) => {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  const tail = opts.paise || p ? `.${String(p).padStart(2, '0')}` : '';
  return `${neg ? '−' : ''}₹${grouped}${tail}`;
};

/** "1,234.50" or "1234.5" → paise; null when not a valid amount. */
export const parseRupees = (text: string): number | null => {
  const t = text.replace(/[₹,\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const [r, p = ''] = t.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
};

export interface LateFeeRule {
  kind: 'none' | 'fixed' | 'per_day';
  amount: number;
  graceDays: number;
  cap: number;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/**
 * Late fee owed on a demand as of a date. Fixed: once the grace period ends. Per day: for
 * each day after the grace period, up to the cap (0 = no cap).
 */
export const lateFeeDue = (rule: LateFeeRule, dueOn: string, asOf: string): number => {
  if (rule.kind === 'none' || rule.amount <= 0) return 0;
  const late = days(dueOn, asOf) - rule.graceDays;
  if (late <= 0) return 0;
  if (rule.kind === 'fixed') return rule.amount;
  const total = late * rule.amount;
  return rule.cap > 0 ? Math.min(total, rule.cap) : total;
};

export interface ConcessionRule {
  id: string;
  mode: 'percent' | 'fixed';
  /** Whole percent, or paise per installment. */
  value: number;
  /** Empty = all heads. */
  feeHeadIds: readonly string[];
}

/**
 * Splits concessions over the fee lines of one demand. Concessions apply one after another
 * on what is left; a fixed amount is spread over eligible lines in proportion to what is
 * left on each, so the total never exceeds the lines. Amounts are whole paise.
 */
export const applyConcessions = (
  lines: ReadonlyArray<{ key: string; feeHeadId: string; amount: number }>,
  concessions: readonly ConcessionRule[],
): Array<{ lineKey: string; concessionId: string; amount: number }> => {
  const left = new Map(lines.map((l) => [l.key, l.amount]));
  const out: Array<{ lineKey: string; concessionId: string; amount: number }> = [];
  for (const c of concessions) {
    const eligible = lines.filter(
      (l) =>
        (c.feeHeadIds.length === 0 || c.feeHeadIds.includes(l.feeHeadId)) && left.get(l.key)! > 0,
    );
    if (!eligible.length) continue;
    if (c.mode === 'percent') {
      for (const l of eligible) {
        const amount = Math.floor((left.get(l.key)! * c.value) / 100);
        if (amount > 0) {
          out.push({ lineKey: l.key, concessionId: c.id, amount });
          left.set(l.key, left.get(l.key)! - amount);
        }
      }
    } else {
      const pool = eligible.reduce((n, l) => n + left.get(l.key)!, 0);
      const total = Math.min(c.value, pool);
      let given = 0;
      eligible.forEach((l, i) => {
        const share =
          i === eligible.length - 1 ? total - given : Math.floor((total * left.get(l.key)!) / pool);
        const amount = Math.min(share, left.get(l.key)!);
        if (amount > 0) {
          out.push({ lineKey: l.key, concessionId: c.id, amount });
          left.set(l.key, left.get(l.key)! - amount);
          given += amount;
        }
      });
    }
  }
  return out;
};

/* ------------------------------------- schemas ------------------------------------- */

const paise = z.number().int().positive().max(10_000_000_000);
const name = z.string().trim().min(2).max(80);

export const FEE_CATEGORIES = [
  'tuition',
  'admission',
  'annual',
  'exam',
  'transport',
  'activity',
  'deposit',
  'other',
] as const;

export const feeHeadSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{0,15}$/, 'Use up to 16 letters, digits, - or _'),
  name,
  category: z.enum(FEE_CATEGORIES),
  gstRate: z
    .union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)])
    .default(0),
  refundable: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
export type FeeHeadInput = z.infer<typeof feeHeadSchema>;
export const feeHeadUpdateSchema = feeHeadSchema
  .omit({ code: true, category: true })
  .partial()
  .extend({ active: z.boolean().optional() });

export const lateFeeSchema = z
  .object({
    kind: z.enum(['none', 'fixed', 'per_day']),
    amount: z.number().int().min(0).max(100_000_00),
    graceDays: z.number().int().min(0).max(365).default(0),
    cap: z.number().int().min(0).max(1_000_000_00).default(0),
  })
  .refine((v) => v.kind === 'none' || v.amount > 0, {
    message: 'Enter the late fee',
    path: ['amount'],
  });

export const structureCreateSchema = z.object({
  campusId: z.uuid(),
  academicYearId: z.uuid(),
  name,
  kind: z.enum(['class', 'optional']),
  gradeLevelIds: z.array(z.uuid()).max(30).default([]),
  lateFee: lateFeeSchema.default({ kind: 'none', amount: 0, graceDays: 0, cap: 0 }),
});
export type StructureCreateInput = z.infer<typeof structureCreateSchema>;

export const structureUpdateSchema = z.object({
  name: name.optional(),
  gradeLevelIds: z.array(z.uuid()).max(30).optional(),
  lateFee: lateFeeSchema.optional(),
});

/** The whole installment plan, replaced at once while the structure is a draft. */
export const structurePlanSchema = z
  .object({
    installments: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(40),
          dueOn: isoDateSchema,
          items: z
            .array(z.object({ feeHeadId: z.uuid(), amount: paise }))
            .max(30)
            .refine(
              (i) => new Set(i.map((x) => x.feeHeadId)).size === i.length,
              'A fee head is listed twice',
            ),
        }),
      )
      .min(1)
      .max(24),
  })
  .refine((p) => p.installments.every((x, i, a) => i === 0 || a[i - 1]!.dueOn <= x.dueOn), {
    message: 'Installments must be in date order',
    path: ['installments'],
  })
  .refine(
    (p) => new Set(p.installments.map((x) => x.label.toLowerCase())).size === p.installments.length,
    {
      message: 'Installment names must differ',
      path: ['installments'],
    },
  );
export type StructurePlanInput = z.infer<typeof structurePlanSchema>;

export const structureStatusSchema = z.object({
  status: z.enum(['draft', 'published', 'archived']),
});

export const assignmentSchema = z.object({ studentId: z.uuid() });

export const CONCESSION_KINDS = [
  'sibling',
  'staff_ward',
  'scholarship',
  'rte',
  'merit',
  'other',
] as const;

export const concessionTypeSchema = z
  .object({
    name,
    kind: z.enum(CONCESSION_KINDS),
    mode: z.enum(['percent', 'fixed']),
    value: z.number().int().positive().max(10_000_000_00),
    feeHeadIds: z.array(z.uuid()).max(30).default([]),
  })
  .refine((v) => v.mode !== 'percent' || v.value <= 100, {
    message: 'At most 100%',
    path: ['value'],
  });
export type ConcessionTypeInput = z.infer<typeof concessionTypeSchema>;
export const concessionTypeUpdateSchema = z.object({
  name: name.optional(),
  feeHeadIds: z.array(z.uuid()).max(30).optional(),
  active: z.boolean().optional(),
});

export const studentConcessionSchema = z.object({
  studentId: z.uuid(),
  academicYearId: z.uuid(),
  concessionTypeId: z.uuid(),
  /** Overrides the type's value (e.g. a scholarship amount). Mode stays the type's. */
  value: z.number().int().positive().max(10_000_000_00).optional(),
  reason: z.string().trim().min(3).max(300),
});
export type StudentConcessionInput = z.infer<typeof studentConcessionSchema>;

export const decisionSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(300).default(''),
  })
  .refine((v) => v.status !== 'rejected' || v.note.length >= 3, {
    message: 'Add a short reason',
    path: ['note'],
  });

export const revokeSchema = z.object({ note: z.string().trim().min(3).max(300) });

export const generateDemandsSchema = z.object({
  structureId: z.uuid(),
  /** Omit for every installment. */
  installmentIds: z.array(z.uuid()).min(1).max(24).optional(),
  /** Omit for every eligible student; given ones are billed even if they joined after the due date. */
  studentIds: z.array(z.uuid()).min(1).max(2000).optional(),
});
export type GenerateDemandsInput = z.infer<typeof generateDemandsSchema>;

export const lateFeeRunSchema = z.object({ campusId: z.uuid(), asOf: isoDateSchema.optional() });

export const waiverSchema = z.object({
  lineId: z.uuid(),
  amount: paise,
  reason: z.string().trim().min(3).max(300),
});

export const cancelDemandSchema = z.object({ reason: z.string().trim().min(3).max(300) });

export const demandListQuerySchema = z.object({
  campusId: z.uuid(),
  academicYearId: z.uuid().optional(),
  structureId: z.uuid().optional(),
  installmentId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
  status: z.enum(['due', 'overdue', 'settled', 'cancelled']).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type DemandListQuery = z.infer<typeof demandListQuerySchema>;

export const concessionListQuerySchema = z.object({
  campusId: z.uuid(),
  status: z.enum(['pending', 'approved', 'rejected', 'revoked']).optional(),
});

/* ------------------------------------- payments (6b) ------------------------------------- */

export const COUNTER_MODES = ['cash', 'cheque', 'dd', 'upi', 'card', 'bank_transfer'] as const;
export type CounterMode = (typeof COUNTER_MODES)[number];

export const paymentSchema = z
  .object({
    studentId: z.uuid(),
    mode: z.enum(COUNTER_MODES),
    amount: paise,
    receivedOn: isoDateSchema.optional(),
    reference: z.string().trim().max(60).default(''),
    bankName: z.string().trim().max(80).default(''),
    instrumentDate: isoDateSchema.optional(),
    payerName: z.string().trim().max(120).default(''),
    note: z.string().trim().max(300).default(''),
    /** Omit to settle the oldest dues first. */
    allocations: z
      .array(z.object({ lineId: z.uuid(), amount: paise }))
      .max(200)
      .refine((a) => new Set(a.map((x) => x.lineId)).size === a.length, 'A fee is listed twice')
      .optional(),
    /** A fresh random key per attempt; repeating a key returns the first receipt. */
    idempotencyKey: z.string().trim().min(8).max(80),
  })
  .refine(
    (v) => !['cheque', 'dd'].includes(v.mode) || (v.reference && v.bankName && v.instrumentDate),
    {
      message: 'Enter the number, bank and date',
      path: ['reference'],
    },
  )
  .refine((v) => !['upi', 'card', 'bank_transfer'].includes(v.mode) || v.reference.length >= 4, {
    message: 'Enter the transaction reference',
    path: ['reference'],
  })
  .refine((v) => !v.allocations || v.allocations.reduce((n, a) => n + a.amount, 0) <= v.amount, {
    message: 'The fees chosen add up to more than the amount received',
    path: ['allocations'],
  });
export type PaymentInput = z.infer<typeof paymentSchema>;

export const cancelReceiptSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const clearChequeSchema = z.object({ clearedOn: isoDateSchema.optional() });
export const bounceChequeSchema = z.object({
  bouncedOn: isoDateSchema.optional(),
  reason: z.string().trim().min(3).max(200),
});

export const paymentListQuerySchema = z.object({
  campusId: z.uuid(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  mode: z.enum(COUNTER_MODES).optional(),
  status: z.enum(['cleared', 'pending', 'bounced', 'cancelled']).optional(),
  cashierId: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

export const dayCloseQuerySchema = z.object({ campusId: z.uuid(), date: isoDateSchema.optional() });
export const dayCloseSchema = z.object({
  campusId: z.uuid(),
  date: isoDateSchema,
  cashCounted: z.number().int().min(0).max(10_000_000_000),
  note: z.string().trim().max(300).default(''),
});

export const reportQuerySchema = z.object({
  campusId: z.uuid(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  academicYearId: z.uuid().optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** Indian financial year of a date: "2026-27" for 2026-04-01 … 2027-03-31. */
export const financialYear = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const start = Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const twoDigits = (n: number) =>
  n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
const threeDigits = (n: number) =>
  [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', n % 100 ? twoDigits(n % 100) : '']
    .filter(Boolean)
    .join(' ');

/** Paise → "Rupees Twelve Thousand Five Hundred and Fifty Paise Only" (lakh/crore system). */
export const rupeesInWords = (paise: number) => {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  const parts: string[] = [];
  let r = rupees;
  const crore = Math.floor(r / 1_00_00_000);
  r %= 1_00_00_000;
  const lakh = Math.floor(r / 1_00_000);
  r %= 1_00_000;
  const thousand = Math.floor(r / 1000);
  r %= 1000;
  if (crore) parts.push(`${crore >= 100 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (r) parts.push(threeDigits(r));
  const words = parts.join(' ') || 'Zero';
  return `Rupees ${words}${p ? ` and ${twoDigits(p)} Paise` : ''} Only`;
};

/* ------------------------------ pay-to-school (Phase 6c) ------------------------------ */

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

const optionalText = (max: number) => z.string().trim().max(max).default('');

/** The school's own bank / UPI details shown to parents. Changing them is privileged (MFA) and audited. */
export const paymentSettingsSchema = z
  .object({
    campusId: z.uuid(),
    enabled: z.boolean().default(true),
    payeeName: z.string().trim().min(2).max(120),
    upiId: z
      .string()
      .trim()
      .max(256)
      .default('')
      .refine((v) => v === '' || UPI_ID_RE.test(v), 'Enter a UPI ID like school@okhdfcbank'),
    bankAccountName: optionalText(120),
    bankAccountNumber: z
      .string()
      .trim()
      .default('')
      .transform((v) => v.replace(/\s+/g, ''))
      .refine((v) => v === '' || /^\d{6,18}$/.test(v), 'Account numbers are 6 to 18 digits'),
    ifsc: z
      .string()
      .trim()
      .default('')
      .transform((v) => v.toUpperCase())
      .refine((v) => v === '' || IFSC_RE.test(v), 'Enter an 11-character IFSC like HDFC0001234'),
    bankName: optionalText(80),
    branch: optionalText(80),
    instructions: optionalText(500),
  })
  .refine((v) => !!v.upiId || (!!v.bankAccountNumber && !!v.ifsc), {
    message: 'Add a UPI ID or a bank account with IFSC',
    path: ['upiId'],
  })
  .refine((v) => !v.bankAccountNumber || !!v.ifsc, { message: 'Enter the IFSC', path: ['ifsc'] });
export type PaymentSettingsInput = z.infer<typeof paymentSettingsSchema>;

export const paymentLinkSchema = z.object({
  studentId: z.uuid(),
  /** Omit to ask for everything due today. */
  amount: paise.min(100).optional(),
  expiresInDays: z.number().int().min(1).max(60).default(7),
  note: optionalText(200),
});
export type PaymentLinkInput = z.infer<typeof paymentLinkSchema>;

export const paymentLinkListQuerySchema = z.object({
  campusId: z.uuid(),
  studentId: z.uuid().optional(),
  status: z.enum(['open', 'paid', 'cancelled']).optional(),
});

/** UTR / UPI reference: upper-case, no spaces or dashes. */
export const normaliseUtr = (v: string) => v.replace(/[\s-]+/g, '').toUpperCase();

export const PROOF_MODES = ['upi', 'bank_transfer'] as const;
export const proofSubmitSchema = z.object({
  amount: z.coerce.number().int().min(100).max(10_000_000_000),
  mode: z.enum(PROOF_MODES),
  reference: z
    .string()
    .transform(normaliseUtr)
    .refine(
      (v) => /^[A-Z0-9]{6,30}$/.test(v),
      'Enter the UTR / transaction ID (6–30 letters or digits)',
    ),
  paidOn: isoDateSchema,
  payerName: z.string().trim().min(2).max(120),
  payerPhone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ''))
    .refine((v) => v === '' || /^(\+91)?[6-9]\d{9}$/.test(v), 'Enter a 10-digit mobile number')
    .default(''),
});
export type ProofSubmitInput = z.infer<typeof proofSubmitSchema>;

export const proofListQuerySchema = z.object({
  campusId: z.uuid(),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const proofApproveSchema = z.object({
  /** Staff may correct the amount actually seen in the bank statement. */
  amount: paise.optional(),
  note: optionalText(300),
});
export const proofRejectSchema = z.object({ note: z.string().trim().min(3).max(300) });

export const REFUND_SOURCES = ['advance', 'deposit'] as const;
export const REFUND_MODES = ['cash', 'cheque', 'bank_transfer', 'upi'] as const;
export const refundRequestSchema = z.object({
  studentId: z.uuid(),
  source: z.enum(REFUND_SOURCES),
  amount: paise,
  mode: z.enum(REFUND_MODES),
  reason: z.string().trim().min(3).max(300),
});
export type RefundRequestInput = z.infer<typeof refundRequestSchema>;

export const refundPaySchema = z
  .object({
    mode: z.enum(REFUND_MODES).optional(),
    reference: optionalText(60),
    paidOn: isoDateSchema.optional(),
    note: optionalText(300),
  })
  .refine((v) => !v.mode || v.mode === 'cash' || v.reference.length >= 4, {
    message: 'Enter the cheque number or transaction reference',
    path: ['reference'],
  });
export const refundRejectSchema = z.object({ note: z.string().trim().min(3).max(300) });
export const refundListQuerySchema = z.object({
  campusId: z.uuid(),
  status: z.enum(['requested', 'paid', 'rejected']).optional(),
  studentId: z.uuid().optional(),
});

/** upi://pay link that any UPI app (and its QR scanner) understands. */
export const upiPayUri = (o: {
  upiId: string;
  payeeName: string;
  amount?: number;
  note?: string;
}) => {
  const p = new URLSearchParams({ pa: o.upiId, pn: o.payeeName, cu: 'INR' });
  if (o.amount) p.set('am', (o.amount / 100).toFixed(2));
  if (o.note) p.set('tn', o.note.slice(0, 50));
  return `upi://pay?${p.toString().replace(/\+/g, '%20')}`;
};
