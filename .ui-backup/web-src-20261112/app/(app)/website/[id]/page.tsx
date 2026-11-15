'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, del, patch, post } from '@/lib/api';
import type { CmsPageDetail } from '@/lib/api';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { Markdown } from '@/components/website/markdown';
import { Alert, Badge, Button, Card, Field, PageHeader, Skeleton } from '@/components/ui';

const HELP = [
  ['# Heading', 'large heading'],
  ['## Section', 'section heading'],
  ['- item', 'bullet list'],
  ['**bold**', 'bold text'],
  ['[Admissions](admissions)', 'link to another page'],
  ['[Inquiry form](inquiry)', 'link to the inquiry form'],
  ['[Map](https://…)', 'link to another website'],
] as const;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export default function PageEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { tenant } = useSession();
  const { data, loading, error, reload } = useApi<CmsPageDetail>(`/website/pages/${id}`);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [slug, setSlug] = useState('');
  const [showInNav, setShowInNav] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);
  const [preview, setPreview] = useState<{ version: number; title: string; body: string } | null>(
    null,
  );
  const [saved, setSaved] = useState<string | null>(null);
  const save = useAction();
  const action = useAction();

  useEffect(() => {
    if (!data) return;
    setTitle(data.title);
    setBody(data.body);
    setSlug(data.slug);
    setShowInNav(data.showInNav);
    setSortOrder(data.sortOrder);
  }, [data]);

  if (loading && !data) return <Skeleton rows={6} />;
  if (error) return <Alert>{error.message}</Alert>;
  if (!data) return null;

  const dirty =
    title !== data.title ||
    body !== data.body ||
    slug !== data.slug ||
    showInNav !== data.showInNav ||
    sortOrder !== data.sortOrder;
  const contentChanged = title !== data.title || body !== data.body;
  const f = save.error?.fields ?? {};
  const base = tenant ? `/s/${tenant.slug}` : '';
  const publicUrl = data.slug === 'home' ? base : `${base}/${data.slug}`;

  const doSave = async () => {
    setSaved(null);
    const res = await save.run(() =>
      patch<{ version?: number }>(`/website/pages/${id}`, {
        ...(contentChanged ? { title, body } : {}),
        ...(slug !== data.slug ? { slug } : {}),
        ...(showInNav !== data.showInNav ? { showInNav } : {}),
        ...(sortOrder !== data.sortOrder ? { sortOrder } : {}),
      }),
    );
    if (res) {
      setSaved(res.version ? `Saved as version ${res.version} (not published yet).` : 'Saved.');
      await reload();
    }
  };

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setSaved(null);
    const ok = await action.run(fn);
    if (ok !== undefined) {
      setSaved(message);
      setPreview(null);
      await reload();
    }
  };

  return (
    <>
      <PageHeader
        title={data.title}
        description={
          data.publishedVersion === null
            ? 'Draft — not visible on the website yet.'
            : `Visitors see version ${data.publishedVersion}.`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/website">
              <Button variant="secondary">All pages</Button>
            </Link>
            {data.publishedVersion !== null && (
              <a href={publicUrl} target="_blank" rel="noreferrer">
                <Button variant="secondary">View live page</Button>
              </a>
            )}
          </div>
        }
      />
      {(save.error && !Object.keys(f).length) || action.error ? (
        <div className="mb-4">
          <Alert>{(save.error ?? action.error)!.message}</Alert>
        </div>
      ) : null}
      {saved && (
        <div className="mb-4">
          <Alert tone="success">{saved}</Alert>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Edit">
          <div className="space-y-4">
            <Field
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              error={f.title}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="page-body" className="text-sm font-medium text-slate-800">
                Content
              </label>
              <textarea
                id="page-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={18}
                className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm leading-6 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
              />
              {f.body && <p className="text-xs text-red-600">{f.body}</p>}
              <details className="text-xs text-slate-600">
                <summary className="cursor-pointer">Formatting help</summary>
                <table className="mt-2">
                  <tbody>
                    {HELP.map(([code, what]) => (
                      <tr key={code}>
                        <td className="pr-4 font-mono">{code}</td>
                        <td>{what}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Address"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                hint={`${base}/${slug}`}
                error={f.slug}
              />
              <Field
                label="Menu order"
                type="number"
                min={0}
                max={1000}
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                error={f.sortOrder}
              />
              <label className="flex items-center gap-2 text-sm sm:pt-6">
                <input
                  type="checkbox"
                  checked={showInNav}
                  onChange={(e) => setShowInNav(e.target.checked)}
                />
                Show in menu
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={doSave} loading={save.pending} disabled={!dirty}>
                Save draft
              </Button>
              <Button
                variant="secondary"
                disabled={dirty || data.publishedVersion === data.latestVersion}
                loading={action.pending}
                onClick={() =>
                  act(
                    () => post(`/website/pages/${id}/publish`, {}),
                    `Version ${data.latestVersion} is now live.`,
                  )
                }
                title={dirty ? 'Save your changes first' : undefined}
              >
                Publish version {data.latestVersion}
              </Button>
              {data.publishedVersion !== null && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    act(
                      () => post(`/website/pages/${id}/unpublish`),
                      'Page hidden from the website.',
                    )
                  }
                >
                  Unpublish
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!confirm(`Delete the page "${data.title}" and all its versions?`)) return;
                  const ok = await action.run(() => del(`/website/pages/${id}`));
                  if (ok !== undefined) router.push('/website');
                }}
              >
                Delete page
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card
            title={preview ? `Preview · version ${preview.version}` : 'Preview'}
            actions={
              preview && (
                <Button variant="ghost" onClick={() => setPreview(null)}>
                  Back to current draft
                </Button>
              )
            }
          >
            <div className="max-h-[32rem] overflow-y-auto">
              <Markdown source={preview?.body ?? body} pageHref={(s) => `${base}/${s}`} />
            </div>
          </Card>
          <Card title="Version history">
            <ul className="divide-y divide-slate-100 text-sm">
              {data.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">Version {v.version}</span>
                    {v.version === data.publishedVersion && (
                      <span className="ml-2">
                        <Badge tone="green">Live</Badge>
                      </span>
                    )}
                    <span className="ml-2 text-slate-500">
                      {when(v.createdAt)}
                      {v.createdByName ? ` · ${v.createdByName}` : ''}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        const r = await action.run(() =>
                          api<{ version: number; title: string; body: string }>(
                            `/website/pages/${id}/versions/${v.version}`,
                          ),
                        );
                        if (r) setPreview(r);
                      }}
                    >
                      View
                    </Button>
                    {v.version !== data.latestVersion && (
                      <Button
                        variant="ghost"
                        disabled={dirty}
                        title={dirty ? 'Save or discard your changes first' : undefined}
                        onClick={() =>
                          act(
                            () => post(`/website/pages/${id}/versions/${v.version}/restore`),
                            `Version ${v.version} copied into a new draft.`,
                          )
                        }
                      >
                        Restore
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
