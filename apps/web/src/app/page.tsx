import Link from 'next/link';
import type { ReactNode } from 'react';
import { SchoolIllustration } from '@/components/landing/school-illustration';

const icon = (path: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    className="size-6"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {path}
  </svg>
);

const ICONS = {
  admissions: icon(
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5 1.2 0 2.3.25 3.2.7" />
      <path d="M17.5 13.5v6M14.5 16.5h6" />
    </>,
  ),
  students: icon(
    <>
      <path d="M2 9.5 12 5l10 4.5-10 4.5L2 9.5Z" />
      <path d="M6.5 11.8V16c1.6 1.5 3.4 2.2 5.5 2.2s3.9-.7 5.5-2.2v-4.2" />
      <path d="M22 9.5V15" />
    </>,
  ),
  attendance: icon(
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="m9 15 2 2 4-4" />
    </>,
  ),
  fees: icon(
    <>
      <path d="M7 5h10M7 9h10M7 5c5 0 7 1.5 7 4s-2 4-7 4l7 7" />
    </>,
  ),
  exams: icon(
    <>
      <path d="M6.5 3h8L19 7.5V20a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>,
  ),
  parents: icon(
    <>
      <circle cx="9" cy="8" r="3.5" />
      <circle cx="17" cy="9.5" r="2.5" />
      <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 15c2.8 0 4.8 1.6 5.5 5" />
    </>,
  ),
  schools: icon(
    <>
      <circle cx="12" cy="8" r="3" />
      <circle cx="5" cy="10" r="2.2" />
      <circle cx="19" cy="10" r="2.2" />
      <path d="M6.5 20c.5-3.3 2.6-5 5.5-5s5 1.7 5.5 5M1.5 18.5c.3-2.2 1.6-3.5 3.5-3.5M22.5 18.5c-.3-2.2-1.6-3.5-3.5-3.5" />
    </>,
  ),
  shield: icon(
    <>
      <path d="M12 3 5 5.8v5.7c0 4.3 2.8 7.7 7 9.5 4.2-1.8 7-5.2 7-9.5V5.8L12 3Z" />
      <path d="m9 12 2.2 2.2L15.2 10" />
    </>,
  ),
  chart: icon(
    <>
      <path d="M4 20V11M10 20V7M16 20v-6M3 20h18" />
      <path d="m4 7 6-4 6 6 5-4" />
    </>,
  ),
  ledger: icon(
    <>
      <path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z" />
      <path d="M9 9h6M9 13h6M5 17h14" />
    </>,
  ),
  lock: icon(
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>,
  ),
  phone: icon(
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>,
  ),
};

const modules = [
  {
    name: 'Admissions',
    detail: 'Inquiry to enrollment, admission numbers, documents',
    icon: ICONS.admissions,
    tone: 'bg-blue-100 text-blue-700',
  },
  {
    name: 'Students',
    detail: 'Profiles, guardians, siblings, promotion, TC',
    icon: ICONS.students,
    tone: 'bg-emerald-100 text-emerald-700',
  },
  {
    name: 'Attendance',
    detail: 'Daily or period-wise, corrections with history',
    icon: ICONS.attendance,
    tone: 'bg-violet-100 text-violet-700',
  },
  {
    name: 'Fees',
    detail: 'Installments, concessions, UPI and counter receipts',
    icon: ICONS.fees,
    tone: 'bg-orange-100 text-orange-600',
  },
  {
    name: 'Exams',
    detail: 'CBSE and RBSE report cards',
    icon: ICONS.exams,
    tone: 'bg-teal-100 text-teal-700',
    soon: true,
  },
  {
    name: 'Parent app',
    detail: 'Attendance, dues, online payment, notices',
    icon: ICONS.parents,
    tone: 'bg-rose-100 text-rose-600',
    soon: true,
  },
];

const features = [
  {
    title: 'Every school kept separate',
    body: 'Each school’s records are isolated in the database itself, so one school can never see another’s data.',
    icon: ICONS.shield,
  },
  {
    title: 'Fees you can audit',
    body: 'Gap-free receipt numbers, double-entry accounts and corrections by reversal — nothing is silently edited.',
    icon: ICONS.ledger,
  },
  {
    title: 'Roles for every desk',
    body: 'Owner, principal, accountant, class teacher and front office each see only what their work needs.',
    icon: ICONS.lock,
  },
  {
    title: 'Works on the phone',
    body: 'Teachers take attendance on a phone in under a minute; office screens work on any laptop.',
    icon: ICONS.phone,
  },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
      <svg viewBox="0 0 40 40" className="size-9" aria-hidden>
        <path d="M20 6 3 14.5 20 23l17-8.5L20 6Z" fill="#1e3a8a" />
        <path
          d="M9.5 19.5V28c3 3 6.5 4.5 10.5 4.5S27.5 31 30.5 28v-8.5L20 25 9.5 19.5Z"
          fill="#2563eb"
        />
        <path d="M35 16v9" stroke="#1e3a8a" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span>
        School <span className="text-brand-600">ERP</span>
      </span>
    </Link>
  );
}

function Chip({
  className,
  tone,
  icon: i,
  title,
  sub,
}: {
  className: string;
  tone: string;
  icon: ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <div
      className={`absolute items-center gap-3 rounded-2xl border border-white/70 bg-white/90 px-4 py-3 shadow-lg shadow-blue-900/10 backdrop-blur ${className}`}
    >
      <span className={`flex size-10 items-center justify-center rounded-full ${tone}`}>{i}</span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block text-xs text-slate-500">{sub}</span>
      </span>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="relative overflow-x-clip bg-gradient-to-b from-white via-slate-50 to-blue-50/60">
      {/* Soft background shapes */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-[28rem] size-96 rounded-full bg-blue-100/50"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-48 top-[44rem] size-[32rem] rounded-full bg-blue-100/40"
      />

      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Logo />
          <nav
            aria-label="Sections"
            className="hidden items-center gap-1 text-sm font-medium text-slate-600 md:flex"
          >
            <a href="#top" className="rounded-full bg-brand-50 px-4 py-2 text-brand-700">
              Home
            </a>
            <a href="#features" className="rounded-full px-4 py-2 hover:bg-slate-100">
              Features
            </a>
            <a href="#modules" className="rounded-full px-4 py-2 hover:bg-slate-100">
              Modules
            </a>
            <a href="#about" className="rounded-full px-4 py-2 hover:bg-slate-100">
              About
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/parent/login"
              className="hidden h-10 items-center px-3 text-sm font-semibold text-slate-600 hover:text-slate-900 sm:inline-flex"
            >
              Parent login
            </Link>
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold shadow-sm hover:bg-slate-50"
            >
              Staff login
            </Link>
            <Link
              href="/register"
              className="hidden h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white shadow-md shadow-blue-600/25 hover:bg-brand-700 sm:inline-flex"
            >
              Register Your School <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </header>

      <main id="top" className="relative mx-auto max-w-7xl px-5 sm:px-8">
        {/* Hero */}
        <section className="grid items-center gap-10 pb-10 pt-12 lg:grid-cols-[1.2fr_1fr] lg:pt-16">
          <div className="flex flex-col items-start gap-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-1.5 text-sm font-semibold text-brand-700">
              <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
                <path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2L12 2Z" />
              </svg>
              Complete School Management Solution
            </span>
            <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight text-slate-950 sm:text-6xl lg:text-[3.4rem] xl:text-[3.75rem]">
              One system for every{' '}
              <span className="relative whitespace-nowrap text-brand-600">
                school
                <svg
                  viewBox="0 0 200 12"
                  preserveAspectRatio="none"
                  className="absolute -bottom-1 left-0 h-3 w-full text-blue-300"
                  aria-hidden
                >
                  <path
                    d="M2 9c40-7 150-9 196-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>{' '}
              in your group.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-slate-600 sm:text-xl">
              Admissions, attendance, fees and academics, with each school&apos;s data kept strictly
              separate.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/register"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand-600 px-6 font-semibold text-white shadow-lg shadow-blue-600/30 hover:bg-brand-700"
              >
                <span aria-hidden>↗</span> Register your school
              </Link>
              <a
                href="#modules"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 font-semibold shadow-sm hover:bg-slate-50"
              >
                Explore modules
              </a>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
            <div
              aria-hidden
              className="absolute inset-x-6 bottom-0 top-6 rounded-[45%] bg-gradient-to-b from-blue-100 to-blue-50"
            />
            <SchoolIllustration className="relative w-full drop-shadow-xl" />
            <Chip
              className="left-0 top-4 hidden sm:left-2 sm:flex"
              tone="bg-blue-100 text-blue-700"
              icon={ICONS.schools}
              title="Multiple Schools"
              sub="One platform"
            />
            <Chip
              className="right-0 -top-3 flex sm:top-0"
              tone="bg-emerald-100 text-emerald-700"
              icon={ICONS.shield}
              title="Data Isolation"
              sub="Each school separate"
            />
            <Chip
              className="bottom-2 right-0 flex sm:bottom-6 sm:right-2"
              tone="bg-indigo-100 text-indigo-700"
              icon={ICONS.chart}
              title="Clear Reports"
              sub="Fees and attendance"
            />
          </div>
        </section>

        {/* Modules */}
        <section id="modules" aria-labelledby="modules-heading" className="scroll-mt-24 py-10">
          <h2
            id="modules-heading"
            className="mb-5 flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-brand-600"
          >
            <span aria-hidden className="h-0.5 w-6 rounded bg-brand-600" /> Modules
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((m) => (
              <li key={m.name}>
                <Link
                  href="/register"
                  className="group flex h-full items-start gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span
                    className={`flex size-14 shrink-0 items-center justify-center rounded-2xl ${m.tone}`}
                  >
                    {m.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 text-lg font-bold text-slate-900">
                      {m.name}
                      {m.soon && (
                        <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                          Coming soon
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-slate-600">
                      {m.detail}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Features */}
        <section id="features" aria-labelledby="features-heading" className="scroll-mt-24 py-10">
          <h2
            id="features-heading"
            className="mb-5 flex items-center gap-3 text-sm font-bold uppercase tracking-widest text-brand-600"
          >
            <span aria-hidden className="h-0.5 w-6 rounded bg-brand-600" /> Features
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <li key={f.title} className="rounded-2xl border border-slate-200/80 bg-white/80 p-6">
                <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  {f.icon}
                </span>
                <h3 className="mt-4 font-bold text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* About / call to action */}
        <section id="about" className="scroll-mt-24 py-10">
          <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-gradient-to-br from-brand-600 to-blue-800 p-8 text-white shadow-xl shadow-blue-900/20 sm:p-12 lg:flex-row lg:items-center">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                Built for Indian schools, CBSE and RBSE.
              </h2>
              <p className="mt-3 text-blue-100">
                Admission numbers in your own format, April–March fee years, rupees in lakh and
                crore, transfer certificates and Aadhaar handled with care. Set up your school in a
                few minutes.
              </p>
            </div>
            <Link
              href="/register"
              className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-white px-6 font-semibold text-brand-700 shadow-lg hover:bg-blue-50"
            >
              Register your school <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-sm text-slate-500 sm:px-8">
        <span>© {new Date().getFullYear()} School ERP</span>
        <span className="flex gap-5">
          <Link href="/login" className="hover:text-slate-900">
            Staff login
          </Link>
          <Link href="/parent/login" className="hover:text-slate-900">
            Parent login
          </Link>
          <Link href="/register" className="hover:text-slate-900">
            Register
          </Link>
        </span>
      </footer>
    </div>
  );
}
