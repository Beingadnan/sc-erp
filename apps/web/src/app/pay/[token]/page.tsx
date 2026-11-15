'use client';

import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { upload } from '@/lib/api';
import type { PublicPayView } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/use-api';
import { RupeeField, inr } from '@/components/fees/money';
import { UpiQr } from '@/components/fees/upi-qr';
import { Alert, Badge, Button, Field, SelectField, Skeleton, buttonStyles } from '@/components/ui';

const PROOF_TONE = { pending: 'amber', approved: 'green', rejected: 'red' } as const;
const PROOF_LABEL = {
  pending: 'Being checked',
  approved: 'Received',
  rejected: 'Not accepted',
} as const;

function Copy({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="truncate font-medium">{value}</div>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
        onClick={async () => {
          await navigator.clipboard?.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export default function PayPage() {
  const { token } = useParams<{ token: string }>();
  const view = useApi<PublicPayView>(`/public/pay/${token}`);
  const v = view.data;

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-8">
      <div className="mx-auto flex max-w-lg flex-col gap-5">
        {view.error ? (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold">Payment link not found</h1>
            <p className="mt-1 text-sm text-slate-600">
              Check that you opened the full link, or ask the school office for a new one.
            </p>
          </div>
        ) : !v ? (
          <Skeleton rows={8} />
        ) : (
          <>
            <header className="rounded-2xl bg-brand-600 p-6 text-white shadow-sm">
              <p className="text-sm/5 opacity-90">
                {v.school} · {v.campus}
              </p>
              <h1 className="mt-1 text-xl font-semibold">
                Fees for {v.studentFirstName} ({v.className})
              </h1>
              <p className="mt-4 text-3xl font-bold tabular-nums">{inr(v.amount)}</p>
              {v.note && <p className="mt-1 text-sm opacity-90">{v.note}</p>}
              {v.status === 'open' && (
                <p className="mt-2 text-xs opacity-80">Link valid till {formatDate(v.expiresAt)}</p>
              )}
            </header>

            {v.status === 'paid' && (
              <Alert tone="success">Thank you — the school has received this payment.</Alert>
            )}
            {v.status === 'expired' && (
              <Alert tone="warning">
                This link has expired. Ask the school office for a new one.
              </Alert>
            )}
            {v.status === 'cancelled' && (
              <Alert tone="warning">
                The school cancelled this link. Ask the office for a new one.
              </Alert>
            )}

            {v.payTo && (
              <section className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="font-semibold">1. Pay the school</h2>
                {(v.payTo.qrUrl || v.payTo.upiUri) && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    {v.payTo.upiUri ? (
                      <UpiQr uri={v.payTo.upiUri} size={200} />
                    ) : (
                      <img
                        src={v.payTo.qrUrl!}
                        alt="School payment QR"
                        className="max-h-60 rounded-lg border"
                      />
                    )}
                    <p className="text-center text-xs text-slate-500">
                      Scan with any UPI app (GPay, PhonePe, Paytm, BHIM).
                      {v.payTo.upiUri && ' The amount is filled in for you.'}
                    </p>
                    {v.payTo.upiUri && (
                      <a href={v.payTo.upiUri} className={buttonStyles('primary')}>
                        Open UPI app
                      </a>
                    )}
                    {v.payTo.upiUri && v.payTo.qrUrl && (
                      <a
                        className="text-xs text-brand-700 underline"
                        href={v.payTo.qrUrl}
                        target="_blank"
                        rel="noopener"
                      >
                        Show the school’s own QR instead
                      </a>
                    )}
                  </div>
                )}
                <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                  <Copy label="UPI ID" value={v.payTo.upiId} />
                  <Copy label="Account name" value={v.payTo.bankAccountName || v.payTo.payeeName} />
                  <Copy label="Account number" value={v.payTo.bankAccountNumber} />
                  <Copy label="IFSC" value={v.payTo.ifsc} />
                  {(v.payTo.bankName || v.payTo.branch) && (
                    <div className="py-2 text-xs text-slate-500">
                      {[v.payTo.bankName, v.payTo.branch].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
                {v.payTo.instructions && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {v.payTo.instructions}
                  </p>
                )}
              </section>
            )}

            {v.payTo && <ProofForm token={token} v={v} onDone={view.reload} />}

            {v.proofs.length > 0 && (
              <section className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="font-semibold">Your uploads</h2>
                <ul className="mt-3 divide-y divide-slate-100 text-sm">
                  {v.proofs.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3 py-2">
                      <div>
                        <div className="font-medium tabular-nums">{inr(p.amount)}</div>
                        <div className="font-mono text-xs text-slate-500">{p.reference}</div>
                        {p.note && <div className="text-xs text-red-700">{p.note}</div>}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge tone={PROOF_TONE[p.status]}>{PROOF_LABEL[p.status]}</Badge>
                        {p.receiptNumber && (
                          <a
                            className="text-xs text-brand-700 underline"
                            href={`/api/v1/public/pay/${token}/receipts/${p.id}`}
                            target="_blank"
                            rel="noopener"
                          >
                            Receipt {p.receiptNumber}
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-center text-xs text-slate-400">
              Pay only to the account shown above. The school issues a receipt after checking the
              payment.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function ProofForm({ token, v, onDone }: { token: string; v: PublicPayView; onDone: () => void }) {
  const [amount, setAmount] = useState<number | null>(v.amount);
  const [file, setFile] = useState<File | null>(null);
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const act = useAction();
  const f = act.error?.fields ?? {};

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="font-semibold">2. Upload the payment screenshot</h2>
      <p className="mt-1 text-sm text-slate-600">
        After paying, upload the screenshot and enter the UTR / transaction ID shown in your app.
      </p>
      {sent && (
        <div className="mt-3">
          <Alert tone="success">
            Uploaded. The school will check it and send the receipt here.
          </Alert>
        </div>
      )}
      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          data.set('amount', String(amount ?? ''));
          if (file) data.set('file', file);
          const r = await act.run(() => upload(`/public/pay/${token}/proof`, data));
          if (r) {
            setSent(true);
            setFile(null);
            form.reset();
            onDone();
          }
        }}
      >
        <RupeeField
          label="Amount paid"
          value={amount}
          onChange={setAmount}
          error={f.amount}
          required
        />
        <SelectField label="Paid by" name="mode" defaultValue="upi">
          <option value="upi">UPI</option>
          <option value="bank_transfer">Bank transfer (NEFT / IMPS / RTGS)</option>
        </SelectField>
        <Field
          label="UTR / transaction ID"
          name="reference"
          required
          autoComplete="off"
          placeholder="e.g. 412356789012"
          error={f.reference}
        />
        <Field
          label="Date paid"
          name="paidOn"
          type="date"
          defaultValue={v.today}
          max={v.today}
          required
          error={f.paidOn}
        />
        <Field
          label="Your name"
          name="payerName"
          required
          autoComplete="name"
          error={f.payerName}
        />
        <Field
          label="Mobile (optional)"
          name="payerPhone"
          inputMode="tel"
          autoComplete="tel"
          error={f.payerPhone}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-800">Screenshot</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5"
            required
          />
          <span className="text-xs text-slate-500">JPG, PNG or PDF, up to 5 MB.</span>
          {f.file && <span className="text-xs text-red-600">{f.file}</span>}
        </div>
        {act.error && <Alert>{act.error.message}</Alert>}
        <Button type="submit" loading={act.pending}>
          Send to school
        </Button>
      </form>
    </section>
  );
}
