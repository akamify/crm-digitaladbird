'use client';
import type { LeadFilters } from '@/types';
import { useAuth } from '@/lib/auth';
import { workflowLabel } from './CounselorJourneyTracker';

export function CounselorWorkflowFilters({value,onChange,statuses}:{value:LeadFilters;onChange:(value:LeadFilters)=>void;statuses:string[]}) {
  const {user} = useAuth();
  const set = (key:keyof LeadFilters,next:string) => onChange({...value,[key]:next,page:1});
  return <div className="grid min-w-0 gap-3 sm:grid-cols-2">
    <label className="text-sm">Counselor<select aria-label="Counselor" className="input mt-1 w-full min-w-0" value={user?.id||''} disabled><option value={user?.id||''}>{user?.name||'My leads'}</option></select></label>
    <label className="text-sm">Primary journey / Call issue<select aria-label="Journey or call issue" className="input mt-1 w-full min-w-0" value={value.call_status||''} onChange={e=>set('call_status',e.target.value)}><option value="">All active primary statuses</option>{statuses.map(status=><option key={status} value={status}>{workflowLabel(status)}</option>)}</select></label>
    <label className="text-sm">Source<select aria-label="Source" className="input mt-1 w-full" value={value.source||''} onChange={e=>set('source',e.target.value)}>{['','manual','meta','google_sheet','import'].map(source=><option key={source} value={source}>{source||'All sources'}</option>)}</select></label>
    <label className="text-sm">Category<select aria-label="Category" className="input mt-1 w-full" value={value.category||''} onChange={e=>set('category',e.target.value)}>{['','trader','partner','unknown'].map(category=><option key={category} value={category}>{category||'All categories'}</option>)}</select></label>
    <label className="text-sm">Campaign<input aria-label="Campaign" className="input mt-1 min-w-0" value={value.campaign||''} onChange={e=>set('campaign',e.target.value)}/></label>
    <label className="text-sm">Follow-up<select aria-label="Follow-up" className="input mt-1 w-full" value={value.followup||''} onChange={e=>set('followup',e.target.value)}>{[['','Any follow-up'],['today','Today'],['overdue','Overdue'],['upcoming','Upcoming'],['week','Next seven days'],['no_followup','No schedule']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <button type="button" className="btn-secondary" onClick={()=>onChange({q:value.q})}>Clear filters</button>
  </div>;
}
