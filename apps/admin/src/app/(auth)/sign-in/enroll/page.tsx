'use client';

import { ApiError } from '@matilda/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Alert, Button, CodeField } from '@/components/ui/primitives';
import { SESSION_KEY, errorMessage, useAuthSession, useResetAuth } from '@/lib/auth';
import { http } from '@/lib/http';
import { safeNext } from '@/lib/safe-next';

interface Enrollment {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

function EnrollFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const resetAuth = useResetAuth();
  const next = safeNext(params.get('next'));
  const session = useAuthSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const pendingSession = session.data?.stage === 'PENDING' && !session.data.mfaEnrolled;

  // Each request to start enrollment issues a new secret, so it runs once and is never refetched.
  const enrollment = useQuery({
    queryKey: ['auth', 'enrollment'],
    queryFn: () => http.post<Enrollment>('/admin/auth/mfa/enroll/start', {}),
    enabled: pendingSession,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (session.isPending || recoveryCodes) return;
    const data = session.data;
    if (!data) router.replace('/sign-in');
    else if (data.stage === 'VERIFIED') router.replace(next);
    else if (data.mfaEnrolled) router.replace('/sign-in/verify');
  }, [session.isPending, session.data, recoveryCodes, router, next]);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await http.post<{ csrfToken: string; recoveryCodes: string[] }>(
        '/admin/auth/mfa/enroll/confirm',
        { code: code.trim() },
        { redirectOn401: false },
      );
      http.setCsrf(result.csrfToken);
      setRecoveryCodes(result.recoveryCodes);
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    } catch (e) {
      if (e instanceof ApiError && e.body?.code === 'UNAUTHENTICATED') {
        resetAuth('/sign-in');
        return;
      }
      setError(
        e instanceof ApiError && e.status === 401
          ? 'That code is not valid or has expired.'
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText((recoveryCodes ?? []).join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (recoveryCodes) {
    return (
      <AuthCard
        title="Save your recovery codes"
        lede="Each code works once if you lose your authenticator. They are shown only now."
      >
        <ul
          aria-label="Recovery codes"
          className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-line bg-sunken p-3 font-mono text-[13px]"
        >
          {recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={copyCodes}>
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? 'Copied' : 'Copy codes'}
          </Button>
        </div>
        <label className="mt-5 flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>I have saved these codes somewhere safe.</span>
        </label>
        <Button
          variant="primary"
          disabled={!saved}
          className="mt-5 w-full"
          onClick={() => router.replace(next)}
        >
          Continue to Matilda Commerce
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set up two-factor authentication"
      lede="Required for everyone with access to Matilda Commerce."
    >
      {enrollment.isError && (
        <Alert tone="danger" className="mb-4">
          {errorMessage(enrollment.error, 'We could not start the setup.')}
        </Alert>
      )}
      {enrollment.isPending && pendingSession && (
        <p className="text-[13px] text-muted" role="status">
          Preparing your setup code…
        </p>
      )}
      {enrollment.data && (
        <>
          <p className="text-[13px] text-ink-2">
            1. Scan this code with an authenticator app (1Password, Google Authenticator, Authy).
          </p>
          <div className="my-3 flex items-start gap-4">
            {/* A data: URL generated by the API; next/image adds nothing for it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollment.data.qrDataUrl}
              alt="QR code for your authenticator app"
              width={140}
              height={140}
              className="rounded-sm border border-line"
            />
            <div className="text-xs text-muted">
              Cannot scan? Enter this key instead:
              <code className="mt-1 block break-all font-mono text-[13px] text-ink">
                {enrollment.data.secret}
              </code>
            </div>
          </div>
          <p className="text-[13px] text-ink-2">2. Enter the 6-digit code it shows.</p>
          {error && (
            <Alert tone="danger" className="mt-3">
              {error}
            </Alert>
          )}
          <form onSubmit={confirm} noValidate>
            <CodeField
              label="Authentication code"
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
              Confirm and continue
            </Button>
          </form>
        </>
      )}
    </AuthCard>
  );
}

export default function EnrollPage() {
  return (
    <Suspense>
      <EnrollFlow />
    </Suspense>
  );
}
