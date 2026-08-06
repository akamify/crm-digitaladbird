'use client';

import { Calendar, MessageSquarePlus } from 'lucide-react';
import type { LeadRemark } from '@/types';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Modal';
import { humanize } from '@/lib/format';
import {
  getLeadRemarkCategoryLabel,
  getLeadRemarkCustomerInterestLabel,
  getLeadRemarkNoteTypeLabel,
  getLeadRemarkPriorityLabel,
} from '@/constants/leadRemarkMeta';
import { formatCompactDateTime, formatDateTimeTooltip, getStatusBadgeVariant } from './leadProfileUtils';

export function LeadRemarkTimeline({
  remarks,
  onAdd,
  canAdd = true,
  addLabel = 'Add remark',
}: {
  remarks: LeadRemark[];
  onAdd: () => void;
  canAdd?: boolean;
  addLabel?: string;
}) {
  return <section className="card-padded"><div className="mb-4 flex items-center gap-2"><h2 className="text-sm font-semibold text-slate-950">Call Logs & Remarks</h2><span className="text-xs text-slate-400">{remarks.length}</span>{canAdd && <Button className="ml-auto" variant="ghost" onClick={onAdd} leftIcon={<MessageSquarePlus className="h-4 w-4" />}>{addLabel}</Button>}</div>{remarks.length === 0 ? <EmptyState title="No remarks yet" description="Call outcomes, notes, and follow-ups will appear here." action={canAdd ? <Button onClick={onAdd}>Add first remark</Button> : undefined} /> : <ol className="relative space-y-5 border-l border-slate-200 pl-5">{remarks.map(remark => <li key={remark.id} className="relative before:absolute before:-left-[25px] before:top-1.5 before:h-2.5 before:w-2.5 before:rounded-full before:bg-brand-500 before:ring-4 before:ring-brand-50"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-slate-900">{remark.by_name || remark.author_name || 'CRM user'}</span><span className={remark.note_type === 'rm_update' ? 'chip-blue' : remark.note_type === 'counselor_update' ? 'chip-green' : 'chip-slate'}>{getLeadRemarkNoteTypeLabel(remark.note_type)}</span>{remark.author_role && <span className="chip-slate">{humanize(remark.author_role)}</span>}{remark.call_status && <span className={getStatusBadgeVariant(remark.call_status)}>{humanize(remark.call_status)}</span>}<time className="ml-auto text-xs text-slate-500" title={formatDateTimeTooltip(remark.created_at)}>{formatCompactDateTime(remark.created_at)}</time></div>{(remark.category || remark.title || remark.priority || remark.customer_interest) && <div className="mt-2 flex flex-wrap gap-2 text-xs">{remark.category && <span className="chip-slate">{getLeadRemarkCategoryLabel(remark.category)}</span>}{remark.priority && <span className={remark.priority === 'urgent' ? 'chip-red' : remark.priority === 'high' ? 'chip-amber' : 'chip-blue'}>{getLeadRemarkPriorityLabel(remark.priority)}</span>}{remark.customer_interest && <span className={remark.customer_interest === 'hot' ? 'chip-red' : remark.customer_interest === 'warm' ? 'chip-amber' : remark.customer_interest === 'cold' ? 'chip-slate' : 'chip-blue'}>{getLeadRemarkCustomerInterestLabel(remark.customer_interest)}</span>}</div>}{remark.title && <p className="mt-2 text-sm font-semibold text-slate-900">{remark.title}</p>}<p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{remark.note || remark.remark}</p>{(remark.next_followup || remark.next_followup_at) && <div className="mt-2 inline-flex items-center gap-1 text-xs text-amber-700"><Calendar className="h-3.5 w-3.5" /> Follow-up {formatCompactDateTime(remark.next_followup || remark.next_followup_at)}</div>}</li>)}</ol>}</section>;
}
