'use client';

import { CalendarClock, ChevronDown, UserRound } from 'lucide-react';
import type { LeadDetail } from '@/types';
import { humanize } from '@/lib/format';
import { formatCompactDateTime, formatDateTimeTooltip, getLeadCategoryLabel, isMeaningfulValue } from './leadProfileUtils';

function Row({ label, value, title }: { label: string; value: unknown; title?: string }) {
  if (!isMeaningfulValue(value)) return null;
  return <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="max-w-[65%] break-words text-right text-sm font-medium text-slate-800" title={title}>{String(value)}</dd></div>;
}

export function LeadSummaryCard({ lead }: { lead: LeadDetail }) {
  const location = [lead.city, lead.state].filter(isMeaningfulValue).join(', ');
  return (
    <section className="card-padded">
      <h2 className="text-sm font-semibold text-slate-950">Lead Summary</h2>
      <dl className="mt-3">
        <Row label="Assigned to" value={lead.assigned_to_name || 'Unassigned'} />
        <Row label="Source" value={humanize(lead.source)} />
        <Row label="Lead category" value={getLeadCategoryLabel(lead.category)} />
        <Row label="Received" value={formatCompactDateTime(lead.created_at)} title={formatDateTimeTooltip(lead.created_at)} />
        <Row label="Call attempts" value={lead.call_attempts ?? 0} />
        <Row label="Last call" value={lead.last_call_at ? formatCompactDateTime(lead.last_call_at) : null} title={formatDateTimeTooltip(lead.last_call_at)} />
        <Row label="Next follow-up" value={lead.next_followup_at ? formatCompactDateTime(lead.next_followup_at) : null} title={formatDateTimeTooltip(lead.next_followup_at)} />
        <Row label="Campaign" value={lead.campaign_name || lead.campaign_label} />
        <Row label="Location" value={location} />
      </dl>
    </section>
  );
}

export function AssignmentCard({ lead }: { lead: LeadDetail }) {
  return (
    <details className="card-padded group" open={lead.history.length <= 1}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-950">
        <UserRound className="h-4 w-4 text-slate-500" /> Assignment
        <ChevronDown className="ml-auto h-4 w-4 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-500">Current: </span><span className="font-medium text-slate-900">{lead.assigned_to_name || 'Unassigned'}</span></div>
      {lead.history.length > 0 && <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">{lead.history.map((item, index) => (
        <li key={`${item.assigned_at}-${index}`} className="relative text-xs text-slate-600 before:absolute before:-left-[19px] before:top-1 before:h-2 before:w-2 before:rounded-full before:bg-slate-400">
          <div className="font-medium text-slate-800">{item.user_name || 'Unknown user'}</div>
          <div>{formatCompactDateTime(item.assigned_at)}{item.unassigned_at ? ` to ${formatCompactDateTime(item.unassigned_at)}` : ' · Current'}</div>
          {isMeaningfulValue(item.reason) && <div className="mt-0.5">{item.reason}</div>}
        </li>
      ))}</ol>}
    </details>
  );
}

export function FollowUpCard({ lead }: { lead: LeadDetail }) {
  return <section className="card-padded"><div className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-amber-600" /><h2 className="text-sm font-semibold text-slate-950">Follow-up</h2></div>{lead.next_followup_at ? <div className="mt-3"><div className="text-sm font-medium text-slate-900">{formatCompactDateTime(lead.next_followup_at)}</div><div className="mt-1 text-xs text-slate-500">Scheduled next action</div></div> : <p className="mt-3 text-sm text-slate-500">No follow-up scheduled.</p>}</section>;
}

export function TechnicalMetaDetails({ lead }: { lead: LeadDetail }) {
  const fields = [
    ['Form ID', lead.meta_form_id], ['Campaign ID', lead.meta_campaign_id], ['Ad Set ID', lead.meta_adset_id],
    ['Ad ID', lead.meta_ad_id], ['Meta Page ID', lead.meta_page_id],
    ['Meta Lead Time', lead.meta_created_time ? formatCompactDateTime(lead.meta_created_time) : null],
    ['Campaign label', lead.campaign_label], ['Category source', lead.category_source],
  ].filter(([, value]) => isMeaningfulValue(value));
  if (!fields.length) return null;
  return <details className="card-padded group"><summary className="flex cursor-pointer list-none items-center text-sm font-semibold text-slate-950">Technical Meta Details<ChevronDown className="ml-auto h-4 w-4 text-slate-400 transition group-open:rotate-180" /></summary><dl className="mt-3">{fields.map(([label, value]) => <Row key={String(label)} label={String(label)} value={value} />)}</dl></details>;
}
