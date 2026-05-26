export default function ChatLoading() {
  return (
    <div className="flex h-screen bg-slate-100">
      <div className="w-80 border-r border-slate-200 bg-white p-4 space-y-3">
        <div className="h-10 rounded-xl bg-slate-100 animate-pulse" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl p-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-slate-100 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-24 rounded bg-slate-100 animate-pulse" />
              <div className="h-3 w-36 rounded bg-slate-50 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-16 w-16 mx-auto rounded-full bg-slate-100 animate-pulse" />
          <div className="h-4 w-40 mx-auto rounded bg-slate-100 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
