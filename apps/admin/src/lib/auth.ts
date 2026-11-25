'use client';

import { ApiError } from '@matilda/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { http } from './http';

export type SessionStage = 'PENDING' | 'VERIFIED';

export interface AuthSession {
  stage: SessionStage;
  id: string;
  email: string;
  fullName: string;
  mfaEnrolled: boolean;
  sessionExpiresAt: string;
  stepUpUntil: string | null;
}

export interface AdminContext {
  staff: { id: string; email: string; fullName: string };
  platformWide: boolean;
  activeBrandId: string | null;
  brands: Array<{ id: string; slug: string; name: string }>;
  assignments: Array<{
    id: string;
    role: { id: string; name: string };
    brand: { id: string; name: string } | null;
    market: { id: string; code: string } | null;
    branch: { id: string; code: string; name: string } | null;
    expiresAt: string | null;
    permissions: string[];
  }>;
}

export const SESSION_KEY = ['auth', 'session'] as const;
export const CONTEXT_KEY = ['admin', 'context'] as const;

/** The current session, or `null` when signed out. A 401 here is an answer, not an error. */
export function useAuthSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<AuthSession | null> => {
      try {
        return await http.get<AuthSession>('/admin/auth/session', { redirectOn401: false });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}

/** Assignments, reachable brands and effective permissions; only fetched once 2FA is complete. */
export function useAdminContext(enabled: boolean) {
  return useQuery({
    queryKey: CONTEXT_KEY,
    queryFn: () => http.get<AdminContext>('/admin/me/context'),
    enabled,
    staleTime: 60_000,
  });
}

export function heldPermissions(context: AdminContext | undefined): Set<string> {
  return new Set(context?.assignments.flatMap((a) => a.permissions) ?? []);
}

/** Where a half-signed-in person must go next. */
export function stageRoute(session: AuthSession | null): string | null {
  if (!session) return '/sign-in';
  if (session.stage === 'VERIFIED') return null;
  return session.mfaEnrolled ? '/sign-in/verify' : '/sign-in/enroll';
}

/** Ends the browser-side state after a sign-out or an ended session. */
export function useResetAuth() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(
    (to: string) => {
      http.setCsrf(null);
      queryClient.clear();
      queryClient.setQueryData(SESSION_KEY, null);
      router.replace(to);
    },
    [queryClient, router],
  );
}

/** Human-readable message for an API failure on a form. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
    if (error.status >= 500) return 'The server had a problem. Please try again shortly.';
    return error.body?.message ?? fallback;
  }
  return 'We could not reach the server. Check your connection and try again.';
}

/** Convenience for hiding controls the person cannot use; the API still enforces the permission. */
export function useCan(permission: string): boolean {
  const context = useAdminContext(true);
  return heldPermissions(context.data).has(permission);
}
