/**
 * Working-day calculation. Pure functions on ISO dates (no time zones involved: a school
 * date is a calendar date at the campus).
 */

export interface YearRules {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  weeklyOffDays: number[];
  saturdayOffWeeks: number[];
}

export interface OffEvent {
  title: string;
  kind: string;
  startsOn: string;
  endsOn: string;
}

export type DayReason = 'working' | 'weekly_off' | 'saturday_off' | 'holiday' | 'outside_year';

export interface DayInfo {
  date: string;
  working: boolean;
  reason: DayReason;
  /** Holiday/vacation title when reason = holiday. */
  title?: string;
}

const DAY_MS = 86_400_000;
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);

export const NON_WORKING_KINDS = new Set(['holiday', 'vacation']);

export function* eachDate(from: string, to: string): Generator<string> {
  for (let t = toTime(from); t <= toTime(to); t += DAY_MS) yield toIso(t);
}

export const describeDay = (date: string, years: YearRules[], events: OffEvent[]): DayInfo => {
  const year = years.find((y) => y.startsOn <= date && date <= y.endsOn);
  if (!year) return { date, working: false, reason: 'outside_year' };
  const holiday = events.find(
    (e) => NON_WORKING_KINDS.has(e.kind) && e.startsOn <= date && date <= e.endsOn,
  );
  if (holiday) return { date, working: false, reason: 'holiday', title: holiday.title };
  const d = new Date(toTime(date));
  const weekday = d.getUTCDay();
  if (year.weeklyOffDays.includes(weekday)) return { date, working: false, reason: 'weekly_off' };
  if (weekday === 6 && year.saturdayOffWeeks.includes(Math.ceil(d.getUTCDate() / 7))) {
    return { date, working: false, reason: 'saturday_off' };
  }
  return { date, working: true, reason: 'working' };
};

export const describeRange = (
  from: string,
  to: string,
  years: YearRules[],
  events: OffEvent[],
): { workingDays: number; days: DayInfo[] } => {
  const days = [...eachDate(from, to)].map((d) => describeDay(d, years, events));
  return { workingDays: days.filter((d) => d.working).length, days };
};

/** True when [aStart, aEnd] and [bStart, bEnd] share at least one day. */
export const rangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  aStart <= bEnd && bStart <= aEnd;
