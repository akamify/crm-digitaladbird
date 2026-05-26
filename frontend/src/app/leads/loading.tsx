export default function LeadsLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="h-8 w-48 rounded-lg bg-slate-200 animate-pulse" />
        <div className="h-4 w-72 rounded bg-slate-100 animate-pulse" />
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-9 flex-1 rounded-lg bg-slate-100 animate-pulse" />
            ))}
          </div>
          <div className="space-y-2 mt-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-slate-50 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
