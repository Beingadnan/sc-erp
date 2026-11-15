'use client';

import Link from 'next/link';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { LucideIcon } from 'lucide-react';
import { MoreHorizontal, Search, X } from 'lucide-react';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/* ------------------------------------------- buttons ------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Class names for anything that should look like a button (links, labels). */
export function buttonStyles(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return cx(
    'inline-flex items-center justify-center gap-1.5 rounded-[4px] font-semibold transition-colors whitespace-nowrap select-none',
    'disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400',
    'aria-disabled:pointer-events-none aria-disabled:opacity-50',
    size === 'sm' && 'h-7 min-w-16 px-2 text-xs',
    size === 'md' && 'h-8 min-w-20 px-3 text-sm',
    size === 'lg' && 'h-10 min-w-24 px-4 text-base',
    variant === 'primary' &&
      'border border-transparent bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800',
    variant === 'secondary' &&
      'border border-slate-300 bg-white text-slate-900 hover:border-[#c7c7c7] hover:bg-slate-100 active:bg-slate-200',
    variant === 'danger' &&
      'border border-transparent bg-[#c50f1f] text-white hover:bg-[#b10e1c] active:bg-[#960b18]',
    variant === 'ghost' &&
      'min-w-0 border border-transparent bg-transparent text-slate-800 hover:bg-slate-100 active:bg-slate-200',
  );
}

const iconSize = (size: ButtonSize) =>
  size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-5' : 'size-4';

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
}) {
  return (
    <button
      type={props.type ?? 'button'}
      {...props}
      disabled={props.disabled || loading}
      className={cx(buttonStyles(variant, size), className)}
    >
      {loading ? (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
      ) : (
        Icon && <Icon aria-hidden className={iconSize(size)} />
      )}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
  target?: string;
  rel?: string;
}) {
  return (
    <Link href={href} className={cx(buttonStyles(variant, size), className)} {...rest}>
      {Icon && <Icon aria-hidden className={iconSize(size)} />}
      {children}
    </Link>
  );
}

/* -------------------------------------------- fields -------------------------------------------- */

/** Fluent text field: thin border, darker bottom edge, blue underline when focused. */
const inputClass = (error?: string) =>
  cx(
    'h-8 rounded-[4px] border border-slate-300 bg-white px-2.5 text-sm text-slate-900 outline-none transition-colors',
    'placeholder:text-slate-500 hover:border-[#c7c7c7] disabled:bg-slate-50 disabled:text-slate-500',
    'pointer-coarse:h-11 pointer-coarse:text-base',
    error
      ? 'border-b-[#c50f1f] focus:shadow-[inset_0_-1px_0_#c50f1f]'
      : 'border-b-slate-600 hover:border-b-slate-700 focus:border-b-brand-600 focus:shadow-[inset_0_-1px_0_var(--color-brand-600)]',
  );

function Message({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (!error && !hint) return null;
  return (
    <p id={`${id}-msg`} className={cx('text-xs', error ? 'text-[#c50f1f]' : 'text-slate-600')}>
      {error ?? hint}
    </p>
  );
}

export function Field({
  label,
  error,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-slate-800">
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={inputClass(error)}
      />
      <Message id={id} error={error} hint={hint} />
    </div>
  );
}

export function TextareaField({
  label,
  error,
  hint,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-slate-800">
        {label}
      </label>
      <textarea
        id={id}
        {...props}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={cx(inputClass(error), 'h-auto py-2')}
      />
      <Message id={id} error={error} hint={hint} />
    </div>
  );
}

export function SelectField({
  label,
  error,
  hint,
  children,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-slate-800">
        {label}
      </label>
      <select
        id={id}
        {...props}
        aria-invalid={Boolean(error)}
        className={cx(inputClass(error), 'px-2.5')}
      >
        {children}
      </select>
      <Message id={id} error={error} hint={hint} />
    </div>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: ReactNode;
  description?: ReactNode;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('flex items-start gap-2 text-sm text-slate-800', className)}>
      <input
        id={id}
        type="checkbox"
        {...props}
        className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600/30"
      />
      <span>
        {label}
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <div>
        <label htmlFor={id} className="text-sm font-semibold text-slate-800">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative inline-flex h-5 w-10 shrink-0 items-center rounded-full border transition disabled:opacity-50',
          checked ? 'border-brand-600 bg-brand-600' : 'border-slate-600 bg-white',
        )}
      >
        <span
          className={cx(
            'inline-block size-3.5 rounded-full transition',
            checked ? 'translate-x-[22px] bg-white' : 'translate-x-[3px] bg-slate-600',
          )}
        />
      </button>
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  className,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={cx('relative', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
      />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cx(inputClass(), 'w-full pl-9')}
      />
    </div>
  );
}

/* ------------------------------------------- layout -------------------------------------------- */

export function Card({
  title,
  description,
  actions,
  icon: Icon,
  flush,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  /** No padding around the content (for tables and lists that run edge to edge). */
  flush?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex items-start gap-2.5">
            {Icon && <Icon aria-hidden className="mt-0.5 size-4 text-slate-500" />}
            <div>
              {title && (
                <h2 className="text-base leading-6 font-semibold text-slate-900">{title}</h2>
              )}
              {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
            </div>
          </div>
          {actions}
        </header>
      )}
      <div className={flush ? '' : 'p-4 sm:p-5'}>{children}</div>
    </section>
  );
}

export function SectionTitle({
  children,
  description,
  actions,
  className,
}: {
  children: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('mb-3 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{children}</h3>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex flex-wrap items-end gap-3', className)}>{children}</div>;
}

export function DescriptionList({
  items,
  columns = 2,
  className,
}: {
  items: Array<{ label: ReactNode; value: ReactNode }>;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <dl
      className={cx(
        'grid gap-x-6 gap-y-3 text-sm',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-3',
        className,
      )}
    >
      {items.map((it, i) => (
        <div key={i}>
          <dt className="text-xs text-slate-500">{it.label}</dt>
          <dd className="mt-0.5 font-medium text-slate-900">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Alert({
  tone = 'error',
  children,
  className,
  action,
}: {
  tone?: 'error' | 'info' | 'success' | 'warning';
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'rounded-[4px] border px-3 py-2 text-sm text-slate-900',
        tone === 'error' && 'border-[#eeacb2] bg-[#fdf3f4]',
        tone === 'info' && 'border-slate-200 bg-slate-50',
        tone === 'success' && 'border-[#9fd89f] bg-[#f1faf1]',
        tone === 'warning' && 'border-[#fdcfb4] bg-[#fff9f5]',
        Boolean(action) && 'flex flex-wrap items-center justify-between gap-3',
        className,
      )}
    >
      {action ? <div>{children}</div> : children}
      {action}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  dot,
  children,
  className,
}: {
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue';
  /** A small coloured dot before the text. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'neutral' && 'bg-slate-100 text-slate-700',
        tone === 'green' && 'bg-[#f1faf1] text-[#0e700e]',
        tone === 'amber' && 'bg-[#fff9f5] text-[#bc4b09]',
        tone === 'red' && 'bg-[#fdf3f4] text-[#b10e1c]',
        tone === 'blue' && 'bg-brand-50 text-brand-700',
        className,
      )}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
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

export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div aria-busy="true" className={cx('animate-pulse rounded-xl bg-slate-100', className)} />
  );
}

export function EmptyState({
  title,
  icon: Icon,
  action,
  description,
  compact,
  children,
  className,
}: {
  title: string;
  /** Less padding, for empty states inside a card. */
  compact?: boolean;
  icon?: LucideIcon;
  action?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white px-6 text-center',
        compact ? 'py-6' : 'py-10',
        className,
      )}
    >
      {Icon && (
        <span className="mb-2 grid size-10 place-items-center rounded-full bg-slate-100 text-slate-500">
          <Icon aria-hidden className="size-5" />
        </span>
      )}
      <p className="font-medium">{title}</p>
      {(description || children) && (
        <div className="text-sm text-slate-500">{description ?? children}</div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Table({
  head,
  children,
  className,
}: {
  head: ReactNode[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-600">
            {head.map((h, i) => (
              <th key={i} scope="col" className="h-9 px-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 [&>tr]:transition-colors [&>tr:hover]:bg-slate-50">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx('h-11 px-3 py-2 align-middle', className)}>{children}</td>
);

export const PageHeader = ({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) => (
  <div className={cx('mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
    <div className="min-w-0">
      <h1 className="text-2xl leading-8 font-semibold text-slate-900">{title}</h1>
      {description && <div className="mt-1 max-w-3xl text-sm text-slate-600">{description}</div>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

/* --------------------------------------- menus and dialogs --------------------------------------- */

export interface ActionMenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void | Promise<void>;
  hidden?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <div ref={box} className="relative inline-block">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {visible.map(({ label: l, icon: Icon, onClick, disabled, danger }) => (
            <button
              key={l}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                void onClick();
              }}
              className={cx(
                'flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-sm disabled:opacity-50',
                danger ? 'text-[#b10e1c] hover:bg-[#fdf3f4]' : 'text-slate-800 hover:bg-slate-100',
              )}
            >
              {Icon && <Icon aria-hidden className="size-4" />}
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          'relative flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-xl leading-7 font-semibold">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/** Ask before a destructive action. Resolves true when confirmed. */
export function confirmAction({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
}: {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (ok: boolean) => {
      resolve(ok);
      root.unmount();
      host.remove();
    };
    root.render(
      <Modal
        open
        size="sm"
        title={title}
        onClose={() => done(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => done(false)}>
              {cancelLabel}
            </Button>
            <Button variant={tone} autoFocus onClick={() => done(true)}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      </Modal>,
    );
  });
}

/* -------------------------------------------- toasts -------------------------------------------- */

type ToastTone = 'success' | 'error' | 'info';
let toastHost: HTMLDivElement | null = null;

function showToast(tone: ToastTone, text: string) {
  if (typeof document === 'undefined') return;
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.setAttribute('aria-live', 'polite');
    toastHost.className =
      'pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4';
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.className = cx(
    'pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg transition-opacity duration-300',
    tone === 'success' && 'bg-[#242424] text-white',
    tone === 'error' && 'bg-[#b10e1c] text-white',
    tone === 'info' && 'bg-[#242424] text-white',
  );
  el.textContent = text;
  toastHost.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

export const toast = {
  success: (text: string) => showToast('success', text),
  error: (text: string) => showToast('error', text),
  info: (text: string) => showToast('info', text),
};
