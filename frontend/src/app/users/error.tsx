'use client';

import { useEffect } from 'react';
import { Users, RefreshCw } from 'lucide-react';

export default function UsersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[Users Error]', error); }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-red-50 mb-4">
          <Users className="h-8 w-8 text-red-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Users page error</h2>
        <p className="text-sm text-slate-500 mb-6">Something went wrong loading the users page. This is usually temporary.</p>
        <button onClick={reset} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition shadow-sm">
          <RefreshCw className="h-4 w-4" /> Try Again
        </button>
      </div>
    </div>
  );
}
