'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@matilda/api-client';
import { z } from '@matilda/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PasswordProblems } from '@/components/auth-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Alert, Button, PageTitle, TextField } from '@/components/ui/primitives';
import { errorMessage, useAuthSession, useResetAuth } from '@/lib/auth';
import { http } from '@/lib/http';

const MIN = 12;
const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z.string().min(MIN, `Use at least ${MIN} characters.`).max(256),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match.',
  });
type Values = z.infer<typeof schema>;

export default function SecurityPage() {
  const session = useAuthSession();
  const resetAuth = useResetAuth();
  const [done, setDone] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setDone(false);
    setProblems([]);
    setFormError(null);
    try {
      await http.post('/admin/auth/password/change', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      reset();
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError && error.body?.code === 'WEAK_PASSWORD') {
        setProblems((error.body.errors ?? []).map((e) => e.message));
      } else if (error instanceof ApiError && error.body?.code === 'INVALID_CREDENTIALS') {
        setFormError('The current password is incorrect.');
      } else {
        setFormError(errorMessage(error));
      }
    }
  }

  async function signOutEverywhere() {
    setSigningOut(true);
    setAllError(null);
    try {
      await http.post('/admin/auth/logout-all');
      resetAuth('/sign-in');
    } catch (error) {
      setConfirmAll(false);
      setAllError(errorMessage(error));
      setSigningOut(false);
    }
  }

  const info = session.data;
  return (
    <div>
      <PageTitle title="Security" lede="Manage how you sign in to Matilda Commerce." />

      <section aria-labelledby="acct-h" className="mb-8">
        <h2 id="acct-h" className="mb-2 text-[13px] font-semibold">
          Account
        </h2>
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 rounded-md border border-line bg-surface p-4 text-[13px]">
          <dt className="text-muted">Name</dt>
          <dd>{info?.fullName}</dd>
          <dt className="text-muted">Email</dt>
          <dd className="break-all">{info?.email}</dd>
          <dt className="text-muted">Two-factor</dt>
          <dd>{info?.mfaEnrolled ? 'On (authenticator app)' : 'Not set up'}</dd>
          <dt className="text-muted">Session ends</dt>
          <dd>{info ? new Date(info.sessionExpiresAt).toLocaleString('en-GB') : ''}</dd>
        </dl>
      </section>

      <section aria-labelledby="pw-h" className="mb-8">
        <h2 id="pw-h" className="mb-2 text-[13px] font-semibold">
          Change password
        </h2>
        <div className="rounded-md border border-line bg-surface p-4">
          {done && (
            <Alert tone="ok" className="mb-4">
              Password changed. Your other sessions were signed out.
            </Alert>
          )}
          {formError && (
            <Alert tone="danger" className="mb-4">
              {formError}
            </Alert>
          )}
          <PasswordProblems problems={problems} />
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-sm">
            <TextField
              label="Current password"
              type="password"
              autoComplete="current-password"
              error={errors.currentPassword?.message}
              {...register('currentPassword')}
            />
            <TextField
              label="New password"
              type="password"
              autoComplete="new-password"
              help={`At least ${MIN} characters.`}
              error={errors.newPassword?.message}
              {...register('newPassword')}
            />
            <TextField
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              error={errors.confirm?.message}
              {...register('confirm')}
            />
            <Button type="submit" variant="primary" busy={isSubmitting} className="mt-5">
              Change password
            </Button>
          </form>
        </div>
      </section>

      <section aria-labelledby="dev-h">
        <h2 id="dev-h" className="mb-2 text-[13px] font-semibold">
          Sessions
        </h2>
        <div className="rounded-md border border-line bg-surface p-4">
          {allError && (
            <Alert tone="danger" className="mb-3">
              {allError}
            </Alert>
          )}
          <p className="mb-3 text-[13px] text-ink-2">
            Sign out of every device, including this one. Use this if you think someone else has
            access to your account.
          </p>
          <Button variant="danger" onClick={() => setConfirmAll(true)}>
            Sign out everywhere
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmAll}
        title="Sign out everywhere?"
        confirmLabel="Sign out everywhere"
        cancelLabel="Stay signed in"
        danger
        busy={signingOut}
        onConfirm={signOutEverywhere}
        onCancel={() => setConfirmAll(false)}
      >
        You will be signed out on all devices and asked to sign in again.
      </ConfirmDialog>
    </div>
  );
}
