'use client';

import { Eye, EyeOff } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  forwardRef,
  useId,
  useState,
} from 'react';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

const BUTTON_BASE =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-action bg-action text-action-ink hover:bg-action-hover',
  secondary: 'border-line-strong bg-surface text-ink hover:bg-sunken',
  quiet: 'border-transparent bg-transparent text-ink-2 hover:bg-sunken',
  danger: 'border-line-strong bg-surface text-danger hover:bg-danger-bg',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows a busy state and blocks repeat submits while a request is in flight. */
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', busy = false, className, disabled, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)}
      {...rest}
    >
      {children}
    </button>
  );
});

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string | undefined;
  help?: string | undefined;
}

/** Labelled text input. The error and help text are tied to the input for screen readers. */
export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { label, error, help, className, type = 'text', ...rest },
  ref,
) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [error ? `${id}-err` : null, help ? `${id}-help` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="mt-4 first:mt-0">
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={isPassword && shown ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cx(
            'h-9 w-full rounded-md border bg-surface px-3 text-sm text-ink placeholder:text-muted disabled:bg-sunken disabled:text-muted',
            error ? 'border-danger' : 'border-line-strong',
            isPassword && 'pe-10',
            className,
          )}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            className="absolute inset-y-0 end-0 flex w-9 items-center justify-center rounded-e-md text-muted hover:text-ink"
          >
            {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </button>
        )}
      </div>
      {help && (
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

type AlertTone = 'danger' | 'warn' | 'ok' | 'info';
const ALERT_TONE: Record<AlertTone, string> = {
  danger: 'border-danger bg-danger-bg text-danger',
  warn: 'border-warn bg-warn-bg text-warn',
  ok: 'border-ok bg-ok-bg text-ok',
  info: 'border-line-strong bg-sunken text-ink-2',
};

/** Inline message. Errors are announced immediately; everything else politely. */
export function Alert({
  tone = 'info',
  children,
  className,
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('rounded-md border-s-4 px-3 py-2 text-[13px]', ALERT_TONE[tone], className)}
    >
      {children}
    </div>
  );
}

/** Six-digit code (or recovery code) input; the browser can fill it from an SMS-free authenticator hint. */
export const CodeField = forwardRef<
  HTMLInputElement,
  Omit<FieldProps, 'type' | 'inputMode' | 'autoComplete'> & { recovery?: boolean }
>(function CodeField({ recovery = false, ...rest }, ref) {
  return (
    <TextField
      ref={ref}
      inputMode={recovery ? 'text' : 'numeric'}
      autoComplete="one-time-code"
      autoCapitalize="off"
      spellCheck={false}
      maxLength={recovery ? 32 : 6}
      className="font-mono tracking-[0.25em]"
      {...rest}
    />
  );
});

export function PageTitle({ title, lede }: { title: string; lede?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      {lede && <p className="mt-1 text-[13px] text-muted">{lede}</p>}
    </div>
  );
}

export { cx };
