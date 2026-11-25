'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@matilda/api-client';
import { z } from '@matilda/validation';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthCard, PasswordProblems } from '@/components/auth-card';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/auth';
import { http } from '@/lib/http';

/** Matches the API's staff policy (PASSWORD_MIN_LENGTH); the server stays the authority. */
const MIN = 12;

const schema = z
  .object({
    password: z.string().min(MIN, `Use at least ${MIN} characters.`).max(256),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match.',
  });
type Values = z.infer<typeof schema>;

/**
 * Shared by "reset password" and "accept invitation": both exchange a single-use emailed token
 * for a new password. The token comes from the link and is sent to the API only.
 */
export function SetPasswordForm({
  endpoint,
  title,
  lede,
  submitLabel,
  done,
}: {
  endpoint: string;
  title: string;
  lede: string;
  submitLabel: string;
  done: 'reset' | 'invite';
}) {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [problems, setProblems] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  if (token.length < 20) {
    return (
      <AuthCard
        title="This link is not valid"
        footer={
          <Link href="/forgot-password" className="underline underline-offset-2">
            Request a new link
          </Link>
        }
      >
        <Alert tone="danger">
          The link is incomplete. Open the full link from your email, or request a new one.
        </Alert>
      </AuthCard>
    );
  }

  async function onSubmit(values: Values) {
    setProblems([]);
    setFormError(null);
    try {
      await http.post(endpoint, { token, password: values.password }, { redirectOn401: false });
      router.replace(done === 'reset' ? '/sign-in?reset=1' : '/sign-in?invited=1');
    } catch (error) {
      if (error instanceof ApiError && error.body?.code === 'WEAK_PASSWORD') {
        setProblems((error.body.errors ?? []).map((e) => e.message));
      } else if (error instanceof ApiError && error.body?.code === 'INVALID_TOKEN') {
        setFormError('This link is invalid, already used, or has expired. Request a new one.');
      } else {
        setFormError(errorMessage(error));
      }
    }
  }

  return (
    <AuthCard title={title} lede={lede}>
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      <PasswordProblems problems={problems} />
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          autoFocus
          help={`At least ${MIN} characters. Avoid your name, email or common words.`}
          error={errors.password?.message}
          {...register('password')}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...register('confirm')}
        />
        <Button type="submit" variant="primary" busy={isSubmitting} className="mt-6 w-full">
          {submitLabel}
        </Button>
      </form>
    </AuthCard>
  );
}
