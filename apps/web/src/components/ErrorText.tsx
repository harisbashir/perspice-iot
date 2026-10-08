import { ApiError } from '@/api/client';

/** Human-readable message for an API error (validation details flattened). */
export function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  const issues = Array.isArray(err.details) ? (err.details as { message?: string }[]) : [];
  const detail = issues.map((i) => i.message).filter(Boolean).join(' ');
  return detail || err.message;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {errorMessage(error)}
    </p>
  );
}
