import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-fg-muted">This page doesn't exist or you don't have access to it.</p>
      <Link to="/" className="mt-4 inline-block text-sm text-primary-700 hover:underline dark:text-primary-300">
        Go to overview
      </Link>
    </div>
  );
}
