import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSite } from '@/lib/public-site';

type Params = Promise<{ school: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const site = await getSite((await params).school);
  return site ? { title: { default: site.name, template: `%s · ${site.name}` } } : {};
}

export default async function SchoolSiteLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Params;
}) {
  const { school } = await params;
  const site = await getSite(school);
  if (!site) notFound();
  const base = `/s/${site.slug}`;

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link href={base} className="text-lg font-semibold text-slate-900">
            {site.name}
          </Link>
          <nav aria-label="School website" className="flex flex-wrap items-center gap-1 text-sm">
            {site.pages
              .filter((p) => p.slug !== 'home')
              .map((p) => (
                <Link
                  key={p.slug}
                  href={`${base}/${p.slug}`}
                  className="rounded-md px-3 py-1.5 text-slate-700 hover:bg-slate-100"
                >
                  {p.title}
                </Link>
              ))}
            <Link
              href={`${base}/inquiry`}
              className="ml-1 rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
            >
              Admission inquiry
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">{children}</main>
      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-5xl gap-6 px-5 py-8 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
          {site.campuses.map((c) => (
            <div key={c.id}>
              <p className="font-medium text-slate-900">{c.name}</p>
              <p className="text-xs text-slate-500">{c.board}</p>
              {c.address && <p className="mt-1">{c.address}</p>}
              {c.phone && (
                <p>
                  <a href={`tel:${c.phone}`} className="hover:underline">
                    {c.phone}
                  </a>
                </p>
              )}
              {c.email && (
                <p>
                  <a href={`mailto:${c.email}`} className="hover:underline">
                    {c.email}
                  </a>
                </p>
              )}
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
