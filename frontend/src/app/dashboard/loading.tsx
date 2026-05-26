export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 rounded-full border-3 border-blue-200 border-t-blue-600 animate-spin" />
        <p className="text-sm text-slate-500">Loading dashboard...</p>
      </div>
    </div>
  );
}
