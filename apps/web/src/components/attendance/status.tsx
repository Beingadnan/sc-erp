import type { AttendanceStatus, DayInfo } from '@/lib/api';

export const STATUS_ORDER: AttendanceStatus[] = ['present', 'absent', 'late', 'half_day', 'leave'];

export const STATUS_META: Record<
  AttendanceStatus,
  { label: string; short: string; on: string; cell: string }
> = {
  present: {
    label: 'Present',
    short: 'P',
    on: 'bg-emerald-600 text-white border-emerald-600',
    cell: 'text-emerald-700',
  },
  absent: {
    label: 'Absent',
    short: 'A',
    on: 'bg-red-600 text-white border-red-600',
    cell: 'bg-red-50 text-red-700 font-semibold',
  },
  late: {
    label: 'Late',
    short: 'L',
    on: 'bg-amber-500 text-white border-amber-500',
    cell: 'text-amber-700',
  },
  half_day: {
    label: 'Half day',
    short: '½',
    on: 'bg-sky-600 text-white border-sky-600',
    cell: 'text-sky-700',
  },
  leave: {
    label: 'Leave',
    short: 'Lv',
    on: 'bg-slate-600 text-white border-slate-600',
    cell: 'text-slate-500',
  },
};

export const dayReasonLabel = (d: DayInfo) =>
  d.reason === 'holiday'
    ? `Holiday — ${d.title ?? ''}`
    : d.reason === 'weekly_off'
      ? 'Weekly off'
      : d.reason === 'saturday_off'
        ? 'Saturday off'
        : d.reason === 'outside_year'
          ? 'Outside the academic year'
          : 'Working day';

export const percentTone = (p: number | null, threshold: number) =>
  p === null ? 'text-slate-400' : p < threshold ? 'text-red-700 font-semibold' : 'text-slate-800';

/** Today's date on this device in IST-style ISO (the API decides the campus date). */
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const shiftDate = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
