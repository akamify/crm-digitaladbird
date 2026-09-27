'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Search, SlidersHorizontal, X } from 'lucide-react';
import { CounselorWorkflowFilters } from './CounselorWorkflowFilters';
import { LeadAnalyticsPeriodControl } from './LeadAnalyticsPeriodControl';
import { LEGACY_COUNSELOR_VIEWS } from './counselorLeadTabs';
import type { LeadAnalyticsScope, LeadFilters as FilterState } from '@/types';
import type { CounselorLead } from '@/hooks/useCounselorWorkflow';

interface Props {
  filters: FilterState;
  onFilters: (filters: FilterState) => void;
  onSearch: (value: string) => void;
  scope: LeadAnalyticsScope;
  onScope: (scope: LeadAnalyticsScope) => void;
  rows: CounselorLead[];
  statuses: string[];
  onView: (view: string) => void;
}

export function CounselorLeadsToolbar({ filters, onFilters, onSearch, scope, onScope, rows, onView, statuses }: Props) {
  const [mobile, setMobile] = useState(false);
  const [panel, setPanel] = useState<'filters' | 'actions' | null>(null);
  const [selectedLead, setSelectedLead] = useState('');
  const [anchor, setAnchor] = useState({ top: 120, right: 16 });
  const toolbar = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const lead = rows.find(row => row.id === selectedLead);
  const activeCount = Object.entries(filters).filter(([key, value]) => key !== 'q' && key !== 'page' && Boolean(value)).length;

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!panel) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      trigger.current?.focus();
    };
  }, [panel]);

  function open(next: 'filters' | 'actions', button: HTMLButtonElement) {
    const rect = toolbar.current?.getBoundingClientRect();
    setAnchor({ top: Math.min((rect?.bottom || 104) + 8, window.innerHeight - 180), right: Math.max(16, window.innerWidth - (rect?.right || window.innerWidth)) });
    trigger.current = button;
    setPanel(next);
  }

  const controls = <div ref={toolbar} className={mobile ? 'fixed inset-x-0 top-16 z-30 border-b border-slate-200 bg-white px-3 py-2 shadow-sm' : 'relative'}>
    <div className="flex min-w-0 items-center gap-1.5">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search leads</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-3.5 h-4 w-4 text-slate-400" />
        <input type="search" className="input h-11 min-w-0 pl-8 pr-2" placeholder="Search leads…" value={filters.q || ''} onChange={event => onSearch(event.target.value)} />
      </label>
      <button type="button" aria-haspopup="dialog" aria-expanded={panel === 'filters'} onClick={event => open('filters', event.currentTarget)} className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700">
        <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />Filter{activeCount > 0 && <span className="rounded-full bg-brand-50 px-1 text-brand-700">{activeCount}</span>}
      </button>
      <button type="button" aria-haspopup="dialog" aria-expanded={panel === 'actions'} onClick={event => open('actions', event.currentTarget)} className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700">
        <MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5" />Actions
      </button>
    </div>
  </div>;

  return <>
    <div className="min-h-[60px] min-w-0 md:min-h-0">{mobile ? createPortal(controls, document.body) : controls}</div>
    {panel && createPortal(
      <dialog ref={dialog} aria-labelledby="counselor-panel-title" onCancel={() => setPanel(null)} onClose={() => setPanel(null)} onClick={event => { if (event.target === event.currentTarget) setPanel(null); }}
        style={mobile ? { margin: 0, top: 'auto', bottom: 0, left: 0, width: '100%', maxWidth: '100%', maxHeight: '85dvh' } : { margin: 0, left: 'auto', top: anchor.top, right: anchor.right, width: 'min(560px, calc(100vw - 32px))', maxHeight: `calc(100dvh - ${anchor.top + 16}px)` }}
        className="overflow-y-auto overscroll-contain rounded-t-2xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-950/30 md:rounded-xl">
        <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={event => event.stopPropagation()}>
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 id="counselor-panel-title" className="font-semibold text-slate-900">{panel === 'filters' ? 'Filter leads' : 'Lead actions'}</h2>
            <button type="button" aria-label="Close panel" onClick={() => setPanel(null)} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </div>
          {panel === 'filters' ? <div className="space-y-4">
            <div className="min-w-0 [&>div]:flex-wrap [&>div]:max-w-full [&_[role=dialog]]:relative [&_[role=dialog]]:inset-auto [&_[role=dialog]]:mt-2 [&_[role=dialog]]:w-full [&_[role=dialog]]:min-w-0 [&_input]:min-w-0">
              <LeadAnalyticsPeriodControl scope={scope} onChange={onScope} />
            </div>
            <CounselorWorkflowFilters value={filters} onChange={onFilters} statuses={statuses}/>
            <button type="button" className="btn-primary w-full" onClick={() => setPanel(null)}>Show leads</button>
          </div> : <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">Lead on this page
              <select className="input mt-1 min-w-0" value={lead?.id || ''} onChange={event => setSelectedLead(event.target.value)}>
                <option value="">Select a lead</option>
                {rows.map(row => <option key={row.id} value={row.id}>{row.full_name || 'Unnamed lead'}{row.phone ? ` · ${row.phone}` : ''}</option>)}
              </select>
            </label>
            {lead ? <div className="flex flex-wrap gap-2">
              {!lead.read_only && lead.phone && <a className="btn-secondary" href={`tel:${lead.phone}`} onClick={() => setPanel(null)}>Call</a>}
              <Link className="btn-primary" href={`/leads/${lead.id}`} onClick={() => setPanel(null)}>Open lead</Link>
            </div> : <p className="text-xs text-slate-500">Select a lead to call or open its details. These actions are also available on each lead card.</p>}
            <div className="border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-medium text-slate-500">Existing views</p>
              <div className="flex flex-wrap gap-2">{LEGACY_COUNSELOR_VIEWS.map(view => <button key={view.key} type="button" className="btn-secondary" onClick={() => { onView(view.key); setPanel(null); }}>{view.label}</button>)}</div>
            </div>
          </div>}
        </div>
      </dialog>, document.body)}
  </>;
}
