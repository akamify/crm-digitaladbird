'use client';
import { useState } from 'react';
import { useCounselorWorkflowDetail, type WorkflowEvent, type WorkflowState } from '@/hooks/useCounselorWorkflow';
import { fmtDate, humanize } from '@/lib/format';

const labels: Record<string,string> = {communication_completed:'CC',respond_hi:'R',common_meeting:'CM',dim:'DIM',
  personal_meeting:'PM',follow_up:'FLP',quotation:'Q',special_category:'SC',call_reminder:'CR',handover_rm:'RM',
  not_attended:'NT',process_incomplete:'PI',cnr:'CNR',nrac:'NRAC',nracm:'NRACM',nrapm:'NRAPM',nraf:'NRAF',nraq:'NRAQ',
  old:'OL',new:'New',pending:'Pending'};
export const workflowLabel = (key:string|null|undefined) => key ? labels[key] || humanize(key) : 'No primary status';
export function currentWorkflowLabel(state:Partial<WorkflowState>|null) {
  if (!state) return 'Legacy / not enrolled';
  if (state.queue === 'pending') return 'Pending';
  if (state.queue === 'new') return 'New';
  if (state.journey_active) return `${workflowLabel(state.primary_status)}${state.queue === 'old' ? ' + Old' : ''}`;
  return 'Awaiting primary status';
}
export function journeyStep(event:WorkflowEvent) {
  if (event.event_type === 'entered_old') return 'OL';
  if (event.event_type === 'entered_pending') return 'Pending';
  if (event.event_type === 'remark_saved') return workflowLabel(event.primary_status);
  if (event.event_type === 'legacy_activity_observed') return 'Remark';
  if (event.event_type === 'legacy_state_changed') return 'Legacy update';
  if (event.event_type === 'assignment_changed') return event.new_state.queue === 'new' ? 'Reassigned → New' : 'Reassigned';
  if (event.event_type === 'workflow_enrolled') return event.new_state.queue === 'new' ? 'New' : 'Enrolled';
  return null;
}
export function JourneySteps({events}:{events:WorkflowEvent[]}) {
  const steps = events.map(event => ({event,label:journeyStep(event)})).filter(step => step.label);
  return <ol aria-label="Journey history" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-slate-600">
    {steps.map(({event,label},index) => <li key={event.id} className="inline-flex max-w-full items-center gap-1 break-words">
      {index>0 && <span aria-hidden="true">→</span>}<span title={fmtDate(event.occurred_at,'d MMM yyyy, h:mm a')} className="rounded bg-slate-100 px-1.5 py-1">{label}</span>
    </li>)}
  </ol>;
}
function FullHistory({leadId}:{leadId:string}) {
  const [page,setPage] = useState(1);
  const query = useCounselorWorkflowDetail(leadId,page);
  if (query.isError) return <p role="alert">History could not be loaded. <button className="underline" onClick={() => query.refetch()}>Retry</button></p>;
  if (!query.data) return <p role="status">Loading history…</p>;
  return <div className="space-y-2"><p className="font-medium">Current: {currentWorkflowLabel(query.data.state)}</p>
    <ol className="space-y-1">{[...query.data.events].reverse().map(event => <li key={event.id} className="break-words">{journeyStep(event)||humanize(event.event_type)} · {fmtDate(event.occurred_at,'d MMM yyyy, h:mm a')}{event.statuses?.length ? <span className="block text-slate-500">Saved: {event.statuses.map(workflowLabel).join(', ')}</span> : null}</li>)}</ol>
    {!query.data.events.length && <p>No recorded journey yet.</p>}
    <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={page===1||query.isFetching} onClick={() => setPage(page-1)}>Newer history</button><button className="btn-secondary" disabled={!query.data.has_more||query.isFetching} onClick={() => setPage(page+1)}>Older history</button></div>
  </div>;
}
export function CounselorJourneyTracker({leadId,events,total}:{leadId:string;events:WorkflowEvent[];total:number}) {
  const [open,setOpen] = useState(false);
  return <div className="min-w-0 space-y-2">
    <p className="text-[10px] font-semibold uppercase text-slate-400">History</p>
    {events.length ? <JourneySteps events={events}/> : <p className="text-xs text-slate-500">No recorded journey yet.</p>}
    <details onToggle={event => setOpen(event.currentTarget.open)} className="text-xs text-slate-600">
      <summary className="min-h-9 cursor-pointer py-2">{total>events.length ? 'Recent steps · View full history' : 'View history details'}</summary>
      {open && <FullHistory leadId={leadId}/>}
    </details>
  </div>;
}
