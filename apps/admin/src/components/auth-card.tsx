import type { ReactNode } from 'react';
import { Alert } from './ui/primitives';

/** Wordmark. The official logo file is not in the repository yet; replace this text when it is. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`text-[15px] font-semibold tracking-tight text-ink ${className ?? ''}`}>
      Matilda Commerce
    </span>
  );
}

/** One centred panel, shared by every sign-in related screen. */
export function AuthCard({
  title,
  lede,
  children,
  footer,
}: {
  title: string;
  lede?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-6 text-center">
        <Wordmark />
      </div>
      <div className="rounded-md border border-line bg-surface p-6">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {lede && <p className="mb-5 mt-1 text-[13px] text-muted">{lede}</p>}
        {!lede && <div className="mb-5" />}
        {children}
      </div>
      {footer && <div className="mt-4 text-center text-[13px] text-muted">{footer}</div>}
    </div>
  );
}

/** Server rejections of a new password list what to fix, one line each. */
export function PasswordProblems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <Alert tone="danger" className="mb-3">
      <p className="font-medium">Choose a stronger password:</p>
      <ul className="ms-4 mt-1 list-disc">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </Alert>
  );
}
