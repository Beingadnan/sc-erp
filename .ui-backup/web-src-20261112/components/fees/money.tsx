'use client';

import { useEffect, useState } from 'react';
import { formatInr, parseRupees } from '@school-erp/validation';
import type { AcademicYear, DemandState } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { Badge, Field, SelectField } from '@/components/ui';

export const inr = (paise: number) => formatInr(paise);

/** Rupee amount input that reports paise (null while the text is not a valid amount). */
export function RupeeField({
  label,
  value,
  onChange,
  error,
  hint,
  className,
  required,
}: {
  label: string;
  value: number | null;
  onChange: (paise: number | null) => void;
  error?: string;
  hint?: string;
  className?: string;
  required?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value / 100));
  useEffect(() => {
    // Follow outside changes (e.g. a reset) without fighting the user's typing.
    if (value === null && text !== '' && parseRupees(text) !== null) setText('');
    else if (value !== null && parseRupees(text) !== value) setText(String(value / 100));
  }, [value]);
  const bad = text.trim() !== '' && parseRupees(text) === null;
  return (
    <Field
      label={label}
      inputMode="decimal"
      required={required}
      value={text}
      placeholder="0"
      error={error ?? (bad ? 'Enter an amount like 1500 or 1500.50' : undefined)}
      hint={hint}
      className={className}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.trim() === '' ? null : parseRupees(e.target.value));
      }}
    />
  );
}

export const STATE_TONE: Record<DemandState, 'amber' | 'red' | 'green' | 'neutral'> = {
  due: 'amber',
  overdue: 'red',
  settled: 'green',
  cancelled: 'neutral',
};
export const STATE_LABEL: Record<DemandState, string> = {
  due: 'Due',
  overdue: 'Overdue',
  settled: 'Settled',
  cancelled: 'Cancelled',
};

export const DemandBadge = ({ state }: { state: DemandState }) => (
  <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>
);

/** Academic years of a campus, defaulting to the current one. */
export function useYear(campusId: string | null) {
  const years = useApi<AcademicYear[]>(campusId ? `/academic-years?campusId=${campusId}` : null);
  const [yearId, setYearId] = useState<string>('');
  useEffect(() => {
    if (!years.data?.length) return;
    if (!years.data.some((y) => y.id === yearId)) {
      setYearId((years.data.find((y) => y.isCurrent) ?? years.data[0]!).id);
    }
  }, [years.data, yearId]);
  const picker = (
    <SelectField
      label="Year"
      value={yearId}
      onChange={(e) => setYearId(e.target.value)}
      className="w-36"
    >
      {(years.data ?? []).map((y) => (
        <option key={y.id} value={y.id}>
          {y.name}
        </option>
      ))}
    </SelectField>
  );
  return { yearId: yearId || null, years: years.data ?? [], picker };
}

export const FEE_CATEGORY_LABEL: Record<string, string> = {
  tuition: 'Tuition',
  admission: 'Admission',
  annual: 'Annual',
  exam: 'Exam',
  transport: 'Transport',
  activity: 'Activity',
  deposit: 'Refundable deposit',
  other: 'Other',
  late_fee: 'Late fee',
};

export const CONCESSION_KIND_LABEL: Record<string, string> = {
  sibling: 'Sibling',
  staff_ward: 'Staff ward',
  scholarship: 'Scholarship',
  rte: 'RTE',
  merit: 'Merit',
  other: 'Other',
};

export const concessionValue = (mode: 'percent' | 'fixed', value: number) =>
  mode === 'percent' ? `${value}%` : `${inr(value)} per installment`;

export const MODE_LABEL: Record<string, string> = {
  cash: 'Cash',
  cheque: 'Cheque',
  dd: 'Demand draft',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  online: 'Online',
};

export const RECEIPT_TONE = {
  cleared: 'green',
  pending: 'amber',
  bounced: 'red',
  cancelled: 'neutral',
} as const;
export const RECEIPT_LABEL = {
  cleared: 'Received',
  pending: 'Cheque pending',
  bounced: 'Bounced',
  cancelled: 'Cancelled',
} as const;

export const receiptPdf = (id: string) => `/api/v1/fees/payments/${id}/receipt.pdf`;
