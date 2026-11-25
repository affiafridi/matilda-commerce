'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { z } from '@matilda/validation';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthCard } from '@/components/auth-card';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/auth';
import { http } from '@/lib/http';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email.').email('Enter a valid email address.'),
});
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      await http.post('/admin/auth/password/forgot', values, { redirectOn401: false });
      setSent(true);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  const back = (
    <Link href="/sign-in" className="underline underline-offset-2">
      Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <AuthCard title="Check your email" footer={back}>
        <Alert tone="ok">
          If an account exists for that address, we have sent a link to reset the password. It
          expires in one hour.
        </Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      lede="Enter your work email and we will send you a reset link."
      footer={back}
    >
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
        <Button type="submit" variant="primary" busy={isSubmitting} className="mt-6 w-full">
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
