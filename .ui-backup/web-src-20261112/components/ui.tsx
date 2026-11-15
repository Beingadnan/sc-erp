'use client';

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { useId } from 'react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'secondary' &&
          'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        variant === 'ghost' && 'text-slate-700 hover:bg-slate-100',
        className,
      )}
    >
      {loading && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
      )}
      {children}
    </button>
  );
}

export function Field({
  label,
  error,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={cx(
          'h-9 rounded-lg border bg-white px-3 text-sm shadow-xs outline-none transition',
          'focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20',
          error ? 'border-red-400' : 'border-slate-300',
        )}
      />
      {(error || hint) && (
        <p id={`${id}-msg`} className={cx('text-xs', error ? 'text-red-600' : 'text-slate-500')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  error,
  children,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <select
        id={id}
        {...props}
        className={cx(
          'h-9 rounded-lg border bg-white px-2.5 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20',
          error ? 'border-red-400' : 'border-slate-300',
        )}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-xs', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'info' | 'success' | 'warning';
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded-lg border px-3.5 py-2.5 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-800',
        tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue';
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-slate-100 text-slate-700',
        tone === 'green' && 'bg-emerald-50 text-emerald-700',
        tone === 'amber' && 'bg-amber-50 text-amber-800',
        tone === 'red' && 'bg-red-50 text-red-700',
        tone === 'blue' && 'bg-brand-50 text-brand-700',
      )}
    >
      {children}
    </span>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children: ReactNode; className?: string }) => (
  <td className={cx('px-3 py-2.5 align-top', className)}>{children}</td>
);

export const PageHeader = ({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
    </div>
    {actions}
  </div>
);
