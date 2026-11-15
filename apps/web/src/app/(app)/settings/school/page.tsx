'use client';

import Link from 'next/link';
import { ArrowRight, Building2, ExternalLink, Globe, MapPin } from 'lucide-react';
import { patch } from '@/lib/api';
import type { Campus } from '@/lib/api';
import { useAction, useApi, onSubmitForm } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import {
  Alert,
  Button,
  Card,
  DescriptionList,
  EmptyState,
  Field,
  PageHeader,
  toast,
} from '@/components/ui';

export default function SchoolProfilePage() {
  const { tenant, can, reload } = useSession();
  const { pending, error, run } = useAction();
  const campuses = useApi<Campus[]>('/campuses');
  const editable = can('settings.manage');

  if (!tenant)
    return (
      <Card>
        <EmptyState icon={Building2} title="No school selected">
          Choose a school from the menu to see its profile.
        </EmptyState>
      </Card>
    );

  const submit = async (form: FormData) => {
    const ok = await run(() =>
      patch('/tenant', { name: form.get('name'), defaultTimezone: form.get('defaultTimezone') }),
    );
    if (ok) {
      toast.success('School profile saved.');
      await reload();
    }
  };

  const active = (campuses.data ?? []).filter((c) => c.status === 'active');

  return (
    <>
      <PageHeader
        title="School Profile"
        description="Basic details shared by every campus of your school."
      />
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card
          title="General"
          description="How your school appears across the app."
          className="lg:col-span-2"
        >
          <form onSubmit={onSubmitForm(submit)} className="space-y-5">
            {!editable && <Alert tone="info">Only administrators can change these details.</Alert>}
            {error && !Object.keys(error.fields).length && <Alert>{error.message}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="School name"
                name="name"
                defaultValue={tenant.name}
                disabled={!editable}
                error={error?.fields.name}
                required
                className="sm:col-span-2"
              />
              <Field
                label="School address (URL)"
                value={tenant.slug}
                disabled
                hint="Contact support to change the address."
              />
              <Field
                label="Default time zone"
                name="defaultTimezone"
                defaultValue={tenant.defaultTimezone}
                disabled={!editable}
                error={error?.fields.defaultTimezone}
                hint="e.g. Asia/Kolkata"
                required
              />
            </div>
            {editable && (
              <div className="-mx-5 -mb-5 flex justify-end rounded-b-xl border-t border-slate-100 bg-slate-50/60 px-5 py-3">
                <Button type="submit" loading={pending}>
                  Save changes
                </Button>
              </div>
            )}
          </form>
        </Card>

        <div className="flex flex-col gap-6">
          <Card title="Public website" icon={Globe}>
            <p className="text-[13px] text-slate-500">
              Parents can view your pages and send inquiries here.
            </p>
            <a
              href={`/s/${tenant.slug}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium break-all text-brand-700 hover:underline"
            >
              /s/{tenant.slug}
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </a>
          </Card>
          <Card
            title="Campuses"
            icon={MapPin}
            actions={
              <Link
                href="/settings/campuses"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:text-brand-800"
              >
                Manage <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          >
            {campuses.loading && !campuses.data ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : active.length ? (
              <DescriptionList
                columns={1}
                items={active.slice(0, 4).map((c) => ({
                  label: `${c.code} · ${c.board}`,
                  value: c.name,
                }))}
              />
            ) : (
              <p className="text-sm text-slate-500">No campuses yet.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
