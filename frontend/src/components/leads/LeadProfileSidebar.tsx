'use client';

import { CalendarClock, ChevronDown, UserRound } from 'lucide-react';
import Link from 'next/link';
import type { LeadDetail } from '@/types';
import { useLeadPersonalMeetings } from '@/hooks/useCustomerNotes';
import { humanize } from '@/lib/format';
import {
  getLeadRemarkCategoryLabel,
  getLeadRemarkCustomerInterestLabel,
  getLeadRemarkPriorityLabel,
} from '@/constants/leadRemarkMeta';
import { formatCompactDateTime, formatDateTimeTooltip, formatRelativeTime, getLeadCategoryLabel, isMeaningfulValue } from './leadProfileUtils';

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
        <Row label="Source" value={lead.source_label || humanize(lead.source)} />
        {lead.source === 'manual' && (
          <>
            <Row label="Added by" value={lead.manual_added_by_name || lead.created_by_name || 'Not available'} />
            <Row
              label="Added at"
              value={lead.manual_added_at ? formatCompactDateTime(lead.manual_added_at) : null}
              title={formatDateTimeTooltip(lead.manual_added_at)}
            />
          </>
        )}
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
  const nextCall = lead.next_scheduled_call;
  if (nextCall) {
    return (
      <section className="card-padded">
        <div className="flex items-center gap-2">
          <CalendarClock className={nextCall.is_overdue ? 'h-4 w-4 text-rose-600' : 'h-4 w-4 text-amber-600'} />
          <h2 className="text-sm font-semibold text-slate-950">Follow-up</h2>
        </div>
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className={nextCall.is_overdue ? 'text-sm font-semibold text-rose-700' : 'text-sm font-semibold text-slate-900'}>
            {nextCall.is_overdue ? 'Overdue call' : 'Next call'}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-900" title={formatDateTimeTooltip(nextCall.scheduled_at)}>
            {formatCompactDateTime(nextCall.scheduled_at)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {humanize(nextCall.trigger_reason)} Attempt {nextCall.attempt_number}
          </div>
          <div className={nextCall.is_overdue ? 'mt-2 text-xs font-medium text-rose-700' : 'mt-2 text-xs text-slate-500'}>
            {nextCall.is_overdue ? `Due ${formatRelativeTime(nextCall.scheduled_at)}` : formatRelativeTime(nextCall.scheduled_at)}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card-padded">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-slate-950">Follow-up</h2>
      </div>
      {lead.next_followup_at ? (
        <div className="mt-3">
          <div className="text-sm font-medium text-slate-900">{formatCompactDateTime(lead.next_followup_at)}</div>
          <div className="mt-1 text-xs text-slate-500">Scheduled next action</div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No follow-up scheduled.</p>
      )}
    </section>
  );
}

export function PersonalMeetingsCard({ lead }: { lead: LeadDetail }) {
  const meetings = useLeadPersonalMeetings(lead.id, 5);
  const rows = meetings.data?.rows || [];
  return (
    <section className="card-padded">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-blue-600" />
        <h2 className="text-sm font-semibold text-slate-950">Personal Meetings</h2>
        <Link href={`/personal-meetings?leadId=${encodeURIComponent(lead.id)}`} className="ml-auto text-xs font-medium text-blue-700 hover:underline">View all</Link>
      </div>
      {meetings.isLoading ? <p className="mt-3 text-sm text-slate-500">Loading meetings...</p> : !rows.length ? <p className="mt-3 text-sm text-slate-500">No personal meeting recorded.</p> : (
        <div className="mt-3 space-y-2">
          {rows.map((meeting) => (
            <Link key={meeting.id} href={`/personal-meetings?meetingId=${encodeURIComponent(meeting.id)}&leadId=${encodeURIComponent(lead.id)}`} className="block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition hover:border-blue-200 hover:bg-blue-50/50">
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-900">Personal Meeting #{meeting.meeting_number || '?'}</span>{meeting.meeting_outcome && <span className="chip-blue">{humanize(meeting.meeting_outcome)}</span>}</div>
              <div className="mt-1 text-xs text-slate-500">{meeting.meeting_at ? formatCompactDateTime(meeting.meeting_at) : 'Time not recorded'} · {meeting.meeting_owner_name || meeting.meeting_owner_custom_name || 'Owner not set'}</div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function LatestRmUpdateCard({ lead }: { lead: LeadDetail }) {
  const update = lead.latest_rm_update;
  if (!update) {
    return <section className="card-padded"><h2 className="text-sm font-semibold text-slate-950">Latest RM Update</h2><p className="mt-3 text-sm text-slate-500">No RM update has been added yet.</p></section>;
  }
  return (
    <section className="card-padded">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-blue-600" />
        <h2 className="text-sm font-semibold text-slate-950">Latest RM Update</h2>
      </div>
      <div className="mt-3 space-y-2">
        {update.title && <div className="text-sm font-semibold text-slate-900">{update.title}</div>}
        {update.note && <p className="text-sm text-slate-700 whitespace-pre-wrap">{update.note}</p>}
        <div className="flex flex-wrap gap-2 text-xs">
          {update.category && <span className="chip-slate">{getLeadRemarkCategoryLabel(update.category)}</span>}
          {update.priority && <span className={update.priority === 'urgent' ? 'chip-red' : update.priority === 'high' ? 'chip-amber' : 'chip-blue'}>{getLeadRemarkPriorityLabel(update.priority)}</span>}
          {update.customer_interest && <span className={update.customer_interest === 'hot' ? 'chip-red' : update.customer_interest === 'warm' ? 'chip-amber' : update.customer_interest === 'cold' ? 'chip-slate' : 'chip-blue'}>{getLeadRemarkCustomerInterestLabel(update.customer_interest)}</span>}
        </div>
        <Row label="Next follow-up" value={update.next_followup ? formatCompactDateTime(update.next_followup) : null} title={formatDateTimeTooltip(update.next_followup)} />
        <Row label="RM" value={update.author?.name || null} />
        <Row label="Role" value={update.author?.role ? humanize(update.author.role) : null} />
        <Row label="Updated" value={update.updated_at ? formatCompactDateTime(update.updated_at) : null} title={formatDateTimeTooltip(update.updated_at)} />
      </div>
    </section>
  );
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
