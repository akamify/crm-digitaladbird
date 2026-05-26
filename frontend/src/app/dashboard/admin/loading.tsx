export default function AdminDashboardLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="h-8 w-56 rounded-lg bg-slate-200 animate-pulse" />
        <div className="h-12 rounded-xl bg-violet-50 border border-violet-200 animate-pulse" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
