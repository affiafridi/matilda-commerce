'use client';

import { ChevronDown, X } from 'lucide-react';
import Link from 'next/link';
import {
  type ReactNode,
  type SelectHTMLAttributes,
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Button, cx } from './primitives';

/* ------------------------------------------------------------------ page chrome */

export function PageHeader({
  title,
  crumbs,
  actions,
  status,
}: {
  title: string;
  crumbs?: Array<{ label: string; href?: string }>;
  actions?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1 text-xs text-muted">
          <ol className="flex flex-wrap items-center gap-1">
            {crumbs.map((c, i) => (
              <li key={c.label} className="flex items-center gap-1">
                {c.href ? (
                  <Link href={c.href} className="hover:text-ink hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
                {i < crumbs.length - 1 && <span aria-hidden>/</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {status}
        <div className="flex-1" />
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

const TAG_TONE: Record<string, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
  off: 'bg-sunken text-muted',
};

const STATUS_TONE: Record<string, keyof typeof TAG_TONE> = {
  ACTIVE: 'ok',
  SUCCESS: 'ok',
  INVITED: 'warn',
  DRAFT: 'warn',
  DENIED: 'warn',
  DELETION_REQUESTED: 'warn',
  SUSPENDED: 'danger',
  FAILED: 'danger',
  INACTIVE: 'off',
  DEACTIVATED: 'off',
};

/** Status is always a word; colour only reinforces it. */
export function StatusTag({ value, label }: { value: string; label?: string }) {
  const tone = STATUS_TONE[value] ?? 'off';
  const text = label ?? value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');
  return (
    <span
      className={cx('inline-block rounded-sm px-1.5 py-px text-xs font-medium', TAG_TONE[tone])}
    >
      {text}
    </span>
  );
}

/* ------------------------------------------------------------------ table */

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Visually hide the header (e.g. an actions column) while keeping it for screen readers. */
  hideHeader?: boolean;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
}: {
  caption: string;
  columns: Array<Column<T>>;
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full min-w-[40rem] border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-sunken text-xs text-ink-2">
            {columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={cx('h-9 whitespace-nowrap px-3 text-start font-semibold', c.className)}
              >
                <span className={c.hideHeader ? 'sr-only' : undefined}>{c.header}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading &&
            [0, 1, 2].map((i) => (
              <tr key={i} className="border-b border-line last:border-b-0" aria-hidden>
                {columns.map((c) => (
                  <td key={c.id} className="h-10 px-3">
                    <span className="block h-3 w-3/4 bg-sunken" />
                  </td>
                ))}
              </tr>
            ))}
          {loading && (
            <tr className="sr-only">
              <td>Loading {caption.toLowerCase()}</td>
            </tr>
          )}
          {!loading && error && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6">
                <p className="font-medium text-danger" role="alert">
                  {error}
                </p>
                {onRetry && (
                  <Button className="mt-3" onClick={onRetry}>
                    Try again
                  </Button>
                )}
              </td>
            </tr>
          )}
          {!loading && !error && rows?.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-muted">
                {empty}
              </td>
            </tr>
          )}
          {!loading &&
            !error &&
            rows?.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-line last:border-b-0 hover:bg-canvas"
              >
                {columns.map((c) => (
                  <td key={c.id} className={cx('h-10 px-3 align-middle', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between py-3 text-[13px] text-muted">
      <span>
        {from} to {to} of {total}
      </span>
      <div className="flex gap-2">
        <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button disabled={to >= total} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ form controls */

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hideLabel?: boolean;
  error?: string | undefined;
  help?: string | undefined;
  compact?: boolean;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hideLabel, error, help, compact, className, children, ...rest },
  ref,
) {
  const id = useId();
  return (
    <div className={compact ? '' : 'mt-4 first:mt-0'}>
      <label
        htmlFor={id}
        className={cx('mb-1 block text-[13px] font-medium text-ink', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <div className="relative">
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : help ? `${id}-help` : undefined}
          className={cx(
            'h-9 w-full appearance-none rounded-md border bg-surface ps-3 pe-8 text-sm text-ink disabled:bg-sunken disabled:text-muted',
            error ? 'border-danger' : 'border-line-strong',
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          size={14}
          aria-hidden
          className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
      {help && !error && (
        <p id={`${id}-help`} className="mt-1 text-xs text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
});

export function Checkbox({
  label,
  help,
  ...rest
}: { label: string; help?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <div className="mt-4 flex items-start gap-2">
      <input id={id} type="checkbox" className="mt-0.5 size-4" {...rest} />
      <label htmlFor={id} className="text-[13px] text-ink">
        {label}
        {help && <span className="block text-xs text-muted">{help}</span>}
      </label>
    </div>
  );
}

/** Search box that waits for a pause in typing before it reports a value. */
export function SearchBox({
  label,
  placeholder,
  onSearch,
}: {
  label: string;
  placeholder: string;
  onSearch: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const callback = useRef(onSearch);
  useEffect(() => {
    callback.current = onSearch;
  });
  useEffect(() => {
    const t = setTimeout(() => callback.current(value.trim()), 300);
    return () => clearTimeout(t);
  }, [value]);
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-64 max-w-full rounded-md border border-line-strong bg-surface px-3 text-sm placeholder:text-muted"
      />
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-end gap-2">{children}</div>;
}

/* ------------------------------------------------------------------ drawer */

/** Side panel on the native <dialog>: focus is trapped, Esc closes, focus returns to the trigger. */
export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 ms-auto h-dvh max-h-dvh w-[min(100vw,440px)] border-s border-line-strong bg-surface p-0 text-ink"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-5">
            <h2 id={titleId} className="text-[15px] font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-8 items-center justify-center rounded-md hover:bg-sunken"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && (
            <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 id={id} className="text-[13px] font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Label/value pairs for read-only detail blocks. */
export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-y-2 rounded-md border border-line bg-surface p-4 text-[13px]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
