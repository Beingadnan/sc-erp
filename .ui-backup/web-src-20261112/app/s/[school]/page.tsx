import Link from 'next/link';
import { Markdown } from '@/components/website/markdown';
import { getPage, getSite } from '@/lib/public-site';

export default async function SchoolHome({ params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  const [site, home] = await Promise.all([getSite(school), getPage(school, 'home')]);
  if (!site) return null; // layout already shows not-found
  const base = `/s/${site.slug}`;

  if (home) {
    return <Markdown source={home.body} pageHref={(slug) => `${base}/${slug}`} />;
  }
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{site.name}</h1>
      <p className="mt-4 text-slate-700">
        Welcome. Our website is being set up. For admission, please send us an inquiry and our
        office will contact you.
      </p>
      <Link
        href={`${base}/inquiry`}
        className="mt-6 inline-flex rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
      >
        Admission inquiry
      </Link>
    </div>
  );
}
