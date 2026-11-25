import { ApiError } from '@matilda/api-client';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { errorMessage } from './auth';

/**
 * Applies a rejected request to a form: field-level problems the API reported go on their fields,
 * anything else becomes one message for the form. Returns that message (or null).
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  known: ReadonlyArray<Path<T>>,
): string | null {
  if (error instanceof ApiError && error.body?.errors?.length) {
    let unplaced = false;
    for (const issue of error.body.errors) {
      const field = known.find((k) => k === issue.path);
      if (field) setError(field, { message: issue.message });
      else unplaced = true;
    }
    return unplaced ? (error.body.message ?? errorMessage(error)) : null;
  }
  if (
    error instanceof ApiError &&
    error.status === 403 &&
    error.body?.code === 'STEP_UP_REQUIRED'
  ) {
    return 'This change needs a fresh two-factor code. Try again and enter it when asked.';
  }
  if (error instanceof ApiError && error.status === 403) {
    return 'You do not have permission to do this.';
  }
  return errorMessage(error);
}

/** Splits "AED, usd" style input into upper-case unique codes. */
export function parseCodes(input: string, transform: (v: string) => string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,]+/)
        .map((v) => transform(v.trim()))
        .filter(Boolean),
    ),
  ];
}

export const formatDateTime = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';

export const formatDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : 'None';
