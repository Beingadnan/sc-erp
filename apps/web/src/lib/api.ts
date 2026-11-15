'use client';

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
  details?: { fields?: Record<string, string>; reason?: string; [k: string]: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }

  get fields(): Record<string, string> {
    return this.body.details?.fields ?? {};
  }
}

const readCookie = (name: string): string => {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
};

/** The CSRF cookie is "__Host-csrf" in production and "csrf" in development. */
const csrfToken = (): string => readCookie('__Host-csrf') || readCookie('csrf');

/**
 * Calls the API through the same origin (Next rewrites /api → API server).
 * Sends the CSRF token on every state-changing request.
 */
export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken() } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json.error ?? { code: 'INTERNAL', message: 'Something went wrong' },
    );
  }
  return json as T;
}

export const post = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body });
export const put = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body });
export const del = <T = unknown>(path: string) => api<T>(path, { method: 'DELETE' });

// ---- shared response types -------------------------------------------------------

export interface Me {
  user: {
    id: string;
    email: string | null;
    loginPhone: string | null;
    fullName: string;
    emailVerified: boolean;
    mfaEnabled: boolean;
  };
  activeTenantId: string | null;
  tenants: Array<{
    id: string;
    slug: string;
    name: string;
    tenantStatus: string;
    membershipStatus: string;
  }>;
  platformRole: string | null;
  mfaEnforced: boolean;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  defaultTimezone: string;
  permissions: string[];
  /** permission → campus ids it is limited to; null = every campus. */
  permissionScopes: Record<string, string[] | null>;
}

export interface Campus {
  id: string;
  code: string;
  name: string;
  board: string;
  udiseCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  status: 'active' | 'archived';
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  assignmentCount: number;
}

export interface Member {
  id: string;
  userId: string;
  status: 'invited' | 'active' | 'suspended';
  email: string | null;
  loginPhone: string | null;
  designation: string | null;
  employeeCode: string | null;
  fullName: string;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  assignments: Array<{
    roleId: string;
    roleName: string;
    roleKey: string;
    campusId: string | null;
  }>;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorName: string | null;
  actorType: string;
  diff: Record<string, unknown> | null;
  createdAt: string;
}

export interface Permission {
  key: string;
  module: string;
  description: string;
}

/* ------------------------------- Phase 3: school structure ------------------------------- */

export interface AcademicYear {
  id: string;
  campusId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
  status: 'planned' | 'active' | 'closed';
  weeklyOffDays: number[];
  saturdayOffWeeks: number[];
}

export interface Term {
  id: string;
  academicYearId: string;
  name: string;
  startsOn: string;
  endsOn: string;
}

export type Stage = 'pre_primary' | 'primary' | 'middle' | 'secondary' | 'senior_secondary';

export interface GradeLevel {
  id: string;
  campusId: string;
  code: string;
  name: string;
  stage: Stage;
  sortOrder: number;
  gradingScaleId: string | null;
  status: 'active' | 'archived';
}

export interface Section {
  id: string;
  campusId: string;
  academicYearId: string;
  gradeLevelId: string;
  name: string;
  capacity: number | null;
  room: string | null;
  classTeacherMembershipId: string | null;
  classTeacherName: string | null;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  kind: 'scholastic' | 'co_scholastic';
  status: 'active' | 'archived';
}

export interface ClassSubject {
  subjectId: string;
  code: string;
  name: string;
  kind: Subject['kind'];
  isOptional: boolean;
}

export interface GradingBand {
  label: string;
  minPercent: number;
  maxPercent: number;
  gradePoint: number | null;
  remark: string;
}

export interface GradingScale {
  id: string;
  name: string;
  description: string;
  bands: GradingBand[];
}

export type CalendarKind = 'holiday' | 'vacation' | 'event' | 'exam';

export interface CalendarEntry {
  id: string;
  campusId: string | null;
  title: string;
  kind: CalendarKind;
  startsOn: string;
  endsOn: string;
  description: string;
}

export interface WorkingDays {
  workingDays: number;
  days: Array<{
    date: string;
    working: boolean;
    reason: 'working' | 'weekly_off' | 'saturday_off' | 'holiday' | 'outside_year';
    title?: string;
  }>;
}

/* --------------------------------- Phase 3b: website ---------------------------------- */

export interface CmsPageSummary {
  id: string;
  slug: string;
  title: string;
  showInNav: boolean;
  sortOrder: number;
  updatedAt: string;
  latestVersion: number;
  publishedVersion: number | null;
  hasDraftChanges: boolean;
}

export interface CmsPageDetail {
  id: string;
  slug: string;
  title: string;
  body: string;
  showInNav: boolean;
  sortOrder: number;
  latestVersion: number;
  publishedVersion: number | null;
  versions: Array<{
    id: string;
    version: number;
    title: string;
    createdAt: string;
    createdByName: string | null;
  }>;
}

export interface Inquiry {
  id: string;
  campusId: string | null;
  parentName: string;
  phone: string;
  email: string | null;
  studentName: string | null;
  classSought: string | null;
  message: string;
  source: 'website' | 'walk_in' | 'phone' | 'referral' | 'other';
  status: 'new' | 'contacted' | 'closed';
  createdAt: string;
}

/* --------------------------------- Phase 4a: students --------------------------------- */

export interface StudentListItem {
  id: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  gender: 'male' | 'female' | 'other';
  dateOfBirth: string;
  status: 'active' | 'withdrawn' | 'alumni';
  campusId: string;
  enrollmentId: string | null;
  enrollmentStatus: string | null;
  rollNumber: number | null;
  sectionId: string | null;
  sectionName: string | null;
  className: string | null;
  yearName: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
}

export interface StudentGuardian {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  occupation: string | null;
  relationship: string;
  isPrimary: boolean;
  isFeePayer: boolean;
}

export interface StudentDetail {
  id: string;
  campusId: string;
  admissionNumber: string;
  admissionDate: string;
  firstName: string;
  lastName: string;
  nameLocal: string | null;
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other';
  bloodGroup: string | null;
  address: string | null;
  pen: string | null;
  apaarId: string | null;
  aadhaarMasked: string | null;
  status: 'active' | 'withdrawn' | 'alumni';
  customFields: Record<string, string | number>;
  guardians: StudentGuardian[];
  enrollments: Array<{
    id: string;
    academicYearId: string;
    yearName: string;
    yearStatus: string;
    sectionId: string;
    sectionName: string;
    gradeLevelId: string;
    className: string;
    rollNumber: number | null;
    status: string;
    enrolledOn: string;
    leftOn: string | null;
  }>;
  acknowledgements: Array<{
    id: string;
    guardianId: string;
    noticeVersion: string;
    channel: string;
    acknowledgedAt: string;
  }>;
  permissions: { manage: boolean; viewSensitive: boolean };
}

export interface GuardianMatch {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  children: Array<{ id: string; name: string; admissionNumber: string }>;
}

export interface AdmissionNumberSettings {
  pattern: string;
  perCampus: boolean;
  yearlyReset: boolean;
  next: string | null;
}

/** multipart/form-data upload (documents). */
export async function upload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken() },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json.error ??
        (res.status === 413
          ? { code: 'VALIDATION_FAILED', message: 'Files can be at most 5 MB' }
          : { code: 'INTERNAL', message: 'Upload failed' }),
    );
  }
  return json as T;
}

/* ------------------------- Phase 4b: applications and documents ------------------------- */

export type ApplicationStatus =
  | 'submitted'
  | 'under_review'
  | 'assessment'
  | 'approved'
  | 'waitlisted'
  | 'rejected'
  | 'withdrawn'
  | 'admitted';

export interface ApplicationListItem {
  id: string;
  applicationNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  className: string;
  yearName: string;
  campusId: string;
  guardianName: string;
  guardianPhone: string;
  source: string;
  status: ApplicationStatus;
  assessmentAt: string | null;
  studentId: string | null;
  createdAt: string;
}

export interface ApplicationDetail extends Omit<ApplicationListItem, 'className' | 'yearName'> {
  academicYearId: string;
  gradeLevelId: string;
  inquiryId: string | null;
  gender: 'male' | 'female' | 'other';
  previousSchool: string | null;
  guardianEmail: string | null;
  guardianRelationship: string;
  notes: string;
  className: string;
  yearName: string;
  yearStatus: string;
  admissionNumber: string | null;
  events: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string;
    actorName: string | null;
    createdAt: string;
  }>;
  nextStatuses: ApplicationStatus[];
  permissions: { manage: boolean; admit: boolean };
}

export interface ApplicationSummary {
  byStatus: Partial<Record<ApplicationStatus, number>>;
  bySource: Record<string, number>;
  byClass: Array<{
    gradeLevelId: string;
    className: string;
    total: number;
    admitted: number;
    pending: number;
  }>;
}

export interface DocumentItem {
  id: string;
  studentId: string | null;
  applicationId: string | null;
  docType: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedByName: string | null;
  sensitive: boolean;
  canOpen: boolean;
}

/* ------------------------------ Phase 4c: student records ------------------------------ */

export interface CustomFieldDefinition {
  id: string;
  entity: 'student' | 'guardian';
  key: string;
  label: string;
  fieldType: 'text' | 'number' | 'date' | 'select';
  options: string[];
  required: boolean;
  sortOrder: number;
  archived: boolean;
}

export interface TransferCertificate {
  id: string;
  tcNumber: string;
  issuedOn: string;
  status: 'issued' | 'cancelled';
  cancelledReason: string | null;
  issuedByName: string | null;
}

export interface PromotionPreview {
  from: { sectionId: string; label: string; yearName: string; gradeLevelId: string };
  target: { id: string; name: string; status: string };
  students: Array<{
    enrollmentId: string;
    studentId: string;
    admissionNumber: string;
    firstName: string;
    lastName: string;
    rollNumber: number | null;
    alreadyInTarget: boolean;
  }>;
  sections: Array<{
    id: string;
    name: string;
    capacity: number | null;
    gradeLevelId: string;
    className: string;
    enrolled: number;
    isNextClass: boolean;
    isSameClass: boolean;
  }>;
  highestClass: boolean;
}

export interface ImportPreview {
  jobId: string;
  totalRows: number;
  validRows: number;
  problems: Array<{ row: number; field: string; message: string }>;
  sample: Array<{
    row: number;
    name: string;
    dateOfBirth: string;
    class: string;
    parent: string;
    admissionNumber: string;
  }>;
}

export interface ImportJob {
  id: string;
  status: 'previewed' | 'processing' | 'completed' | 'failed' | 'cancelled';
  fileName: string;
  totalRows: number;
  validRows: number;
  created: number;
  failed: number;
  report: Array<{
    row: number;
    status: 'created' | 'failed';
    admissionNumber?: string;
    message?: string;
  }>;
  createdAt: string;
  finishedAt: string | null;
}

/* ------------------------------------- attendance ------------------------------------- */

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'half_day' | 'leave';

export interface AttendanceSettings {
  mode: 'daily' | 'period';
  periodsPerDay: number;
  cutoffHours: number;
  lowThreshold: number;
  leaveCountsAs: 'absent' | 'excluded';
}

export interface DayInfo {
  date: string;
  working: boolean;
  reason: 'working' | 'weekly_off' | 'saturday_off' | 'holiday' | 'outside_year';
  title?: string;
}

export interface AttendanceRegister {
  section: {
    id: string;
    name: string;
    className: string;
    campusId: string;
    academicYearId: string;
  };
  date: string;
  period: number;
  day: DayInfo;
  settings: AttendanceSettings;
  session: { id: string; markedAt: string; markedBy: string | null; updatedAt: string } | null;
  locked: boolean;
  lockedAt: string;
  canEdit: boolean;
  needsReason: boolean;
  students: Array<{
    enrollmentId: string;
    studentId: string;
    rollNumber: number | null;
    name: string;
    admissionNumber: string;
    onLeave: boolean;
    status: AttendanceStatus;
    remark: string;
    marked: boolean;
  }>;
}

export interface AttendanceCorrection {
  id: string;
  studentName: string;
  fromStatus: AttendanceStatus;
  toStatus: AttendanceStatus;
  reason: string;
  correctedBy: string | null;
  createdAt: string;
}

export interface AttendanceToday {
  date: string;
  today: string;
  day: DayInfo;
  settings: AttendanceSettings;
  totals: {
    sections: number;
    marked: number;
    students: number;
    present: number;
    late: number;
    halfDay: number;
    absent: number;
    leave: number;
  };
  sections: Array<{
    sectionId: string;
    className: string;
    sectionName: string;
    students: number;
    isMine: boolean;
    marked: boolean;
    periodsMarked: number[];
    markedAt: string | null;
    markedBy: string | null;
    counts: {
      present: number;
      late: number;
      halfDay: number;
      absent: number;
      leave: number;
    } | null;
  }>;
}

export interface AttendanceMonth {
  section: { id: string; name: string; className: string; campusId: string };
  month: string;
  period: number;
  settings: AttendanceSettings;
  days: DayInfo[];
  markedDates: string[];
  students: Array<{
    enrollmentId: string;
    studentId: string;
    rollNumber: number | null;
    name: string;
    days: Record<string, AttendanceStatus>;
    present: number;
    halfDays: number;
    absent: number;
    leave: number;
    percent: number | null;
  }>;
}

export interface LowAttendance {
  threshold: number;
  students: Array<{
    studentId: string;
    enrollmentId: string;
    name: string;
    admissionNumber: string;
    rollNumber: number | null;
    sectionId: string;
    sectionName: string;
    className: string;
    days: number;
    absent: number;
    percent: number;
  }>;
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  className: string;
  sectionName: string;
  sectionId: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  requestedVia: 'office' | 'phone' | 'parent_app';
  status: LeaveStatus;
  decisionNote: string;
  decidedAt: string | null;
  createdAt: string;
  recordedBy: string | null;
  canDecide: boolean;
}

export interface StudentAttendanceSummary {
  enrollment: {
    id: string;
    academicYearId: string;
    yearName: string;
    className: string;
    sectionName: string;
    sectionId: string;
  };
  years: Array<{ academicYearId: string; yearName: string }>;
  settings: AttendanceSettings;
  totals: {
    days: number;
    present: number;
    late: number;
    halfDays: number;
    absent: number;
    leave: number;
    percent: number | null;
  };
  low: boolean;
  months: Array<{ month: string; days: number; absent: number; percent: number | null }>;
  recentAbsences: Array<{ date: string; status: string; remark: string }>;
  leaves: Array<{
    id: string;
    fromDate: string;
    toDate: string;
    days: number;
    reason: string;
    status: LeaveStatus;
  }>;
}

/* ---------------------------------------- fees ---------------------------------------- */

export interface FeeHead {
  id: string;
  code: string;
  name: string;
  category: string;
  gstRate: number;
  refundable: boolean;
  system: boolean;
  active: boolean;
  sortOrder: number;
}

export interface LateFeeRule {
  kind: 'none' | 'fixed' | 'per_day';
  amount: number;
  graceDays: number;
  cap: number;
}

export interface FeeStructureSummary {
  id: string;
  name: string;
  kind: 'class' | 'optional';
  status: 'draft' | 'published' | 'archived';
  academicYearId: string;
  yearName: string;
  total: number;
  installments: number;
  classes: string[];
  assigned: number;
  demands: number;
}

export interface FeeStructure {
  id: string;
  campusId: string;
  academicYearId: string;
  name: string;
  kind: 'class' | 'optional';
  status: 'draft' | 'published' | 'archived';
  lateFee: LateFeeRule;
  classes: Array<{ id: string; name: string }>;
  installments: Array<{
    id: string;
    seq: number;
    label: string;
    dueOn: string;
    total: number;
    items: Array<{ feeHeadId: string; amount: number }>;
  }>;
  total: number;
  demands: number;
  canEdit: boolean;
}

export interface StructureDemands {
  eligible: number;
  installments: Array<{
    id: string;
    label: string;
    dueOn: string;
    raised: number;
    billed: number;
    reduced: number;
    balance: number;
  }>;
}

export type DemandState = 'due' | 'overdue' | 'settled' | 'cancelled';

export interface DemandList {
  page: number;
  pageSize: number;
  total: number;
  totals: { billed: number; reduced: number; paid: number; balance: number };
  today: string;
  data: Array<{
    id: string;
    studentId: string;
    studentName: string;
    admissionNumber: string;
    className: string;
    sectionName: string;
    structureName: string;
    installmentLabel: string;
    dueOn: string;
    billed: number;
    reduced: number;
    balance: number;
    status: DemandState;
  }>;
}

export interface ConcessionType {
  id: string;
  name: string;
  kind: string;
  mode: 'percent' | 'fixed';
  value: number;
  feeHeadIds: string[];
  active: boolean;
}

export interface StudentConcessionRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  className: string;
  sectionName: string;
  yearName: string;
  typeName: string;
  kind: string;
  mode: 'percent' | 'fixed';
  value: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  decisionNote: string;
  createdAt: string;
  decidedAt: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  canDecide: boolean;
}

export interface StudentFeeAccount {
  enrollment: {
    id: string;
    campusId: string;
    academicYearId: string;
    yearName: string;
    status: string;
    className: string;
    sectionName: string;
  };
  years: Array<{ academicYearId: string; yearName: string }>;
  today: string;
  totals: {
    billed: number;
    reduced: number;
    paid: number;
    balance: number;
    overdue: number;
    advance: number;
  };
  payments: Array<{
    id: string;
    receiptNumber: string;
    receivedOn: string;
    mode: string;
    amount: number;
    allocated: number;
    reference: string;
    status: PaymentStatus;
    cancelReason: string | null;
  }>;
  invoices: Array<{
    id: string;
    status: 'active' | 'cancelled';
    state: DemandState;
    paid: number;
    chequePending: boolean;
    dueOn: string;
    structureName: string;
    installmentLabel: string;
    cancelReason: string | null;
    billed: number;
    reduced: number;
    balance: number;
    lines: Array<{
      id: string;
      headName: string;
      kind: 'fee' | 'late_fee';
      amount: number;
      reduced: number;
      pending: number;
      paid: number;
    }>;
    adjustments: Array<{
      id: string;
      lineId: string;
      kind: 'concession' | 'waiver';
      amount: number;
      reason: string;
      status: 'pending' | 'approved' | 'rejected' | 'reversed';
      decisionNote: string;
      createdAt: string;
    }>;
  }>;
  concessions: Array<{
    id: string;
    typeName: string;
    kind: string;
    mode: 'percent' | 'fixed';
    value: number;
    reason: string;
    status: 'pending' | 'approved' | 'rejected' | 'revoked';
    decisionNote: string;
    createdAt: string;
  }>;
  optional: Array<{ structureId: string; name: string; assignmentId: string | null }>;
  statement: Array<{
    date: string;
    memo: string;
    sourceType: string;
    reversal: boolean;
    debit: number;
    credit: number;
    balance: number;
  }>;
  can: {
    collect: boolean;
    cancelReceipt: boolean;
    configure: boolean;
    approve: boolean;
    waive: boolean;
  };
}

export interface TrialBalance {
  accounts: Array<{
    id: string;
    code: string;
    name: string;
    type: 'asset' | 'liability' | 'income' | 'expense';
    systemKey: string | null;
    debit: number;
    credit: number;
    balance: number;
  }>;
  totals: { debit: number; credit: number };
}

export type PaymentStatus = 'cleared' | 'pending' | 'bounced' | 'cancelled';
export type PaymentMode = 'cash' | 'cheque' | 'dd' | 'upi' | 'card' | 'bank_transfer' | 'online';

export interface PaymentResult {
  id: string;
  receiptNumber: string;
  amount: number;
  status: PaymentStatus;
  receivedOn: string;
  allocated: number;
  advance: number;
  repeated: boolean;
}

export interface PaymentList {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  total: number;
  byMode: Array<{ mode: PaymentMode; receipts: number; amount: number }>;
  totalAmount: number;
  data: Array<{
    id: string;
    receiptNumber: string;
    receivedOn: string;
    mode: PaymentMode;
    amount: number;
    reference: string;
    status: PaymentStatus;
    studentId: string;
    studentName: string;
    admissionNumber: string;
    collectedBy: string | null;
    dayClosed: boolean;
  }>;
  can: { collect: boolean; cancel: boolean };
}

export interface DaySummary {
  date: string;
  receipts: number;
  cancelled: number;
  totals: Partial<Record<PaymentMode, number>>;
  total: number;
  cashExpected: number;
  closing: {
    id: string;
    closedAt: string;
    cashCounted: number;
    cashExpected: number;
    difference: number;
    note: string;
  } | null;
}

export interface DayClosing {
  id: string;
  closedFor: string;
  receipts: number;
  totals: Partial<Record<PaymentMode, number>>;
  cashExpected: number;
  cashCounted: number;
  difference: number;
  note: string;
  closedAt: string;
  cashier: string | null;
}

/* ---------------------- Phase 6c: paying the school, proofs, refunds ---------------------- */

export interface PaymentSettings {
  id: string;
  campusId: string;
  enabled: boolean;
  payeeName: string;
  upiId: string;
  bankAccountName: string;
  bankAccountNumber: string;
  ifsc: string;
  bankName: string;
  branch: string;
  instructions: string;
  hasQrImage: boolean;
  qrUrl: string | null;
  updatedAt: string;
}

export interface PaymentLinkCreated {
  id: string;
  url: string;
  amount: number;
  expiresAt: string;
  guardianPhone: string | null;
  message: string;
}

export interface PaymentLinkRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  amount: number;
  note: string;
  status: 'open' | 'paid' | 'cancelled' | 'expired';
  expiresAt: string;
  createdAt: string;
  paidAt: string | null;
  createdByName: string | null;
  proofs: number;
}

export type ProofStatus = 'pending' | 'approved' | 'rejected';

export interface ProofRow {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  className: string;
  amount: number;
  askedAmount: number;
  mode: 'upi' | 'bank_transfer';
  reference: string;
  paidOn: string;
  payerName: string;
  payerPhone: string;
  status: ProofStatus;
  decisionNote: string;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  receiptNumber: string | null;
  paymentId: string | null;
}

export interface ProofDetail {
  id: string;
  studentId: string;
  amount: number;
  askedAmount: number | null;
  mode: string;
  reference: string;
  paidOn: string;
  payerName: string;
  payerPhone: string;
  status: ProofStatus;
  decisionNote: string;
  paymentId: string | null;
  createdAt: string;
  contentType: string;
  fileUrl: string;
  otherProofs: Array<{
    id: string;
    amount: number;
    reference: string;
    status: ProofStatus;
    createdAt: string;
  }>;
}

export interface RefundRow {
  id: string;
  refundNumber: string | null;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  amount: number;
  source: 'advance' | 'deposit';
  mode: 'cash' | 'cheque' | 'bank_transfer' | 'upi';
  reference: string;
  reason: string;
  status: 'requested' | 'paid' | 'rejected';
  createdAt: string;
  paidOn: string | null;
  decisionNote: string;
  requestedByName: string | null;
  decidedByName: string | null;
  mine: boolean;
}

export interface Refundable {
  campusId: string;
  advance: number;
  deposit: number;
  deposits: Array<{ lineId: string; label: string; available: number }>;
}

export interface PublicPayView {
  status: 'open' | 'paid' | 'cancelled' | 'expired';
  school: string;
  campus: string;
  studentFirstName: string;
  className: string;
  amount: number;
  outstanding: number;
  note: string;
  expiresAt: string;
  today: string;
  payTo: {
    payeeName: string;
    upiId: string;
    bankAccountName: string;
    bankAccountNumber: string;
    ifsc: string;
    bankName: string;
    branch: string;
    instructions: string;
    qrUrl: string | null;
    upiUri: string | null;
  } | null;
  proofs: Array<{
    id: string;
    amount: number;
    reference: string;
    paidOn: string;
    status: ProofStatus;
    note: string;
    submittedAt: string;
    receiptNumber: string | null;
  }>;
}

/* ------------------------------- Phase 7a: parent portal ------------------------------- */

export interface FamilyChild {
  id: string;
  firstName: string;
  lastName: string;
  admissionNumber: string;
  status: string;
  campusName: string;
  className: string | null;
  sectionName: string | null;
  outstanding: number;
  due: number;
  todayAttendance: string | null;
}

export interface FamilyAttendance {
  enrollment: { className: string; sectionName: string; yearName: string };
  years: Array<{ academicYearId: string; yearName: string }>;
  totals: {
    days: number;
    present: number;
    late: number;
    halfDays: number;
    absent: number;
    leave: number;
    percent: number | null;
  };
  low: boolean;
  lowThreshold: number;
  months: Array<{ month: string; days: number; absent: number; percent: number | null }>;
  records: Array<{ date: string; status: string; remark: string }>;
  leaves: Array<{
    id: string;
    fromDate: string;
    toDate: string;
    days: number;
    reason: string;
    status: string;
  }>;
}

export interface FamilyFees {
  enrollment: { className: string; sectionName: string; yearName: string };
  today: string;
  totals: {
    billed: number;
    reduced: number;
    paid: number;
    balance: number;
    advance: number;
    overdue: number;
  };
  canPayOnline: boolean;
  demands: Array<{
    id: string;
    label: string;
    dueOn: string;
    state: 'due' | 'overdue' | 'settled' | 'cancelled';
    billed: number;
    reduced: number;
    paid: number;
    balance: number;
    lines: Array<{ headName: string; amount: number; reduced: number; paid: number }>;
  }>;
  receipts: Array<{
    id: string;
    receiptNumber: string;
    receivedOn: string;
    mode: string;
    amount: number;
    status: string;
  }>;
  proofs: Array<{
    id: string;
    amount: number;
    reference: string;
    paidOn: string;
    status: string;
    note: string;
  }>;
}

export interface PortalAccess {
  canManage: boolean;
  guardians: Array<{
    id: string;
    fullName: string;
    phone: string;
    relationship: string;
    isPrimary: boolean;
    status: 'none' | 'invited' | 'active';
    loginPhone: string | null;
    lastLoginAt: string | null;
    inviteExpiresAt: string | null;
  }>;
}

export interface PortalInviteCreated {
  id: string;
  url: string;
  expiresAt: string;
  phone: string;
  message: string;
  purpose: 'activate' | 'reset';
}

/* --------------------------------- Phase 8: teaching --------------------------------- */

export interface MyClass {
  sectionId: string;
  sectionName: string;
  className: string;
  isClassTeacher: boolean;
  subjects: Array<{ id: string; name: string }>;
  students: number;
  attendanceTaken: boolean;
}

export interface Roster {
  section: { id: string; name: string; className: string };
  role: 'class_teacher' | 'subject_teacher' | 'office';
  canOpenProfiles: boolean;
  students: Array<{
    id: string;
    firstName: string;
    lastName: string;
    admissionNumber: string;
    gender: string;
    rollNumber: number | null;
    parentPhone?: string | null;
  }>;
}

/* ------------------------------- Phase 10: daily classroom ------------------------------- */

export interface PeriodSlot {
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
}

export interface SectionTimetable {
  section: { id: string; name: string; className: string; campusId: string };
  canManage: boolean;
  slots: PeriodSlot[];
  subjects: Array<{ id: string; name: string; teacherId: string | null }>;
  entries: Array<{
    id: string;
    weekday: number;
    slotId: string;
    subjectId: string;
    subjectName: string;
    membershipId: string | null;
    teacherName: string | null;
  }>;
}

export interface DayPeriod {
  entryId: string;
  seq: number;
  label: string;
  startsAt: string;
  endsAt: string;
  sectionId: string;
  className: string;
  sectionName: string;
  subjectName: string;
  isCover: boolean;
  coveredBy: string | null;
  absentTeacher: string | null;
}

export interface MyDay {
  date: string;
  weekday: number;
  periods: DayPeriod[];
}

export interface TeacherDay {
  date: string;
  periods: Array<DayPeriod & { freeTeachers: Array<{ membershipId: string; fullName: string }> }>;
}

export interface HomeworkItem {
  id: string;
  title: string;
  details: string;
  givenOn: string;
  dueOn: string | null;
  subjectName: string;
  subjectId: string;
  teacherName: string | null;
  attachmentUrl: string | null;
  contentType: string | null;
  canRemove?: boolean;
}

export type NoticeAudience = 'everyone' | 'parents' | 'staff';
export type NoticeStatus = 'draft' | 'published' | 'archived';

export interface NoticeRow {
  id: string;
  campusId: string | null;
  title: string;
  body: string;
  audience: NoticeAudience;
  gradeLevelIds: string[];
  sectionIds: string[];
  status: NoticeStatus;
  pinned: boolean;
  publishedAt: string | null;
  expiresOn: string | null;
  createdAt: string;
  byName: string | null;
  reads: number;
}

export interface FeedNotice {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: string;
}

/* ------------------------------------- Phase 11: exams ------------------------------------- */

export type ExamStatus = 'draft' | 'open' | 'published';
export type MarkStatus = 'present' | 'absent' | 'medical' | 'exempt';

export interface ExamListItem {
  id: string;
  name: string;
  status: ExamStatus;
  startsOn: string | null;
  endsOn: string | null;
  publishedAt: string | null;
  termName: string | null;
  papers: number;
  classes: number;
  submitted: number;
  toSubmit: number;
}

export interface ExamPaperRow {
  id: string;
  gradeLevelId: string;
  subjectId: string;
  subjectName: string;
  examDate: string | null;
  startsAt: string | null;
  maxMarks: number;
  passMarks: number;
}

export interface ExamDetail {
  id: string;
  name: string;
  status: ExamStatus;
  startsOn: string | null;
  endsOn: string | null;
  publishedAt: string | null;
  canManage: boolean;
  classes: Array<{
    id: string;
    name: string;
    sections: Array<{ id: string; name: string }>;
    subjects: Array<{ id: string; name: string }>;
    papers: ExamPaperRow[];
  }>;
  progress: Array<{
    paperId: string;
    sectionId: string;
    students: number;
    entered: number;
    submitted: boolean;
    teacher: string | null;
  }>;
}

export interface MarksToEnter {
  examId: string;
  examName: string;
  paperId: string;
  sectionId: string;
  className: string;
  sectionName: string;
  subjectName: string;
  examDate: string | null;
  maxMarks: number;
  students: number;
  entered: number;
  submitted: boolean;
}

export interface MarksSheet {
  exam: { id: string; name: string; status: ExamStatus };
  paper: {
    id: string;
    subjectName: string;
    maxMarks: number;
    passMarks: number;
    examDate: string | null;
  };
  section: { id: string; name: string; className: string };
  submission: { at: string; by: string | null } | null;
  canEdit: boolean;
  canReopen: boolean;
  students: Array<{
    enrollmentId: string;
    rollNumber: number | null;
    name: string;
    admissionNumber: string;
    marks: number | null;
    status: MarkStatus | null;
  }>;
}

export interface SubjectResult {
  subjectName: string;
  maxMarks: number;
  passMarks: number;
  marks: number | null;
  status: MarkStatus | null;
  grade: string | null;
  passed: boolean | null;
}

export interface StudentResult {
  enrollmentId: string;
  studentId: string;
  name: string;
  admissionNumber: string;
  rollNumber: number | null;
  subjects: SubjectResult[];
  total: number;
  maxTotal: number;
  percent: number | null;
  grade: string | null;
  failedIn: string[];
  complete: boolean;
  rank: number | null;
  remark: string;
}

export interface SectionResults {
  exam: { id: string; name: string; status: ExamStatus };
  section: { id: string; name: string; className: string };
  canRemark: boolean;
  papers: Array<{ id: string; subjectName: string; maxMarks: number; passMarks: number }>;
  results: StudentResult[];
  summary: { students: number; complete: number; passed: number; average: number | null };
}

export interface FamilyResult {
  examId: string;
  examName: string;
  publishedAt: string;
  subjects: SubjectResult[];
  total: number;
  maxTotal: number;
  percent: number | null;
  grade: string | null;
  rank: number | null;
  classSize: number;
  failedIn: string[];
  remark: string;
}
