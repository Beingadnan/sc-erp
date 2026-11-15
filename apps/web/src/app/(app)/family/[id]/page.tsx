import { redirect } from 'next/navigation';

/** Old address of a child's page in the parent app. */
export default async function OldFamilyChildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/parent/child/${id}`);
}
