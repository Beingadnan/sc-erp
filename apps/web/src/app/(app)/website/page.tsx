'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { post } from '@/lib/api';
import type { CmsPageSummary } from '@/lib/api';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Skeleton,
  Table,
  Td,
  buttonStyles,
} from '@/components/ui';

function NewPage({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  const f = error?.fields ?? {};
  const submit = async (form: FormData) => {
    const res = await run(() =>
      post<{ id: string }>('/website/pages', { title: form.get('title'), slug: form.get('slug') }),
    );
    if (res) router.push(`/website/${res.id}`);
  };
  return (
    <form onSubmit={onSubmitForm(submit)} className="grid gap-4 sm:grid-cols-3 sm:items-start">
      {error && !Object.keys(f).length && (
        <div className="sm:col-span-3">
          <Alert>{error.message}</Alert>
        </div>
      )}
      <Field label="Page title" name="title" error={f.title} required />
      <Field label="Address" name="slug" hint="e.g. fees or transport" error={f.slug} required />
      <div className="flex gap-2 sm:pt-6">
        <Button type="submit" loading={pending}>
          Create page
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function WebsitePage() {
  const { tenant, canEverywhere } = useSession();
  const { data, loading, error, reload } = useApi<CmsPageSummary[]>('/website/pages');
  const [adding, setAdding] = useState(false);
  const starter = useAction();
  const siteUrl = tenant ? `/s/${tenant.slug}` : null;

  if (!canEverywhere('cms.manage')) {
    return (
      <>
        <PageHeader title="Website" />
        <Alert>You do not have permission to edit the school website.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Website"
        description="Pages of your public school website. Changes stay as drafts until you publish them."
        actions={
          <div className="flex gap-2">
            {siteUrl && (
              <a
                href={siteUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonStyles('secondary')}
              >
                View website
              </a>
            )}
            {!adding && (
              <Button onClick={() => setAdding(true)} icon={Plus}>
                New page
              </Button>
            )}
          </div>
        }
      />
      {adding && (
        <Card title="New page" className="mb-6">
          <NewPage onCancel={() => setAdding(false)} />
        </Card>
      )}
      {starter.error && (
        <div className="mb-4">
          <Alert>{starter.error.message}</Alert>
        </div>
      )}
      <Card>
        {loading && !data ? (
          <Skeleton />
        ) : error ? (
          <Alert>{error.message}</Alert>
        ) : !data?.length ? (
          <EmptyState title="No pages yet">
            <p>Start with Home, About, Admissions and Contact pages that you can edit.</p>
            <Button
              className="mt-4"
              loading={starter.pending}
              onClick={async () => {
                await starter.run(() => post('/website/pages/starter'));
                void reload();
              }}
              icon={Plus}
            >
              Create starter pages
            </Button>
          </EmptyState>
        ) : (
          <Table head={['Page', 'Address', 'Status', 'In menu', '']}>
            {data.map((p) => (
              <tr key={p.id}>
                <Td>
                  <Link
                    href={`/website/${p.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {p.title}
                  </Link>
                </Td>
                <Td>
                  <code className="text-xs">/{p.slug}</code>
                </Td>
                <Td>
                  {p.publishedVersion === null ? (
                    <Badge>Draft</Badge>
                  ) : p.hasDraftChanges ? (
                    <Badge tone="amber">Unpublished changes</Badge>
                  ) : (
                    <Badge tone="green">Published</Badge>
                  )}
                </Td>
                <Td>{p.showInNav ? 'Yes' : 'No'}</Td>
                <Td className="text-right">
                  <ButtonLink href={`/website/${p.id}`} variant="ghost">
                    Edit
                  </ButtonLink>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
