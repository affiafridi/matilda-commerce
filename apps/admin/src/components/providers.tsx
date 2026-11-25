'use client';

import { ApiError } from '@matilda/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { SESSION_KEY, errorMessage } from '@/lib/auth';
import { handlers, http } from '@/lib/http';
import { Alert, Button, CodeField } from './ui/primitives';

/**
 * App-wide client state: the query cache, the "session ended" redirect and the step-up dialog
 * that sensitive actions open when the API asks for a fresh 2FA code.
 */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }),
  );
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    handlers.onUnauthenticated = () => {
      http.setCsrf(null);
      queryClient.clear();
      queryClient.setQueryData(SESSION_KEY, null);
      const here = window.location.pathname + window.location.search;
      const onAuthScreen = here.startsWith('/sign-in') || here.startsWith('/accept-invite');
      router.replace(onAuthScreen ? '/sign-in' : `/sign-in?next=${encodeURIComponent(here)}`);
    };
    handlers.requestStepUp = () =>
      new Promise<boolean>((resolve) => {
        pending.current?.(false);
        pending.current = resolve;
        setStepUpOpen(true);
      });
    return () => {
      handlers.onUnauthenticated = null;
      handlers.requestStepUp = null;
    };
  }, [queryClient, router]);

  const finishStepUp = (ok: boolean) => {
    setStepUpOpen(false);
    pending.current?.(ok);
    pending.current = null;
  };

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <StepUpDialog open={stepUpOpen} onDone={finishStepUp} />
    </QueryClientProvider>
  );
}

function StepUpDialog({ open, onDone }: { open: boolean; onDone: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setCode('');
      setError(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await http.post('/admin/auth/step-up', { code: code.trim() }, { redirectOn401: false });
      onDone(true);
    } catch (e) {
      if (e instanceof ApiError && e.body?.code === 'UNAUTHENTICATED')
        handlers.onUnauthenticated?.();
      setError(
        e instanceof ApiError && e.status === 401
          ? 'That code is not valid or has expired.'
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="step-up-title"
      onCancel={(e) => {
        e.preventDefault();
        onDone(false);
      }}
      className="m-auto w-[min(92vw,400px)] rounded-md border border-line-strong bg-surface p-6 text-ink"
    >
      <form onSubmit={submit} noValidate>
        <h2 id="step-up-title" className="text-base font-semibold">
          Confirm it is you
        </h2>
        <p className="mb-4 mt-1 text-[13px] text-muted">
          Enter the 6-digit code from your authenticator app to continue. It stays valid for 10
          minutes.
        </p>
        {error && (
          <Alert tone="danger" className="mb-3">
            {error}
          </Alert>
        )}
        <CodeField
          label="Authentication code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => onDone(false)}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={code.trim().length < 6}>
            Confirm
          </Button>
        </div>
      </form>
    </dialog>
  );
}
