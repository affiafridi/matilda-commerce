'use client';

import { Suspense } from 'react';
import { SetPasswordForm } from '@/components/set-password-form';

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <SetPasswordForm
        endpoint="/admin/auth/invite/accept"
        title="Welcome to Matilda Commerce"
        lede="Choose a password to activate your account. You will set up two-factor authentication next."
        submitLabel="Activate account"
        done="invite"
      />
    </Suspense>
  );
}
