'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight, Eye, Plus } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { PersonalMeetingModal } from '@/components/leads/PersonalMeetingModal';
import { useCustomerNote, useCustomerNotes } from '@/hooks/useCustomerNotes';
import { useLead } from '@/hooks/useLeads';
import { formatISTCompact } from '@/lib/date';
import { fmtPhone, humanize } from '@/lib/format';
import type { CustomerNote } from '@/types';

type MeetingTab = 'today' | 'upcoming' | 'completed' | 'all';

export default function PersonalMeetingsPage() {
  return <AppShell title="Personal Meetings" subtitle="Lead-linked meeting records, pricing, outcomes, and follow-up context"><PersonalMeetingsInner /></AppShell>;
}

function PersonalMeetingsInner() {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const initialLeadId = params.get('leadId') || '';
  const initialOpen = params.get('create') === '1';
  const initialMeetingId = params.get('meetingId') || '';
  const [tab, setTab] = useState<MeetingTab>('all');
  const [q, setQ] = useState('');
  const [leadId, setLeadId] = useState(initialLeadId);
  const [createOpen, setCreateOpen] = useState(initialOpen);
  const [selectedMeetingId, setSelectedMeetingId] = useState(initialMeetingId);
  const [page, setPage] = useState(1);
  const lead = useLead(leadId || null);
  const meetings = useCustomerNotes({ note_kind: 'personal_meeting', meeting_state: tab, q, lead_id: leadId || undefined, page, page_size: 20 });
  const detail = useCustomerNote(selectedMeetingId || null);

  useEffect(() => { setPage(1); }, [tab, q, leadId]);

  const rows = meetings.data?.rows || [];
  const total = meetings.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / 20));

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center">
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">{(['today', 'upcoming', 'completed', 'all'] as MeetingTab[]).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={tab === item ? 'rounded-lg bg-white px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm' : 'rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-white/60'}>{humanize(item)}</button>)}</div>
      <input className="input flex-1" placeholder="Search lead, phone, business, or discussion" value={q} onChange={(event) => setQ(event.target.value)} />
      <div className="flex gap-2"><input className="input w-48" placeholder="Lead ID (optional)" value={leadId} onChange={(event) => setLeadId(event.target.value)} />{lead.data && <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm"><Plus className="h-4 w-4" /> Add Meeting</button>}</div>
    </div>
    {leadId && !lead.isLoading && !lead.data && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Lead could not be loaded. Check the lead access or choose it from the Leads page action menu.</div>}
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarDays className="h-4 w-4 text-blue-600" /> {total} personal meetings</div>{lead.data && <div className="text-xs text-slate-500">Linked lead: {lead.data.full_name} · {fmtPhone(lead.data.phone)}</div>}</div>{meetings.isLoading ? <div className="space-y-3 p-4"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : !rows.length ? <EmptyState title="No personal meetings" description={leadId ? 'Create the first meeting for this lead.' : 'Use Add Personal Meeting from a lead action menu to record a meeting.'} /> : <div className="overflow-x-auto"><table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Lead</th><th className="px-4 py-3">Meeting</th><th className="px-4 py-3">Counselor</th><th className="px-4 py-3">Taken by</th><th className="px-4 py-3">Date / time</th><th className="px-4 py-3">Services / Quote</th><th className="px-4 py-3">Outcome</th><th className="px-4 py-3" /></tr></thead><tbody>{rows.map((meeting) => <tr key={meeting.id} className="border-t border-slate-100 hover:bg-slate-50"><td className="px-4 py-3"><Link href={meeting.lead_id ? `/leads/${meeting.lead_id}` : '#'} className="font-medium text-slate-900 hover:text-blue-700">{meeting.lead_name || meeting.customer_name}</Link><div className="mt-1 text-xs text-slate-500">{fmtPhone(meeting.customer_phone)}</div></td><td className="px-4 py-3 font-medium text-slate-800">#{meeting.meeting_number || '?'}</td><td className="px-4 py-3 text-slate-600">{meeting.counselor_name || 'Not set'}</td><td className="px-4 py-3 text-slate-600">{meeting.meeting_owner_name || meeting.meeting_owner_custom_name || 'Not set'}</td><td className="px-4 py-3 text-slate-600">{meeting.meeting_at ? formatISTCompact(meeting.meeting_at) : 'Not set'}</td><td className="px-4 py-3"><div className="max-w-52 truncate text-slate-700">{meeting.personal_meeting_services?.map((service) => service.service_name).join(', ') || 'No services'}</div><div className="mt-1 text-xs text-slate-500">₹{quotedAmount(meeting).toLocaleString('en-IN')}</div></td><td className="px-4 py-3">{meeting.meeting_outcome ? <span className="chip-blue">{humanize(meeting.meeting_outcome)}</span> : <span className="text-slate-400">Not set</span>}</td><td className="px-4 py-3"><button type="button" onClick={() => setSelectedMeetingId(meeting.id)} className="btn-ghost inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs"><Eye className="h-3.5 w-3.5" /> View</button></td></tr>)}</tbody></table></div>} {pages > 1 && <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="btn-outline inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"><ChevronLeft className="h-3.5 w-3.5" /> Prev</button><span className="text-xs text-slate-500">Page {page} of {pages}</span><button type="button" onClick={() => setPage((value) => Math.min(pages, value + 1))} disabled={page === pages} className="btn-outline inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50">Next <ChevronRight className="h-3.5 w-3.5" /></button></div>}</section>
    <PersonalMeetingModal lead={lead.data || null} open={createOpen} onClose={() => setCreateOpen(false)} />
    <MeetingDetailModal noteId={selectedMeetingId || null} onClose={() => setSelectedMeetingId('')} note={detail.data || null} loading={detail.isLoading} />
  </div>;
}

function quotedAmount(meeting: CustomerNote) { return meeting.pricing_type === 'package' ? Number(meeting.package_price || 0) : (meeting.personal_meeting_services || []).reduce((total, service) => total + Number(service.quoted_price || 0), 0); }

function MeetingDetailModal({ noteId, note, loading, onClose }: { noteId: string | null; note: CustomerNote | null; loading: boolean; onClose: () => void }) { return <Modal open={!!noteId} onClose={onClose} title={note ? `Personal Meeting #${note.meeting_number || '?'}` : 'Personal Meeting'} description="Structured meeting history" size="lg">{loading ? <Skeleton className="h-72" /> : !note ? null : <div className="space-y-4"><div className="grid gap-3 rounded-xl bg-slate-50 p-3 md:grid-cols-3"><Info label="Client" value={note.customer_name} /><Info label="Counselor" value={note.counselor_name} /><Info label="Taken by" value={note.meeting_owner_name || note.meeting_owner_custom_name} /><Info label="Time" value={note.meeting_at ? `${formatISTCompact(note.meeting_at)}${note.meeting_end_at ? ` - ${formatISTCompact(note.meeting_end_at)}` : ''}` : null} /><Info label="Mode" value={humanize(note.meeting_mode_custom || note.meeting_mode || '')} /><Info label="Outcome" value={humanize(note.meeting_outcome || '')} /></div><DetailBlock title="Services" value={note.personal_meeting_services?.map((service) => `${service.service_name}${service.client_interested ? ' · Interested' : ''}${service.quoted_price ? ` · ₹${Number(service.quoted_price).toLocaleString('en-IN')}` : ''}`).join('\n')} /><DetailBlock title="Package" value={note.pricing_type === 'package' ? `${note.package_name || 'Package'} · ₹${Number(note.package_price || 0).toLocaleString('en-IN')} ${note.package_duration || ''}\n${note.package_pricing_notes || ''}` : null} /><DetailBlock title="Requirements" value={note.client_requirements} /><DetailBlock title="Objections" value={[...(note.client_objections || []), note.objection_notes].filter(Boolean).map(humanize).join(', ')} /><DetailBlock title="Discussion" value={note.entries?.[0]?.entry_text || note.latest_entry_text} /><DetailBlock title="Meeting follow-up" value={note.followup_required ? `${note.followup_at ? formatISTCompact(note.followup_at) : ''} ${note.followup_note || ''}` : null} /><DetailBlock title="Next personal meeting" value={note.next_meeting_at ? formatISTCompact(note.next_meeting_at) : null} /></div>}</Modal>; }
function Info({ label, value }: { label: string; value?: string | null }) { return <div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-sm font-medium text-slate-800">{value || 'Not set'}</div></div>; }
function DetailBlock({ title, value }: { title: string; value?: string | null }) { return value ? <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div><div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{value}</div></div> : null; }
