'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useCounselorRemark, useCounselorWorkflowDetail } from '@/hooks/useCounselorWorkflow';
import { workflowLabel } from './CounselorJourneyTracker';

export function CounselorRemarkForm({leadId,onSaved}:{leadId:string;onSaved?:() => void}) {
  const detail = useCounselorWorkflowDetail(leadId);
  const mutation = useCounselorRemark();
  const [primary,setPrimary] = useState('');
  const [secondary,setSecondary] = useState<string[]>([]);
  const [remark,setRemark] = useState('');
  const [followup,setFollowup] = useState('keep');
  const [at,setAt] = useState('');
  const [message,setMessage] = useState('');
  const request = useRef<{signature:string;key:string}|null>(null);
  if (detail.isError) return <p role="alert">Could not load the current workflow. <button className="underline" onClick={() => detail.refetch()}>Retry</button></p>;
  if (!detail.data) return <p role="status">Loading current workflow…</p>;
  if (!detail.data.enabled) return <p>The counselor workflow is not enabled yet.</p>;
  if (detail.data.read_only) return <p>This reassigned lead is read-only.</p>;
  async function submit(event:FormEvent) {
    event.preventDefault();
    try {
    const statuses = [...new Set([primary,...secondary])];
    const next = followup==='clear' ? null : followup==='set' ? new Date(`${at}:00+05:30`).toISOString() : undefined;
    const signature = JSON.stringify({statuses,primary,remark,next});
    if (request.current?.signature !== signature) request.current = {signature,key:crypto.randomUUID()};
      await mutation.mutateAsync({leadId,statuses,primary_status:primary,remark,
        idempotency_key:request.current.key,expected_generation:detail.data?.state?.generation||0,
        ...(next!==undefined ? {next_followup_at:next} : {})});
      request.current = null; setRemark(''); setPrimary(''); setSecondary([]); setMessage('Remark saved.'); onSaved?.();
    } catch (error) {
      const response = error as {response?:{data?:{error?:{message?:string};message?:string}};message?:string};
      setMessage(response.response?.data?.error?.message||response.response?.data?.message||'Save failed. Retry, or refresh the workflow if it changed.');
    }
  }
  return <form onSubmit={submit} className="min-w-0 space-y-3">
    <label className="block text-sm">Primary status<select required className="input mt-1 w-full min-w-0" value={primary} onChange={e => setPrimary(e.target.value)} disabled={mutation.isPending}>
      <option value="">Select one primary status</option>{detail.data.status_options.map(value => <option key={value} value={value}>{workflowLabel(value)}</option>)}
    </select></label>
    <label className="block text-sm">Secondary statuses (optional)<select multiple className="input mt-1 h-28 w-full min-w-0" value={secondary} onChange={e => setSecondary(Array.from(e.target.selectedOptions,option => option.value))} disabled={mutation.isPending}>
      {detail.data.status_options.filter(value => value!==primary).map(value => <option key={value} value={value}>{workflowLabel(value)}</option>)}
    </select></label>
    <label className="block text-sm">Remark<textarea className="input mt-1 min-h-24 w-full" value={remark} maxLength={10000} onChange={e => setRemark(e.target.value)} disabled={mutation.isPending}/></label>
    <label className="block text-sm">Custom follow-up<select className="input mt-1 w-full" value={followup} onChange={e => setFollowup(e.target.value)} disabled={mutation.isPending}><option value="keep">Keep existing schedule</option><option value="set">Schedule follow-up</option><option value="clear">Clear schedule</option></select></label>
    {followup==='set' && <label className="block text-sm">Follow-up time (Asia/Kolkata)<input required type="datetime-local" className="input mt-1 min-w-0" value={at} onChange={e => setAt(e.target.value)} disabled={mutation.isPending}/></label>}
    {message && <p role={mutation.isError?'alert':'status'} className="break-words text-sm">{message}</p>}
    <div className="flex flex-wrap gap-2"><button type="submit" className="btn-primary" disabled={!primary||mutation.isPending}>{mutation.isPending?'Saving…':'Save remark'}</button><button type="button" className="btn-secondary" disabled={mutation.isPending||detail.isFetching} onClick={() => detail.refetch()}>Refresh workflow</button></div>
  </form>;
}
