import { redirect } from 'next/navigation';

/** Old address of the parent app. */
export default function OldFamilyPage() {
  redirect('/parent');
}
