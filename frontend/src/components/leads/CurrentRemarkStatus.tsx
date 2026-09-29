'use client';
import { useEffect, useState } from 'react';
import type { CounselorDetail } from '@/hooks/useCounselorWorkflow';
import { fmtDate, fmtRelative, humanize } from '@/lib/format';

export function CurrentRemarkStatus({ query, latestStatus, nextFollowup, enabled }: {
  query: { data?: CounselorDetail; isLoading: boolean; isError: boolean; refetch: () => unknown };
  latestStatus?: string | null; nextFollowup?: string | null; enabled: boolean;
}) {
  const [, tick] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => tick(value => value + 1), 60000); return () => window.clearInterval(timer); }, []);
  const data = query.data;
  const state = data?.enabled && data.managed && data.assignment_current !== false && !data.state?.awaiting_primary ? data.state : null;
  const due = state?.queue === 'pending' ? null : state?.followup_override ? nextFollowup : state?.move_to_old_at || state?.move_to_pending_at;
  const action = state?.queue === 'pending' ? 'Pending — add next remark' : state?.followup_override ? 'Custom follow-up' : state?.move_to_old_at ? 'Moves to Old Leads' : state?.move_to_pending_at ? 'Moves to Pending' : 'No active workflow deadline';
  return <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
    <p className="font-medium text-slate-500">Current remark</p>
    <p className="mt-1 break-words font-semibold text-slate-900">{humanize(state?.primary_status || latestStatus || 'Not recorded')}</p>
    {enabled && (query.isLoading ? <p className="mt-2" role="status">Loading deadline…</p> : query.isError ? <p className="mt-2" role="alert">Deadline unavailable. <button className="underline" onClick={() => query.refetch()}>Retry</button></p> : <>
      {state?.queue && <p className="mt-1 text-slate-600">Queue: {humanize(state.queue)}</p>}
      <p className="mt-2 font-medium text-slate-700">{action}</p>
      {due && <p className="mt-1 text-slate-600">{fmtDate(due, 'd MMM, h:mm a')} · {fmtRelative(due)}</p>}
    </>)}
  </div>;
}
