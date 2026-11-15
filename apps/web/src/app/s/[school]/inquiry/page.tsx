import type { Metadata } from 'next';
import { InquiryForm } from '@/components/website/inquiry-form';
import { getSite } from '@/lib/public-site';

export const metadata: Metadata = { title: 'Admission inquiry' };

export default async function InquiryPage({ params }: { params: Promise<{ school: string }> }) {
  const site = await getSite((await params).school);
  if (!site) return null;
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Admission inquiry</h1>
      <p className="mt-3 mb-8 text-slate-700">
        Share a few details and the {site.name} office will get in touch with you.
      </p>
      <InquiryForm
        school={site.slug}
        campuses={site.campuses.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
