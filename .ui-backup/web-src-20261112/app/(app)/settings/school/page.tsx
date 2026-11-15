'use client';

import { useState } from 'react';
import { patch } from '@/lib/api';
import { useAction, onSubmitForm } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { Alert, Button, Card, Field, PageHeader } from '@/components/ui';

export default function SchoolProfilePage() {
  const { tenant, can, reload } = useSession();
  const { pending, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const editable = can('settings.manage');

  if (!tenant) return <Alert tone="info">Choose a school first.</Alert>;

  const submit = async (form: FormData) => {
    setSaved(false);
    const ok = await run(() =>
      patch('/tenant', { name: form.get('name'), defaultTimezone: form.get('defaultTimezone') }),
    );
    if (ok) {
      setSaved(true);
      await reload();
    }
  };

  return (
    <>
      <PageHeader title="School profile" description="Basic details shared by all campuses." />
      <Card>
        <form onSubmit={onSubmitForm(submit)} className="flex max-w-lg flex-col gap-4">
          {error && <Alert>{error.message}</Alert>}
          {saved && <Alert tone="success">Saved.</Alert>}
          <Field
            label="School name"
            name="name"
            defaultValue={tenant.name}
            disabled={!editable}
            error={error?.fields.name}
          />
          <Field
            label="School address"
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
          />
          {editable && (
            <div>
              <Button type="submit" loading={pending}>
                Save changes
              </Button>
            </div>
          )}
        </form>
      </Card>
    </>
  );
}
