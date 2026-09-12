'use client';

import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/Modal';
import { useCounselorWorkspaceLeads, useCounselorWorkspaceSummary, type WorkspaceSummary, type WorkspaceView } from '@/hooks/useLifecycle';
import { fmtDate, humanize } from '@/lib/format';

const METRICS: Array<{ key: keyof WorkspaceSummary; label: string; hint: string }> = [
  { key: 'received', label: 'Leads Received', hint: 'Currently assigned active leads (live now).' },
  { key: 'new', label: 'New Leads', hint: 'Newly assigned in the selected period.' },
  { key: 'worked', label: 'Worked', hint: 'Unique leads with qualifying human activity in the selected period.' },
  { key: 'pending', label: 'Pending', hint: 'Active leads with an overdue required action (live now).' },
  { key: 'unworked', label: 'Unworked', hint: 'Assigned leads with no qualifying activity (live now).' },
  { key: 'reassigned', label: 'Reassigned To Me', hint: 'Received from another counselor in the selected period.' },
];

const WORK_VIEWS: Array<[WorkspaceView, string]> = [
  ['received', 'Leads Received'], ['worked', 'Worked'], ['pending', 'Pending'], ['unworked', 'Unworked'],
  ['call_issues', 'Call Issues'], ['follow_up', 'Follow-up'],
];
const JOURNEY_VIEWS: Array<[WorkspaceView, string]> = [
  ['responses', 'Responses'], ['common_meeting', 'Common Meeting'], ['tte', 'TTE'],
  ['personal_meeting', 'Personal Meeting'], ['quotation', 'Quotation'], ['converted', 'Converted'], ['cold', 'Cold'],
];

function istDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function shiftDate(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function CounselorLifecycleWorkspace() {
  const today = istDate();
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState<WorkspaceView>('received');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const summary = useCounselorWorkspaceSummary(selectedDate, selectedDate);
  const leads = useCounselorWorkspaceLeads({ view, from: selectedDate, to: selectedDate, page, q: deferredSearch, enabled: summary.data?.enabled !== false });

  function selectView(next: WorkspaceView) {
    setView(next);
    setPage(1);
  }

  function selectDate(next: string) {
    setSelectedDate(next > today ? today : next);
    setPage(1);
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-amber-50 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-sky-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Counselor Workspace</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">Today&apos;s work, one clear queue</h2>
          <p className="text-xs text-slate-500">Live workload stays current; activity metrics follow the selected date.</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button type="button" className="rounded-lg p-2 text-slate-600 hover:bg-slate-50" onClick={() => selectDate(shiftDate(selectedDate, -1))} aria-label="Previous day"><ArrowLeft className="h-4 w-4" /></button>
          <div className="flex min-w-36 items-center justify-center gap-2 px-2 text-sm font-semibold text-slate-800"><CalendarDays className="h-4 w-4 text-sky-600" />{fmtDate(`${selectedDate}T12:00:00+05:30`, 'd MMM yyyy')}</div>
          <button type="button" disabled={selectedDate >= today} className="rounded-lg p-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30" onClick={() => selectDate(shiftDate(selectedDate, 1))} aria-label="Next day"><ArrowRight className="h-4 w-4" /></button>
          <button type="button" className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white" onClick={() => selectDate(today)}>Today</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-200/70 lg:grid-cols-6">
        {METRICS.map(metric => (
          <button key={metric.key} type="button" title={metric.hint} onClick={() => selectView(metric.key as WorkspaceView)} className={`min-h-24 bg-white px-4 py-3 text-left transition hover:bg-sky-50 ${view === metric.key ? 'shadow-[inset_0_-3px_0_#0284c7]' : ''}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{metric.label}</div>
            {summary.isLoading ? <Skeleton className="mt-3 h-7 w-14" /> : <div className="mt-2 text-2xl font-bold tabular-nums text-slate-950">{Number(summary.data?.summary?.[metric.key] || 0).toLocaleString()}</div>}
            <div className="mt-1 line-clamp-1 text-[10px] text-slate-400">{metric.key === 'received' || metric.key === 'pending' || metric.key === 'unworked' ? 'Live now' : 'Selected day'}</div>
          </button>
        ))}
      </div>

      <div className="space-y-4 bg-white/75 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Work queues</span>
          {WORK_VIEWS.map(([key, label]) => <button key={key} type="button" onClick={() => selectView(key)} className={view === key ? 'chip-blue' : 'chip-slate'}>{label} <span className="ml-1 tabular-nums">{summary.data?.summary?.[key] ?? 0}</span></button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Journey views</span>
          {JOURNEY_VIEWS.map(([key, label]) => <button key={key} type="button" onClick={() => selectView(key)} className={view === key ? 'chip-green' : 'chip-slate'}>{label} <span className="ml-1 tabular-nums">{summary.data?.summary?.[key] ?? 0}</span></button>)}
        </div>
        <label className="relative block max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search this queue..." />
        </label>

        {leads.isLoading ? <div className="space-y-2">{[1, 2, 3].map(key => <Skeleton key={key} className="h-16" />)}</div> : !leads.data?.rows.length ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">No leads in this view.</div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {leads.data.rows.map(lead => (
              <Link key={lead.id} href={`/leads/${lead.id}`} className="grid gap-2 px-4 py-3 transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1.4fr)_1fr_1fr_auto] sm:items-center">
                <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-900">{lead.full_name || 'Unnamed lead'}</div><div className="text-xs text-slate-500">{lead.phone || 'No phone'} / {lead.source || 'Manual'}</div></div>
                <div className="text-xs text-slate-600"><div className="font-medium text-slate-800">{humanize(lead.journey_stage)}</div><div>{humanize(lead.last_call_result || 'not called')}</div></div>
                <div className="text-xs text-slate-600"><div className="font-medium text-slate-800">{humanize(lead.current_action_type || (lead.has_call_issue ? 'call retry' : 'no next action'))}</div>{lead.current_action_due_at && <div className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{fmtDate(lead.current_action_due_at, 'd MMM, h:mm a')}</div>}</div>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </Link>
            ))}
          </div>
        )}
        {(leads.data?.total || 0) > 25 && <div className="flex items-center justify-end gap-2"><span className="text-xs text-slate-500">Page {page} of {Math.ceil((leads.data?.total || 0) / 25)}</span><button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="btn-secondary" disabled={page * 25 >= (leads.data?.total || 0)} onClick={() => setPage(value => value + 1)}>Next</button></div>}
      </div>
    </section>
  );
}
