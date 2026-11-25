'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ApiError } from '@matilda/api-client';
import { z } from '@matilda/validation';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthCard } from '@/components/auth-card';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { SESSION_KEY, errorMessage, stageRoute, useAuthSession } from '@/lib/auth';
import { http } from '@/lib/http';
import { safeNext } from '@/lib/safe-next';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
type Values = z.infer<typeof schema>;

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const next = safeNext(params.get('next'));
  const nextQuery = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
  const session = useAuthSession();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  // Someone who is already signed in (or half-way) goes to the right place.
  useEffect(() => {
    if (!session.data) return;
    const stage = stageRoute(session.data);
    router.replace(stage ? `${stage}${nextQuery}` : next);
  }, [session.data, router, next, nextQuery]);

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      const result = await http.post<{ next: 'MFA_ENROLL' | 'MFA_VERIFY'; csrfToken: string }>(
        '/admin/auth/login',
        values,
        { redirectOn401: false },
      );
      http.setCsrf(result.csrfToken);
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      router.replace(
        `${result.next === 'MFA_ENROLL' ? '/sign-in/enroll' : '/sign-in/verify'}${nextQuery}`,
      );
    } catch (error) {
      setFormError(
        error instanceof ApiError && error.status === 401
          ? 'The email or password is incorrect.'
          : errorMessage(error),
      );
    }
  }

  return (
    <AuthCard
      title="Sign in to Matilda Commerce"
      lede="Use your work email."
      footer={
        <Link href="/forgot-password" className="underline underline-offset-2">
          Forgot your password?
        </Link>
      }
    >
      {params.get('reset') === '1' && (
        <Alert tone="ok" className="mb-4">
          Your password was changed. Sign in with the new one.
        </Alert>
      )}
      {params.get('invited') === '1' && (
        <Alert tone="ok" className="mb-4">
          Your account is active. Sign in to finish setting up.
        </Alert>
      )}
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          autoFocus
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" variant="primary" busy={isSubmitting} className="mt-6 w-full">
          Continue
        </Button>
      </form>
    </AuthCard>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
