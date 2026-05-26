export default function SettingsLoading() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="h-8 w-36 rounded-lg bg-slate-200 animate-pulse" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 rounded-xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
