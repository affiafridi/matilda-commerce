'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { Button } from './primitives';

/** Modal confirmation on the native <dialog>: focus is trapped, Esc cancels, focus returns. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(92vw,440px)] rounded-md border border-line-strong bg-surface p-6 text-ink"
    >
      <h2 id="confirm-title" className="text-base font-semibold">
        {title}
      </h2>
      <div className="mt-2 text-[13px] text-ink-2">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
