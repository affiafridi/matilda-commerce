'use client';

import { ApiError } from '@matilda/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Alert, Button, CodeField } from '@/components/ui/primitives';
import { SESSION_KEY, errorMessage, useAuthSession, useResetAuth } from '@/lib/auth';
import { http } from '@/lib/http';
import { safeNext } from '@/lib/safe-next';

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const resetAuth = useResetAuth();
  const next = safeNext(params.get('next'));
  const session = useAuthSession();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.isPending) return;
    const data = session.data;
    if (!data) router.replace('/sign-in');
    else if (data.stage === 'VERIFIED') router.replace(next);
    else if (!data.mfaEnrolled) router.replace('/sign-in/enroll');
  }, [session.isPending, session.data, router, next]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await http.post<{ csrfToken: string }>(
        recovery ? '/admin/auth/mfa/recovery' : '/admin/auth/mfa/verify',
        { code: code.trim() },
        { redirectOn401: false },
      );
      http.setCsrf(result.csrfToken);
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      router.replace(next);
    } catch (e) {
      if (e instanceof ApiError && e.body?.code === 'UNAUTHENTICATED') {
        resetAuth('/sign-in');
        return;
      }
      setError(
        e instanceof ApiError && e.status === 401
          ? recovery
            ? 'That recovery code is not valid or was already used.'
            : 'That code is not valid or has expired.'
          : errorMessage(e),
      );
      setBusy(false);
    }
  }

  async function cancel() {
    try {
      await http.post('/admin/auth/logout', {}, { redirectOn401: false });
    } catch {
      // The session may already be gone; either way we are leaving.
    }
    resetAuth('/sign-in');
  }

  return (
    <AuthCard
      title={recovery ? 'Use a recovery code' : 'Enter your 6-digit code'}
      lede={
        recovery
          ? 'Enter one of the recovery codes you saved. Each code works once.'
          : 'Open your authenticator app and enter the current code.'
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <form onSubmit={submit} noValidate>
        <CodeField
          key={recovery ? 'recovery' : 'totp'}
          label={recovery ? 'Recovery code' : 'Authentication code'}
          recovery={recovery}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={code.trim().length < 6}
          className="mt-6 w-full"
        >
          Verify
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-[13px]">
        <button
          type="button"
          className="text-ink-2 underline underline-offset-2"
          onClick={() => {
            setRecovery((v) => !v);
            setCode('');
            setError(null);
          }}
        >
          {recovery ? 'Use authenticator code' : 'Use a recovery code'}
        </button>
        <button type="button" className="text-ink-2 underline underline-offset-2" onClick={cancel}>
          Cancel and sign out
        </button>
      </div>
    </AuthCard>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}
