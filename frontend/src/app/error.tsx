'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-8">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 shadow-lg">
        <h2 className="text-lg font-semibold text-red-700">Something went wrong</h2>
        <p className="mt-2 text-sm text-slate-600">{error.message}</p>
        <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-700">
          {error.stack}
        </pre>
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
