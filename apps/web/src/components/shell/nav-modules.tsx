import type { LucideIcon } from 'lucide-react';
import {
  CalendarCheck,
  ClipboardList,
  Globe,
  GraduationCap,
  Heart,
  House,
  IndianRupee,
  Megaphone,
  School,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';

/** One screen inside a module. `setup` screens sit under a "Setup" menu, out of the daily way. */
export interface NavPage {
  href: string;
  label: string;
  /** Shown only with this permission (any scope); a list means any of them. */
  permission?: string | string[];
  setup?: boolean;
}

/** A sidebar entry. Its pages show as tabs at the top of the page, not in the sidebar. */
export interface NavModule {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Navigation group (Fluent Nav category) the module is listed under. */
  group: NavGroupKey;
  pages: NavPage[];
}

export type NavGroupKey = 'daily' | 'students' | 'money' | 'teaching' | 'school';
export const NAV_GROUPS: Array<{ key: NavGroupKey; label: string }> = [
  { key: 'daily', label: 'Daily' },
  { key: 'students', label: 'Students' },
  { key: 'money', label: 'Money' },
  { key: 'teaching', label: 'Teaching' },
  { key: 'school', label: 'School' },
];

const FEES_ANY = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'];
const ATT_ANY = ['attendance.view', 'attendance.mark', 'attendance.correct'];

export const MODULES: NavModule[] = [
  {
    key: 'home',
    label: 'Today',
    icon: House,
    group: 'daily',
    pages: [{ href: '/dashboard', label: 'Today' }],
  },
  {
    key: 'classes',
    label: 'My classes',
    icon: GraduationCap,
    group: 'daily',
    pages: [
      {
        href: '/my-classes',
        label: 'My classes',
        permission: ['attendance.mark', 'students.view_assigned'],
      },
    ],
  },
  {
    key: 'attendance',
    label: 'Attendance',
    icon: CalendarCheck,
    group: 'daily',
    pages: [
      {
        href: '/attendance/mark',
        label: 'Take attendance',
        permission: ['attendance.mark', 'attendance.correct'],
      },
      { href: '/attendance', label: 'Today', permission: ATT_ANY },
      { href: '/attendance/register', label: 'Monthly register', permission: ATT_ANY },
      { href: '/attendance/leave', label: 'Leave', permission: ATT_ANY },
      { href: '/attendance/low', label: 'Low attendance', permission: ATT_ANY },
      {
        href: '/settings/attendance',
        label: 'Attendance rules',
        permission: ['attendance.view', 'attendance.correct'],
        setup: true,
      },
    ],
  },
  {
    key: 'students',
    label: 'Students',
    icon: Users,
    group: 'students',
    pages: [
      {
        href: '/students',
        label: 'All students',
        permission: ['students.view', 'students.view_assigned'],
      },
      { href: '/students/new', label: 'Admit', permission: 'students.manage' },
      { href: '/students/promote', label: 'Promote', permission: 'students.promote' },
      {
        href: '/students/import',
        label: 'Import from Excel',
        permission: 'students.import',
        setup: true,
      },
      {
        href: '/settings/admission-numbers',
        label: 'Admission numbers',
        permission: 'students.manage',
        setup: true,
      },
    ],
  },
  {
    key: 'fees',
    label: 'Fees',
    icon: IndianRupee,
    group: 'money',
    pages: [
      { href: '/fees/collect', label: 'Counter', permission: 'fees.collect' },
      { href: '/fees/proofs', label: 'Payments to check', permission: FEES_ANY },
      { href: '/fees/receipts', label: 'Receipts', permission: FEES_ANY },
      { href: '/fees/day-close', label: 'Day closing', permission: FEES_ANY },
      { href: '/fees/reports', label: 'Reports', permission: FEES_ANY },
      {
        href: '/fees/refunds',
        label: 'Refunds',
        permission: [...FEES_ANY, 'fees.refund', 'fees.cancel_receipt'],
      },
      { href: '/fees', label: 'Demands', permission: FEES_ANY, setup: true },
      { href: '/fees/structures', label: 'Fee structures', permission: FEES_ANY, setup: true },
      { href: '/fees/concessions', label: 'Concessions', permission: FEES_ANY, setup: true },
      { href: '/fees/heads', label: 'Fee heads', permission: FEES_ANY, setup: true },
      { href: '/fees/accounts', label: 'Accounts', permission: FEES_ANY, setup: true },
      {
        href: '/settings/payments',
        label: 'Payment details',
        permission: ['settings.manage', 'fees.configure'],
        setup: true,
      },
    ],
  },
  {
    key: 'admissions',
    label: 'Admissions',
    icon: UserPlus,
    group: 'students',
    pages: [
      { href: '/admissions/inquiries', label: 'Inquiries', permission: 'admissions.view' },
      { href: '/admissions/applications', label: 'Applications', permission: 'admissions.view' },
    ],
  },
  {
    key: 'academics',
    label: 'Academics',
    icon: School,
    group: 'teaching',
    pages: [
      { href: '/academics/classes', label: 'Classes & sections', permission: 'academic.view' },
      {
        href: '/academics/timetable',
        label: 'Timetable',
        permission: ['academic.view', 'timetable.manage'],
      },
      { href: '/academics/substitutions', label: 'Substitutions', permission: 'timetable.manage' },
      { href: '/academics/teaching', label: 'Who teaches what', permission: 'academic.view' },
      { href: '/academics/subjects', label: 'Subjects', permission: 'academic.view' },
      { href: '/academics/calendar', label: 'Calendar', permission: 'academic.view' },
      {
        href: '/academics/years',
        label: 'Academic years',
        permission: 'academic.view',
        setup: true,
      },
      { href: '/academics/grading', label: 'Grading', permission: 'academic.view', setup: true },
    ],
  },
  {
    key: 'exams',
    label: 'Exams',
    icon: ClipboardList,
    group: 'teaching',
    pages: [
      { href: '/exams', label: 'Exams', permission: ['exams.manage', 'academic.view'] },
      { href: '/marks', label: 'My marks entry', permission: 'attendance.mark' },
    ],
  },
  {
    key: 'notices',
    label: 'Notices',
    icon: Megaphone,
    group: 'school',
    pages: [{ href: '/notices', label: 'Notices', permission: 'notices.manage' }],
  },
  {
    key: 'website',
    label: 'Website',
    icon: Globe,
    group: 'school',
    pages: [{ href: '/website', label: 'Website pages', permission: 'cms.manage' }],
  },
  {
    key: 'family',
    label: 'My children',
    icon: Heart,
    group: 'school',
    pages: [{ href: '/parent', label: 'My children', permission: 'family.portal' }],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: Settings,
    group: 'school',
    pages: [
      { href: '/settings/school', label: 'School profile' },
      { href: '/settings/campuses', label: 'Campuses' },
      { href: '/settings/members', label: 'Staff & access', permission: 'members.view' },
      { href: '/settings/import', label: 'Import old data', permission: 'academic.manage' },
      { href: '/settings/roles', label: 'Roles', permission: 'members.view' },
      { href: '/settings/audit', label: 'Audit log', permission: 'audit.view' },
      { href: '/account/security', label: 'My security' },
    ],
  },
];

/** The module and page for a path: the longest matching page href wins. */
export function locate(pathname: string): { module: NavModule; page: NavPage } | null {
  let best: { module: NavModule; page: NavPage } | null = null;
  for (const module of MODULES) {
    for (const page of module.pages) {
      const hit = pathname === page.href || pathname.startsWith(`${page.href}/`);
      if (hit && (!best || page.href.length > best.page.href.length)) best = { module, page };
    }
  }
  return best;
}
