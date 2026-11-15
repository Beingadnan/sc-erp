import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'School ERP', template: '%s · School ERP' },
  description: 'Admissions, attendance, fees and academics for Indian schools.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-slate-50 font-sans text-slate-900 antialiased">{children}</body>
    </html>
  );
}
