'use client';

import { useRmReportCounselors } from '@/hooks/useUsers';

export function RmCounselorFilter({rmId, value, onChange}: {
  rmId: string;
  value: string;
  onChange: (counselorId: string) => void;
}) {
  const query = useRmReportCounselors(rmId);
  const counselors = query.data || [];
  return <div className="flex flex-wrap items-center gap-2">
    <label htmlFor="rm-report-counselor" className="text-xs font-medium text-slate-600">Counselor</label>
    <select id="rm-report-counselor" value={value} onChange={event => onChange(event.target.value)}
      disabled={!query.data && !value} aria-busy={query.isFetching}
      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-brand-400 focus:outline-none disabled:opacity-60 sm:w-64">
      <option value="">{query.isLoading ? 'Loading counselors...' : query.isError && !query.data ? 'Counselors unavailable' : 'All counselors in this RM'}</option>
      {value && !counselors.some(person => person.id === value) && <option value={value}>Selected counselor{query.isLoading ? ' (loading...)' : ' (unavailable)'}</option>}
      {counselors.map(person => <option key={person.id} value={person.id}>{person.full_name}</option>)}
    </select>
    {query.isError && <span role="alert" className="text-xs text-rose-600">Could not load counselors. <button type="button" onClick={() => void query.refetch()} className="font-medium underline">Retry</button></span>}
    {query.data && !counselors.length && <span className="text-xs text-slate-500">No counselors in this RM.</span>}
  </div>;
}
