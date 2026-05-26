export default function PartnerRequestsLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="h-8 w-52 rounded-lg bg-slate-200 animate-pulse" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
