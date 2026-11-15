import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Markdown } from '@/components/website/markdown';
import { getPage } from '@/lib/public-site';

type Params = Promise<{ school: string; page: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { school, page } = await params;
  const p = await getPage(school, page);
  return p ? { title: p.title } : {};
}

export default async function SchoolPage({ params }: { params: Params }) {
  const { school, page } = await params;
  const p = await getPage(school, page);
  if (!p) notFound();
  return <Markdown source={p.body} pageHref={(slug) => `/s/${school.toLowerCase()}/${slug}`} />;
}
