/** "2026-04-01" → "1 Apr 2026" (dates are calendar dates; no time-zone shifts). */
export const formatDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

export const formatRange = (a: string, b: string): string =>
  a === b ? formatDate(a) : `${formatDate(a)} – ${formatDate(b)}`;

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const STAGE_LABELS: Record<string, string> = {
  pre_primary: 'Pre-primary',
  primary: 'Primary',
  middle: 'Middle',
  secondary: 'Secondary',
  senior_secondary: 'Senior secondary',
};

export const blank = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export const RELATIONSHIP_LABELS: Record<string, string> = {
  father: 'Father',
  mother: 'Mother',
  guardian: 'Guardian',
  grandparent: 'Grandparent',
  sibling: 'Sibling',
  other: 'Other',
};

export const fullName = (s: { firstName: string; lastName: string }) =>
  `${s.firstName} ${s.lastName}`.trim();

/** Age in whole years on a date (default today). */
export const ageOn = (dob: string, on = new Date().toISOString().slice(0, 10)) => {
  const [y1, m1, d1] = dob.split('-').map(Number);
  const [y2, m2, d2] = on.split('-').map(Number);
  return y2! - y1! - (m2! < m1! || (m2 === m1 && d2! < d1!) ? 1 : 0);
};

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  assessment: 'Assessment',
  approved: 'Approved',
  waitlisted: 'Waitlisted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  admitted: 'Admitted',
};

export const APPLICATION_STATUS_TONES: Record<
  string,
  'neutral' | 'green' | 'amber' | 'red' | 'blue'
> = {
  submitted: 'blue',
  under_review: 'blue',
  assessment: 'amber',
  approved: 'green',
  waitlisted: 'amber',
  rejected: 'red',
  withdrawn: 'neutral',
  admitted: 'green',
};

export const SOURCE_LABELS: Record<string, string> = {
  website: 'Website',
  walk_in: 'Walk-in',
  phone: 'Phone',
  referral: 'Referral',
  other: 'Other',
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  birth_certificate: 'Birth certificate',
  transfer_certificate: 'Transfer certificate',
  report_card: 'Previous report card',
  photo: 'Photograph',
  address_proof: 'Address proof',
  aadhaar_card: 'Aadhaar card',
  caste_certificate: 'Caste certificate',
  medical: 'Medical record',
  other: 'Other',
};

export const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
