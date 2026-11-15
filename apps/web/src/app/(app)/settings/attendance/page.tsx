'use client';

import { useState } from 'react';
import { put } from '@/lib/api';
import type { AttendanceSettings } from '@/lib/api';
import { onSubmitForm, useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useCampus } from '@/components/academic/campus-picker';
import { Alert, Button, Card, Field, PageHeader, SelectField, Skeleton } from '@/components/ui';

export default function AttendanceSettingsPage() {
  const { can } = useSession();
  const { campus, picker } = useCampus();
  const data = useApi<AttendanceSettings>(
    campus ? `/attendance/settings?campusId=${campus.id}` : null,
  );
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const editable = campus ? can('attendance.correct', campus.id) : false;
  const s = data.data;
  const f = action.error?.fields ?? {};

  return (
    <>
      <PageHeader
        title="Attendance settings"
        description="How registers are taken on this campus."
        actions={picker}
      />
      {data.error && <Alert>{data.error.message}</Alert>}
      {!s ? (
        <Skeleton rows={5} />
      ) : (
        <Card>
          <form
            key={campus?.id}
            className="flex max-w-xl flex-col gap-5"
            onSubmit={onSubmitForm(async (form) => {
              setSaved(false);
              const ok = await action.run(() =>
                put(`/attendance/settings?campusId=${campus!.id}`, {
                  mode: form.get('mode'),
                  periodsPerDay: Number(form.get('periodsPerDay') ?? s.periodsPerDay),
                  cutoffHours: Number(form.get('cutoffHours')),
                  lowThreshold: Number(form.get('lowThreshold')),
                  leaveCountsAs: form.get('leaveCountsAs'),
                }),
              );
              if (ok) {
                setSaved(true);
                await data.reload();
              }
            })}
          >
            <fieldset disabled={!editable} className="flex flex-col gap-5">
              <SelectField
                label="Registers"
                name="mode"
                defaultValue={s.mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="daily">Once a day (class teacher)</option>
                <option value="period">Every period</option>
              </SelectField>
              {(mode ?? s.mode) === 'period' && (
                <Field
                  label="Periods per day"
                  name="periodsPerDay"
                  type="number"
                  min={1}
                  max={12}
                  required
                  defaultValue={s.periodsPerDay}
                  error={f.periodsPerDay}
                />
              )}
              <Field
                label="Changes allowed for (hours)"
                name="cutoffHours"
                type="number"
                min={0}
                max={168}
                required
                defaultValue={s.cutoffHours}
                error={f.cutoffHours}
                hint="After this many hours from first taking a register, changes need the “correct attendance” right and a reason."
              />
              <Field
                label="Low attendance below (%)"
                name="lowThreshold"
                type="number"
                min={1}
                max={100}
                required
                defaultValue={s.lowThreshold}
                error={f.lowThreshold}
                hint="CBSE generally expects 75% attendance to sit board exams."
              />
              <SelectField
                label="Approved leave in percentages"
                name="leaveCountsAs"
                defaultValue={s.leaveCountsAs}
              >
                <option value="excluded">Leave days are not counted</option>
                <option value="absent">Leave days count as absent</option>
              </SelectField>
            </fieldset>
            {!editable && (
              <Alert tone="info">
                Only staff who can correct attendance can change these settings.
              </Alert>
            )}
            {action.error && !Object.keys(f).length && <Alert>{action.error.message}</Alert>}
            {saved && <Alert tone="success">Settings saved.</Alert>}
            {editable && (
              <div>
                <Button type="submit" loading={action.pending}>
                  Save settings
                </Button>
              </div>
            )}
          </form>
        </Card>
      )}
    </>
  );
}
