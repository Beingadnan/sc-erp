'use client';

import type { MyClass } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { MyClassesList } from '@/components/teaching/my-classes';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui';

export default function MyClassesPage() {
  const mine = useApi<{ sections: MyClass[] }>('/teaching/mine');
  return (
    <>
      <PageHeader title="My classes" description="The classes you teach this year." />
      {mine.error && <Alert>{mine.error.message}</Alert>}
      {!mine.data ? (
        <Skeleton rows={4} />
      ) : !mine.data.sections.length ? (
        <EmptyState title="No classes yet">
          The school office has not assigned you a class or subject yet (Academics → Who teaches
          what).
        </EmptyState>
      ) : (
        <MyClassesList items={mine.data.sections} />
      )}
    </>
  );
}
