import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8 text-lg font-semibold tracking-tight text-slate-900">
        School ERP
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {children}
      </div>
    </main>
  );
}
