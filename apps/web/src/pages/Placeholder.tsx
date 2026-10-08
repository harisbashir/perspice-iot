/** Temporary page body for routes whose screens arrive in later tasks. */
export function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
    </div>
  );
}
