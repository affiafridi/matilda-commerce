'use client';

import { Suspense } from 'react';
import { SetPasswordForm } from '@/components/set-password-form';

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <SetPasswordForm
        endpoint="/admin/auth/password/reset"
        title="Choose a new password"
        lede="You will be signed out everywhere and asked to sign in again."
        submitLabel="Change password"
        done="reset"
      />
    </Suspense>
  );
}
