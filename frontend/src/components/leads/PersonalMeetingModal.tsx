'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, Plus, UserRound, Video } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { useCreatePersonalMeeting, useLeadPersonalMeetings, usePersonalMeetingOwnerLookup } from '@/hooks/useCustomerNotes';
import { useAuth } from '@/lib/auth';
import { fmtPhone, humanize } from '@/lib/format';
import type { Lead, PersonalMeetingService } from '@/types';

const SERVICES = [
  ['meta_ads', 'Meta Ads'], ['google_ads', 'Google Ads'], ['website_development', 'Website Development'], ['seo', 'SEO'],
  ['whatsapp_business_api', 'WhatsApp Business API'], ['gmb', 'GMB / Google Business Profile'], ['video_shooting', 'Video Shooting'], ['video_editing', 'Video Editing'],
] as const;
const PACKAGE_DEFAULTS = new Set(['meta_ads', 'google_ads', 'website_development', 'gmb', 'video_editing']);
const OUTCOMES = ['interested', 'proposal_required', 'follow_up_required', 'decision_pending', 'converted', 'not_interested', 'next_personal_meeting_required'];
const OBJECTIONS = ['budget', 'needs_partner_approval', 'already_with_agency', 'result_guarantee', 'timing_issue', 'price_too_high', 'needs_proposal_first', 'other'];

type LeadMeeting = Pick<Lead, 'id' | 'full_name' | 'phone' | 'email'>;

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function asErrorMessage(error: unknown) {
  const response = (error as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response;
  return response?.data?.error?.message || response?.data?.message || 'Could not save personal meeting';
}

function Field({ label, children, optional = false }: { label: string; children: ReactNode; optional?: boolean }) {
  return <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-700">{label}{optional && <span className="ml-1 font-normal text-slate-400">optional</span>}</span>{children}</label>;
}

export function PersonalMeetingModal({ lead, open, onClose }: { lead: LeadMeeting | null; open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const createMeeting = useCreatePersonalMeeting();
  const history = useLeadPersonalMeetings(lead?.id || null, 100);
  const owners = usePersonalMeetingOwnerLookup();
  const [mode, setMode] = useState<'zoom' | 'google_meet' | 'phone_call' | 'in_person' | 'other'>('zoom');
  const [pricingType, setPricingType] = useState<'individual_services' | 'package'>('individual_services');
  const [services, setServices] = useState<PersonalMeetingService[]>([]);
  const [customService, setCustomService] = useState('');
  const [customOwner, setCustomOwner] = useState(false);
  const [ownerId, setOwnerId] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerDesignation, setOwnerDesignation] = useState('');
  const [startAt, setStartAt] = useState(localDateTimeValue());
  const [endAt, setEndAt] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [modeCustom, setModeCustom] = useState('');
  const [packageName, setPackageName] = useState('');
  const [packagePrice, setPackagePrice] = useState('');
  const [packageDuration, setPackageDuration] = useState('');
  const [packageNotes, setPackageNotes] = useState('');
  const [requirements, setRequirements] = useState('');
  const [objections, setObjections] = useState<string[]>([]);
  const [objectionNotes, setObjectionNotes] = useState('');
  const [outcome, setOutcome] = useState('');
  const [summary, setSummary] = useState('');
  const [followupRequired, setFollowupRequired] = useState(false);
  const [followupAt, setFollowupAt] = useState('');
  const [followupNote, setFollowupNote] = useState('');
  const [nextMeetingAt, setNextMeetingAt] = useState('');

  const meetingNumber = (history.data?.rows?.length || 0) + 1;
  const totalQuoted = useMemo(() => pricingType === 'package'
    ? Number(packagePrice || 0)
    : services.reduce((total, service) => total + Number(service.quoted_price || 0), 0), [packagePrice, pricingType, services]);

  useEffect(() => {
    if (!open) return;
    setStartAt(localDateTimeValue()); setEndAt(''); setMode('zoom'); setPricingType('individual_services'); setServices([]);
    setCustomOwner(false); setOwnerId(''); setOwnerName(''); setOwnerDesignation(''); setMeetingLink(''); setModeCustom('');
    setPackageName(''); setPackagePrice(''); setPackageDuration(''); setPackageNotes(''); setRequirements(''); setObjections([]); setObjectionNotes(''); setOutcome(''); setSummary(''); setFollowupRequired(false); setFollowupAt(''); setFollowupNote(''); setNextMeetingAt('');
  }, [open, lead?.id]);

  useEffect(() => {
    if (!open || ownerId || customOwner || !owners.data?.length) return;
    const preferredOwner = owners.data.find((owner) => owner.full_name?.trim().toLowerCase() === 'rajesh yadav');
    if (preferredOwner) setOwnerId(preferredOwner.id);
  }, [customOwner, open, ownerId, owners.data]);

  function toggleService(key: string, name: string) {
    setServices((current) => {
      const exists = current.some((service) => service.service_key === key);
      if (exists) return current.filter((service) => service.service_key !== key);
      return [...current, { service_key: key, service_name: name, client_interested: false, is_package_item: pricingType === 'package' }];
    });
  }

  function updateService(key: string, patch: Partial<PersonalMeetingService>) {
    setServices((current) => current.map((service) => service.service_key === key ? { ...service, ...patch } : service));
  }

  function switchPricing(next: 'individual_services' | 'package') {
    setPricingType(next);
    if (next === 'package' && !services.length) {
      setServices(SERVICES.filter(([key]) => PACKAGE_DEFAULTS.has(key)).map(([service_key, service_name]) => ({ service_key, service_name, is_package_item: true, client_interested: false })));
    }
  }

  function addCustomService() {
    const name = customService.trim();
    if (!name) return;
    const key = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    if (services.some((service) => service.service_key === key)) return toast.error('This service is already selected');
    setServices((current) => [...current, { service_key: key, service_name: name, is_custom: true, client_interested: false, is_package_item: pricingType === 'package' }]);
    setCustomService('');
  }

  function submit() {
    if (!lead) return;
    if (!startAt || !summary.trim()) return toast.error('Meeting date, time, and discussion summary are required');
    if (endAt && new Date(endAt) < new Date(startAt)) return toast.error('End time cannot be before start time');
    if (!customOwner && !ownerId) return toast.error('Select who took the meeting');
    if (customOwner && !ownerName.trim()) return toast.error('Enter the meeting person name');
    if (mode === 'other' && !modeCustom.trim()) return toast.error('Enter the meeting mode');
    if (pricingType === 'package' && !services.length) return toast.error('Select package services');
    if (followupRequired && !followupAt) return toast.error('Select the follow-up time');
    if (outcome === 'next_personal_meeting_required' && !nextMeetingAt) return toast.error('Select the next meeting time');
    createMeeting.mutate({
      leadId: lead.id, note_kind: 'personal_meeting', customer_name: lead.full_name || 'Lead', customer_phone: lead.phone || undefined,
      meeting_at: new Date(startAt).toISOString(), meeting_end_at: endAt ? new Date(endAt).toISOString() : null,
      meeting_owner_user_id: customOwner ? null : ownerId, meeting_owner_custom_name: customOwner ? ownerName.trim() : null, meeting_owner_custom_designation: customOwner ? ownerDesignation.trim() || null : null,
      meeting_mode: mode, meeting_mode_custom: mode === 'other' ? modeCustom.trim() : null, meeting_link: meetingLink.trim() || null,
      pricing_type: pricingType, personal_meeting_services: services.map((service) => ({ ...service, is_package_item: pricingType === 'package', quoted_price: pricingType === 'individual_services' && service.quoted_price !== null && service.quoted_price !== undefined ? Number(service.quoted_price) : null })),
      package_name: pricingType === 'package' ? packageName.trim() || null : null, package_price: pricingType === 'package' && packagePrice !== '' ? Number(packagePrice) : null,
      package_duration: pricingType === 'package' ? packageDuration.trim() || null : null, package_pricing_notes: pricingType === 'package' ? packageNotes.trim() || null : null,
      client_requirements: requirements.trim() || null, client_objections: objections, objection_notes: objectionNotes.trim() || null,
      meeting_outcome: outcome || null, initial_entry_text: summary.trim(), followup_required: followupRequired,
      followup_at: followupRequired ? new Date(followupAt).toISOString() : null, followup_note: followupRequired ? followupNote.trim() || null : null,
      next_meeting_at: nextMeetingAt ? new Date(nextMeetingAt).toISOString() : null,
    }, { onSuccess: () => { toast.success('Personal meeting saved'); onClose(); }, onError: (error) => toast.error(asErrorMessage(error)) });
  }

  return <Modal open={open} onClose={onClose} title={`Personal Meeting #${meetingNumber}`} description={lead ? `Lead-linked record for ${lead.full_name || 'this client'}.` : 'Record the personal meeting.'} size="xl">
    {!lead ? null : <div className="space-y-5">
      <div className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 md:grid-cols-4">
        <div><div className="text-xs font-semibold text-blue-700">CLIENT</div><div className="mt-1 text-sm font-semibold text-slate-900">{lead.full_name || 'Unnamed lead'}</div></div>
        <div><div className="text-xs font-semibold text-blue-700">PHONE</div><div className="mt-1 text-sm text-slate-800">{fmtPhone(lead.phone) || 'Not available'}</div></div>
        <div><div className="text-xs font-semibold text-blue-700">EMAIL</div><div className="mt-1 truncate text-sm text-slate-800" title={lead.email || undefined}>{lead.email || 'Not available'}</div></div>
        <div><div className="text-xs font-semibold text-blue-700">COUNSELOR</div><div className="mt-1 text-sm text-slate-800">{user?.name || 'Current user'}</div></div>
      </div>
      <Section icon={<CalendarDays className="h-4 w-4" />} title="Meeting details"><div className="grid gap-3 md:grid-cols-3"><Field label="Start"><input type="datetime-local" className="input" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></Field><Field label="End" optional><input type="datetime-local" className="input" value={endAt} onChange={(e) => setEndAt(e.target.value)} /></Field><Field label="Meeting mode"><select className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="zoom">Zoom</option><option value="google_meet">Google Meet</option><option value="phone_call">Phone Call</option><option value="in_person">In Person</option><option value="other">Other</option></select></Field></div><div className="mt-3 grid gap-3 md:grid-cols-2">{mode === 'other' && <Field label="Other mode"><input className="input" value={modeCustom} onChange={(e) => setModeCustom(e.target.value)} /></Field>}<Field label="Meeting link" optional><input className="input" placeholder="https://..." value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} /></Field></div></Section>
      <Section icon={<UserRound className="h-4 w-4" />} title="Participants"><div className="grid gap-3 md:grid-cols-2"><Field label="Meeting taken by"><select className="input" value={customOwner ? '__custom__' : ownerId} onChange={(e) => { const value = e.target.value; setCustomOwner(value === '__custom__'); setOwnerId(value === '__custom__' ? '' : value); }}><option value="">Select marketing head / owner</option>{owners.data?.map((owner) => <option key={owner.id} value={owner.id}>{owner.full_name} · {humanize(owner.role)}</option>)}<option value="__custom__">+ Add another name</option></select></Field>{customOwner && <><Field label="Custom person"><input className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} /></Field><Field label="Designation" optional><input className="input" value={ownerDesignation} onChange={(e) => setOwnerDesignation(e.target.value)} /></Field></>}</div></Section>
      <Section icon={<Video className="h-4 w-4" />} title="Services & pricing"><div className="flex gap-2"><button type="button" onClick={() => switchPricing('individual_services')} className={pricingType === 'individual_services' ? 'btn-primary rounded-lg px-3 py-2 text-sm' : 'btn-outline rounded-lg px-3 py-2 text-sm'}>Individual services</button><button type="button" onClick={() => switchPricing('package')} className={pricingType === 'package' ? 'btn-primary rounded-lg px-3 py-2 text-sm' : 'btn-outline rounded-lg px-3 py-2 text-sm'}>Package</button></div><div className="mt-3 grid gap-2 md:grid-cols-2">{SERVICES.map(([key, name]) => <ServiceToggle key={key} name={name} selected={services.find((service) => service.service_key === key)} onToggle={() => toggleService(key, name)} onUpdate={(patch) => updateService(key, patch)} pricingType={pricingType} />)}{services.filter((service) => service.is_custom).map((service) => <ServiceToggle key={service.service_key} name={service.service_name} selected={service} onToggle={() => setServices((current) => current.filter((item) => item.service_key !== service.service_key))} onUpdate={(patch) => updateService(service.service_key, patch)} pricingType={pricingType} />)}</div><div className="mt-3 flex gap-2"><input className="input" placeholder="Add custom service" value={customService} onChange={(e) => setCustomService(e.target.value)} /><button type="button" onClick={addCustomService} className="btn-outline shrink-0 rounded-lg px-3"><Plus className="h-4 w-4" /></button></div>{pricingType === 'package' && <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 md:grid-cols-2"><Field label="Package name" optional><input className="input" value={packageName} onChange={(e) => setPackageName(e.target.value)} /></Field><Field label="Package price" optional><input type="number" min="0" className="input" value={packagePrice} onChange={(e) => setPackagePrice(e.target.value)} /></Field><Field label="Package duration" optional><input className="input" value={packageDuration} onChange={(e) => setPackageDuration(e.target.value)} /></Field><Field label="Pricing notes" optional><input className="input" value={packageNotes} onChange={(e) => setPackageNotes(e.target.value)} /></Field></div>}<div className="mt-3 text-xs font-medium text-slate-500">Quoted amount: ₹{totalQuoted.toLocaleString('en-IN')}</div></Section>
      <Section title="Discussion & outcome"><div className="grid gap-3 md:grid-cols-2"><Field label="Client requirements" optional><textarea className="input min-h-24 resize-y" value={requirements} onChange={(e) => setRequirements(e.target.value)} /></Field><Field label="Outcome" optional><select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">Select outcome</option>{OUTCOMES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></Field></div><div className="mt-3"><Field label="Client objections" optional><div className="flex flex-wrap gap-2">{OBJECTIONS.map((value) => <button key={value} type="button" onClick={() => setObjections((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} className={objections.includes(value) ? 'chip-blue' : 'chip-slate'}>{humanize(value)}</button>)}</div></Field></div><div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="Objection notes" optional><textarea className="input min-h-20 resize-y" value={objectionNotes} onChange={(e) => setObjectionNotes(e.target.value)} /></Field><Field label="Meeting discussion / summary"><textarea className="input min-h-20 resize-y" placeholder="What was discussed, pricing, requirements, and next decision..." value={summary} onChange={(e) => setSummary(e.target.value)} /></Field></div><div className="mt-4 rounded-xl border border-slate-200 p-3"><label className="flex items-center gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" checked={followupRequired} onChange={(e) => setFollowupRequired(e.target.checked)} /> Follow-up required</label>{followupRequired && <div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="Follow-up time"><input type="datetime-local" className="input" value={followupAt} onChange={(e) => setFollowupAt(e.target.value)} /></Field><Field label="Follow-up note" optional><input className="input" value={followupNote} onChange={(e) => setFollowupNote(e.target.value)} /></Field></div>}</div>{outcome === 'next_personal_meeting_required' && <div className="mt-3"><Field label="Next personal meeting time"><input type="datetime-local" className="input max-w-sm" value={nextMeetingAt} onChange={(e) => setNextMeetingAt(e.target.value)} /></Field></div>}</Section>
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button><button type="button" onClick={submit} disabled={createMeeting.isPending} className="btn-primary rounded-lg px-4 py-2 text-sm">{createMeeting.isPending ? 'Saving...' : 'Save Personal Meeting'}</button></div>
    </div>}
  </Modal>;
}

function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) { return <section className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">{icon}{title}</h3><div className="mt-3">{children}</div></section>; }

function ServiceToggle({ name, selected, onToggle, onUpdate, pricingType }: { name: string; selected?: PersonalMeetingService; onToggle: () => void; onUpdate: (patch: Partial<PersonalMeetingService>) => void; pricingType: 'individual_services' | 'package' }) { return <div className={selected ? 'rounded-xl border border-blue-200 bg-blue-50/50 p-3' : 'rounded-xl border border-slate-200 p-3'}><label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800"><input type="checkbox" checked={!!selected} onChange={onToggle} /> {name}</label>{selected && <div className="mt-3 grid gap-2 sm:grid-cols-2"><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={!!selected.client_interested} onChange={(e) => onUpdate({ client_interested: e.target.checked })} /> Client interested</label>{pricingType === 'individual_services' && <><input type="number" min="0" className="input h-9 text-sm" placeholder="Quoted price" value={selected.quoted_price ?? ''} onChange={(e) => onUpdate({ quoted_price: e.target.value === '' ? null : Number(e.target.value) })} /><input className="input h-9 text-sm" placeholder="Pricing note" value={selected.pricing_note ?? ''} onChange={(e) => onUpdate({ pricing_note: e.target.value })} /></>}</div>}</div>; }
