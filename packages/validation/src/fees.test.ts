import { describe, expect, it } from 'vitest';
import { normaliseUtr, paymentSettingsSchema, proofSubmitSchema, upiPayUri } from './fees.js';
import {
  applyConcessions,
  formatInr,
  lateFeeDue,
  parseRupees,
  structurePlanSchema,
} from './fees.js';

describe('money', () => {
  it('formats and parses rupees with Indian grouping', () => {
    expect(formatInr(12345678900)).toBe('₹12,34,56,789');
    expect(formatInr(150050)).toBe('₹1,500.50');
    expect(formatInr(99, { paise: true })).toBe('₹0.99');
    expect(formatInr(-500000)).toBe('−₹5,000');
    expect(parseRupees('1,500.5')).toBe(150050);
    expect(parseRupees('₹ 12000')).toBe(1200000);
    expect(parseRupees('12.345')).toBeNull();
    expect(parseRupees('-5')).toBeNull();
  });
});

describe('late fees', () => {
  it('applies grace days, fixed and per-day rules with a cap', () => {
    const fixed = { kind: 'fixed' as const, amount: 10000, graceDays: 10, cap: 0 };
    expect(lateFeeDue(fixed, '2026-04-10', '2026-04-20')).toBe(0);
    expect(lateFeeDue(fixed, '2026-04-10', '2026-04-21')).toBe(10000);
    const daily = { kind: 'per_day' as const, amount: 1000, graceDays: 5, cap: 20000 };
    expect(lateFeeDue(daily, '2026-04-10', '2026-04-18')).toBe(3000);
    expect(lateFeeDue(daily, '2026-04-10', '2026-07-01')).toBe(20000);
    expect(lateFeeDue({ ...daily, kind: 'none' }, '2026-04-10', '2026-07-01')).toBe(0);
  });
});

describe('concessions', () => {
  const lines = [
    { key: 'tuition', feeHeadId: 'T', amount: 1_000_000 },
    { key: 'transport', feeHeadId: 'B', amount: 333_333 },
  ];
  it('applies percent on eligible heads only, then fixed on what is left', () => {
    const r = applyConcessions(lines, [
      { id: 'sib', mode: 'percent', value: 10, feeHeadIds: ['T'] },
      { id: 'sch', mode: 'fixed', value: 500_000, feeHeadIds: [] },
    ]);
    expect(r.filter((x) => x.concessionId === 'sib')).toEqual([
      { lineKey: 'tuition', concessionId: 'sib', amount: 100_000 },
    ]);
    const fixed = r.filter((x) => x.concessionId === 'sch');
    expect(fixed.reduce((n, x) => n + x.amount, 0)).toBe(500_000);
  });
  it('never exceeds the lines', () => {
    const r = applyConcessions(lines, [
      { id: 'rte', mode: 'percent', value: 100, feeHeadIds: [] },
      { id: 'x', mode: 'fixed', value: 50_000, feeHeadIds: [] },
    ]);
    expect(r.reduce((n, x) => n + x.amount, 0)).toBe(1_333_333);
    expect(r.some((x) => x.concessionId === 'x')).toBe(false);
  });
});

describe('structure plans', () => {
  it('needs installments in date order without repeated heads', () => {
    const id = '01920000-0000-7000-8000-000000000001';
    const ok = {
      installments: [{ label: 'Q1', dueOn: '2026-04-10', items: [{ feeHeadId: id, amount: 100 }] }],
    };
    expect(structurePlanSchema.safeParse(ok).success).toBe(true);
    expect(
      structurePlanSchema.safeParse({
        installments: [
          { label: 'Q2', dueOn: '2026-07-10', items: [] },
          { label: 'Q1', dueOn: '2026-04-10', items: [] },
        ],
      }).success,
    ).toBe(false);
    expect(
      structurePlanSchema.safeParse({
        installments: [
          {
            label: 'Q1',
            dueOn: '2026-04-10',
            items: [
              { feeHeadId: id, amount: 1 },
              { feeHeadId: id, amount: 2 },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

import { financialYear, paymentSchema, rupeesInWords } from './fees.js';

describe('receipts', () => {
  it('writes amounts in Indian words', () => {
    expect(rupeesInWords(1250050)).toBe('Rupees Twelve Thousand Five Hundred and Fifty Paise Only');
    expect(rupeesInWords(1234567800)).toBe(
      'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only',
    );
    expect(rupeesInWords(100)).toBe('Rupees One Only');
  });
  it('works out the financial year', () => {
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2099-12-01')).toBe('2099-00');
  });
  it('needs instrument details for cheques and references for UPI', () => {
    const base = {
      studentId: '01920000-0000-7000-8000-000000000001',
      amount: 100,
      idempotencyKey: 'abcdefgh12',
    };
    expect(paymentSchema.safeParse({ ...base, mode: 'cash' }).success).toBe(true);
    expect(paymentSchema.safeParse({ ...base, mode: 'cheque', reference: '123456' }).success).toBe(
      false,
    );
    expect(paymentSchema.safeParse({ ...base, mode: 'upi' }).success).toBe(false);
    expect(
      paymentSchema.safeParse({
        ...base,
        mode: 'cash',
        allocations: [{ lineId: base.studentId, amount: 101 }],
      }).success,
    ).toBe(false);
  });
});

describe('pay to school', () => {
  it('builds a UPI link with the amount in rupees', () => {
    expect(upiPayUri({ upiId: 'school@okhdfc', payeeName: 'Sunrise School', amount: 150050 })).toBe(
      'upi://pay?pa=school%40okhdfc&pn=Sunrise%20School&cu=INR&am=1500.50',
    );
  });
  it('normalises UTRs', () => {
    expect(normaliseUtr(' 4123 5678-9012 ')).toBe('412356789012');
    expect(
      proofSubmitSchema.safeParse({
        amount: '100',
        mode: 'upi',
        reference: 'ab',
        paidOn: '2026-01-01',
        payerName: 'Ram',
      }).success,
    ).toBe(false);
  });
  it('checks IFSC and needs UPI or a bank account', () => {
    const base = { campusId: '0190a0b0-0000-7000-8000-000000000001', payeeName: 'School' };
    expect(paymentSettingsSchema.safeParse(base).success).toBe(false);
    expect(
      paymentSettingsSchema.safeParse({
        ...base,
        bankAccountNumber: '12345678',
        ifsc: 'sbin0001234',
      }).data?.ifsc,
    ).toBe('SBIN0001234');
    expect(
      paymentSettingsSchema.safeParse({ ...base, bankAccountNumber: '12345678', ifsc: 'SBIN1234' })
        .success,
    ).toBe(false);
  });
});

describe('payment settings with UPI only', () => {
  it('needs no bank fields', () => {
    const r = paymentSettingsSchema.safeParse({
      campusId: '0190a0b0-0000-7000-8000-000000000001',
      payeeName: 'School',
      upiId: 'school@okhdfcbank',
    });
    expect(r.success).toBe(true);
  });
});
