'use client';

import { FormEvent, useState } from 'react';
import { Loader2, PhoneCall, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import { fmtDate, fmtRelative } from '@/lib/format';
import { buildTelHref, triggerPhoneCall } from '@/lib/phone';
import type { LeadCallLog } from '@/hooks/useLeadCommunication';

interface Props {
  phone?: string | null;
  calls: LeadCallLog[];
  loading: boolean;
  disabled?: boolean;
  starting?: boolean;
  logging?: boolean;
  onStart: () => Promise<unknown>;
  onLog: (body: { status: string; duration_seconds?: string; notes?: string; next_followup_at?: string }) => Promise<unknown>;
}

export function LeadCallPanel({ phone, calls, loading, disabled, starting, logging, onStart, onLog }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('connected');
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [followup, setFollowup] = useState('');
  const providerMode = process.env.NEXT_PUBLIC_CALL_PROVIDER || 'disabled';
  const telHref = buildTelHref(phone);

  async function startCall() {
    try {
      if (!telHref || !triggerPhoneCall(phone)) {
        toast.error('This lead does not have a valid phone number.');
        return;
      }
      await onStart();
      toast.success(providerMode === 'disabled' ? 'Dialer opened and call log created' : 'Call initiated');
    } catch {
      toast.error('Could not start call');
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await onLog({ status, duration_seconds: duration || undefined, notes: notes || undefined, next_followup_at: followup || undefined });
      toast.success('Call log added and lead status updated.');
      setOpen(false);
      setNotes('');
      setDuration('');
      setFollowup('');
      setStatus('connected');
    } catch (error) {
      toast.error(callLogErrorMessage(error));
    }
  }

  if (loading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        Call provider: <span className="font-medium text-slate-900">{providerMode}</span>.
        {(providerMode === 'disabled' || providerMode === 'mock') && (
          <span> This action opens the device dialer using the lead phone number and also records the call attempt in CRM.</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          disabled={disabled || !telHref || starting}
          onClick={startCall}
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
          Start Call
        </button>
        <button className="btn-outline inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm" disabled={disabled || logging} onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Log Call Result
        </button>
      </div>

      {calls.length === 0 ? (
        <EmptyState title="No call history" description="Started and logged calls will appear here." />
      ) : (
        <ol className="space-y-3">
          {calls.map((call) => (
            <li key={call.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip-slate">{call.status}</span>
                <span className="text-sm font-medium text-slate-900">{call.user_name || 'User'}</span>
                <span className="ml-auto text-xs text-slate-500" title={fmtDate(call.created_at)}>{fmtRelative(call.created_at)}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Provider: {call.provider || 'disabled'}{call.duration_seconds ? ` - ${call.duration_seconds}s` : ''}
              </div>
              {call.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{call.notes}</p>}
            </li>
          ))}
        </ol>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Log Call Result" size="sm">
        <form onSubmit={submit} className="space-y-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Status</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="connected">Connected</option>
              <option value="interested">Interested</option>
              <option value="not_answered">Not answered</option>
              <option value="busy">Busy</option>
              <option value="switched_off">Switched off</option>
              <option value="callback_requested">Callback requested</option>
              <option value="follow_up">Follow-up scheduled</option>
              <option value="wrong_number">Wrong number</option>
              <option value="not_interested">Not interested</option>
              <option value="converted">Converted</option>
              <option value="language_barrier">Language barrier</option>
              <option value="custom_remark">Custom remark</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Duration seconds</span>
            <input className="input" type="number" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Follow-up</span>
            <input className="input" type="datetime-local" value={followup} onChange={(e) => setFollowup(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">Notes</span>
            <textarea className="input min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost rounded-lg px-4 py-2 text-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary rounded-lg px-4 py-2 text-sm" disabled={logging}>{logging ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function callLogErrorMessage(error: unknown) {
  const response = (error as {
    response?: {
      data?: {
        message?: string;
        error?: { message?: string };
      };
    };
    message?: string;
  })?.response?.data;
  return response?.message || response?.error?.message || 'Could not log call';
}
