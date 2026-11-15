'use client';

import { useEffect, useRef, useState } from 'react';
import { upiPayUri } from '@school-erp/validation';
import { del, put, upload } from '@/lib/api';
import type { PaymentSettings } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useApi } from '@/lib/use-api';
import { useCampus } from '@/components/academic/campus-picker';
import { Alert, Button, Card, Field, PageHeader, Skeleton } from '@/components/ui';
import { UpiQr } from '@/components/fees/upi-qr';

const EMPTY = {
  enabled: true,
  payeeName: '',
  upiId: '',
  bankAccountName: '',
  bankAccountNumber: '',
  ifsc: '',
  bankName: '',
  branch: '',
  instructions: '',
};

export default function PaymentDetailsPage() {
  const { campus, picker } = useCampus();
  const { can } = useSession();
  const res = useApi<{ settings: PaymentSettings | null }>(
    campus ? `/fees/payment-settings?campusId=${campus.id}` : null,
  );
  const s = res.data?.settings ?? null;
  const [form, setForm] = useState(EMPTY);
  const save = useAction();
  const qr = useAction();
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editable = !!campus && can('settings.manage', campus.id);

  useEffect(() => {
    if (!res.data) return;
    setForm(
      s
        ? {
            ...EMPTY,
            ...Object.fromEntries(
              Object.keys(EMPTY).map((k) => [k, s[k as keyof PaymentSettings]]),
            ),
          }
        : EMPTY,
    );
  }, [res.data]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: k === 'enabled' ? e.target.checked : e.target.value }));
  };
  const err = save.error?.fields ?? {};

  return (
    <>
      <PageHeader
        title="Payment details"
        description="The school bank account and UPI ID shown to parents on payment links. Parents pay directly and upload a screenshot; your staff check it before a receipt is issued."
        actions={picker}
      />
      {res.error && <Alert>{res.error.message}</Alert>}
      {!res.data ? (
        <Skeleton rows={6} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card
            title="Where parents pay"
            description="Changing these details is recorded in the audit log. Double-check the account number and IFSC."
          >
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!campus) return;
                const r = await save.run(() =>
                  put<{ settings: PaymentSettings }>('/fees/payment-settings', {
                    campusId: campus.id,
                    ...form,
                  }),
                );
                if (r) {
                  setSaved(true);
                  res.setData(r);
                }
              }}
            >
              <fieldset disabled={!editable} className="contents">
                <Field
                  label="Pay to (name shown to parents)"
                  value={form.payeeName}
                  onChange={set('payeeName')}
                  error={err.payeeName}
                  required
                  className="sm:col-span-2"
                />
                <Field
                  label="UPI ID"
                  placeholder="school@okhdfcbank"
                  value={form.upiId}
                  onChange={set('upiId')}
                  error={err.upiId}
                  className="sm:col-span-2"
                />
                <Field
                  label="Account holder name"
                  value={form.bankAccountName}
                  onChange={set('bankAccountName')}
                  error={err.bankAccountName}
                />
                <Field
                  label="Account number"
                  inputMode="numeric"
                  value={form.bankAccountNumber}
                  onChange={set('bankAccountNumber')}
                  error={err.bankAccountNumber}
                />
                <Field label="IFSC" value={form.ifsc} onChange={set('ifsc')} error={err.ifsc} />
                <Field label="Bank" value={form.bankName} onChange={set('bankName')} />
                <Field label="Branch" value={form.branch} onChange={set('branch')} />
                <Field
                  label="Note for parents"
                  placeholder="e.g. Write the admission number in the remarks"
                  value={form.instructions}
                  onChange={set('instructions')}
                  className="sm:col-span-2"
                />
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" checked={form.enabled} onChange={set('enabled')} />
                  Accept payments through payment links
                </label>
              </fieldset>
              <div className="flex flex-col gap-3 sm:col-span-2">
                {save.error && <Alert>{save.error.message}</Alert>}
                {saved && <Alert tone="success">Payment details saved.</Alert>}
                {!editable && (
                  <Alert tone="info">Only school administrators can change payment details.</Alert>
                )}
                {editable && (
                  <div>
                    <Button type="submit" loading={save.pending}>
                      Save details
                    </Button>
                  </div>
                )}
              </div>
            </form>
          </Card>

          <Card
            title="QR code"
            description="Upload the QR from your bank, or we make a UPI QR with the amount filled in."
          >
            <div className="flex flex-col items-center gap-3">
              {s?.qrUrl ? (
                <img src={s.qrUrl} alt="School QR code" className="max-h-56 rounded-lg border" />
              ) : s?.upiId ? (
                <>
                  <UpiQr uri={upiPayUri({ upiId: s.upiId, payeeName: s.payeeName })} />
                  <p className="text-center text-xs text-slate-500">
                    Generated from the UPI ID. Payment links add the amount.
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-500">Save a UPI ID or upload a QR image.</p>
              )}
              {qr.error && <Alert>{qr.error.message}</Alert>}
              {editable && s && (
                <div className="flex gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f || !campus) return;
                      const form = new FormData();
                      form.set('file', f);
                      const r = await qr.run(() =>
                        upload<{ settings: PaymentSettings }>(
                          `/fees/payment-settings/qr?campusId=${campus.id}`,
                          form,
                        ),
                      );
                      if (r) res.setData(r);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    variant="secondary"
                    loading={qr.pending}
                    onClick={() => fileRef.current?.click()}
                  >
                    {s.hasQrImage ? 'Replace QR image' : 'Upload QR image'}
                  </Button>
                  {s.hasQrImage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (!campus) return;
                        const r = await qr.run(() =>
                          del<{ settings: PaymentSettings }>(
                            `/fees/payment-settings/qr?campusId=${campus.id}`,
                          ),
                        );
                        if (r) res.setData(r);
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
