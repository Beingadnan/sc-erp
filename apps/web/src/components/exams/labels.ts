import type { ExamStatus, MarkStatus } from '@/lib/api';

export const EXAM_STATUS: Record<ExamStatus, { label: string; tone: 'amber' | 'blue' | 'green' }> =
  {
    draft: { label: 'Preparing', tone: 'amber' },
    open: { label: 'Marks entry', tone: 'blue' },
    published: { label: 'Results out', tone: 'green' },
  };

export const MARK_SHORT: Record<Exclude<MarkStatus, 'present'>, string> = {
  absent: 'AB',
  medical: 'ML',
  exempt: 'EX',
};

export const fmtMarks = (m: number | null) =>
  m === null ? '' : Number.isInteger(m) ? String(m) : m.toFixed(1);
