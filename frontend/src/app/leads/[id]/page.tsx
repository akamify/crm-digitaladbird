'use client';
import { useState, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Lock, Unlock, Phone, Mail, MapPin, Tag, Calendar,
  MessageSquarePlus, UserCog, ClipboardList, Briefcase, MessageCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Skeleton, EmptyState, StatusChip, PageLoader } from '@/components/ui/Modal';
import { RemarkModal } from '@/components/leads/RemarkModal';
import { ReassignModal } from '@/components/leads/ReassignModal';
import { WorkflowPanel } from '@/components/leads/WorkflowPanel';
import { LeadCommunicationPanel } from '@/components/leads/LeadCommunicationPanel';
import { LeadCategoryBadge } from '@/components/leads/LeadCategoryBadge';
import { useLead, useLockLead, useUnlockLead } from '@/hooks/useLeads';
import { useAuth } from '@/lib/auth';
import { useUpdateLeadCategory } from '@/hooks/useAdminEnterprise';
import { fmtDate, fmtRelative, fmtPhone, humanize, stageChip, clsx } from '@/lib/format';
import { buildTelHref, triggerPhoneCall } from '@/lib/phone';

export default function LeadDetailPage() {
  return (
    <AppShell title="Lead detail" subtitle="Full information, call log, and assignment history">
      <LeadDetailInner />
    </AppShell>
  );
}

function LeadDetailInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { data: lead, isLoading } = useLead(id);
  const lock   = useLockLead();
  const unlock = useUnlockLead();
  const updateCategory = useUpdateLeadCategory();

  const [remarkOpen, setRemarkOpen]     = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);

  if (!user) return <PageLoader />;
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-44" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!lead) {
    return (
      <EmptyState
        title="Lead not found"
        description="It may have been deleted or you may not have access."
        action={<Button onClick={() => router.push('/leads')} leftIcon={<ArrowLeft className="h-4 w-4" />}>Back to leads</Button>}
      />
    );
  }

  const lockedByMe   = lead.locked_by_user_id === user.id;
  const lockedByOther = !!lead.locked_until && new Date(lead.locked_until) > new Date() && !lockedByMe;
  const canReassign  = user.role === 'super_admin' || user.role === 'rm';
  const canEditCategory = user.role === 'super_admin' || user.role === 'admin';
  const telHref = buildTelHref(lead.phone);

  return (
    <div className="space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3 w-3" /> Back to leads
      </Link>

      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold text-slate-900">
                {lead.full_name || <span className="italic text-slate-500">No name on lead</span>}
              </h2>
              <span className={stageChip[lead.stage] || 'chip-slate'}>{humanize(lead.stage)}</span>
              <StatusChip status={lead.call_status} />
              <LeadCategoryBadge category={lead.category} />
              {lockedByOther && (
                <span className="chip-amber inline-flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Locked by another rep
                </span>
              )}
              {lockedByMe && (
                <span className="chip-pink inline-flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Locked by you
                </span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1 text-sm text-slate-600 sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-slate-400" />
                <span className="tabular-nums">{fmtPhone(lead.phone)}</span>
              </div>
              {lead.email && (
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  <span className="truncate">{lead.email}</span>
                </div>
              )}
              {(lead.city || lead.state) && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  <span>{[lead.city, lead.state].filter(Boolean).join(', ')}</span>
                </div>
              )}
              {lead.product_tag && (
                <div className="flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5 text-slate-400" />
                  <span>{lead.product_tag}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEditCategory && (
              <select
                className="input h-9 w-auto text-xs"
                aria-label="Lead category"
                value={lead.category || 'unknown'}
                disabled={updateCategory.isPending}
                onChange={(event) => {
                  const category = event.target.value as 'trader' | 'partner' | 'unknown';
                  if (!window.confirm(`Change this lead category to ${category === 'trader' ? 'Trader Lead' : category === 'partner' ? 'Partner Lead' : 'Unknown'}?`)) return;
                  updateCategory.mutate({ leadId: id, category, reason: 'Manual correction from lead detail' }, {
                    onSuccess: () => toast.success('Lead category updated'),
                    onError: () => toast.error('Category update failed'),
                  });
                }}
              >
                <option value="trader">Trader Lead</option>
                <option value="partner">Partner Lead</option>
                <option value="unknown">Unknown</option>
              </select>
            )}
            {lockedByMe ? (
              <Button
                variant="ghost" leftIcon={<Unlock className="h-4 w-4" />}
                loading={unlock.isPending}
                onClick={() => unlock.mutate({ id }, {
                  onSuccess: () => toast.success('Lock released'),
                  onError: () => toast.error('Failed to release lock'),
                })}
              >Release lock</Button>
            ) : (
              <Button
                variant="outline" leftIcon={<Lock className="h-4 w-4" />}
                loading={lock.isPending}
                disabled={lockedByOther}
                onClick={() => lock.mutate({ id, minutes: 10 }, {
                  onSuccess: () => toast.success('Lead locked for 10 minutes'),
                  onError:   () => toast.error('Could not acquire lock'),
                })}
              >
                {lockedByOther ? 'Locked by other' : 'Lock for call'}
              </Button>
            )}
            <Button
              variant="outline" leftIcon={<MessageCircle className="h-4 w-4" />}
              onClick={() => router.push(`/chat?leadId=${id}`)}
            >Chat</Button>
            {telHref ? (
              <a
                href={telHref}
                onClick={() => {
                  if (!triggerPhoneCall(lead.phone)) {
                    toast.error('This lead does not have a valid phone number.');
                  }
                }}
                className="btn-outline inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition"
              >
                <Phone className="h-4 w-4" />
                <span>Call</span>
              </a>
            ) : (
              <Button
                variant="outline" leftIcon={<Phone className="h-4 w-4" />}
                disabled
              >Call</Button>
            )}
            <Button
              variant="primary" leftIcon={<MessageSquarePlus className="h-4 w-4" />}
              onClick={() => setRemarkOpen(true)}
            >Add remark</Button>
            {canReassign && (
              <Button
                variant="ghost" leftIcon={<UserCog className="h-4 w-4" />}
                onClick={() => setReassignOpen(true)}
              >Reassign</Button>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <Meta label="Assigned to"   value={lead.assigned_to_name || '—'} />
          <Meta label="Source"        value={humanize(lead.source)} />
          <Meta label="Lead category" value={lead.category === 'trader' ? 'Trader Lead' : lead.category === 'partner' ? 'Partner Lead' : 'Unknown'} />
          <Meta label="Category source" value={humanize(lead.category_source || 'unknown')} />
          <Meta label="Form ID"       value={lead.meta_form_id || '—'} mono />
          <Meta label="Campaign label" value={lead.campaign_label || '—'} />
          <Meta label="Call attempts" value={String(lead.call_attempts ?? 0)} />
          <Meta label="Last call"     value={fmtDate(lead.last_call_at)} />
          <Meta label="Next followup" value={fmtDate(lead.next_followup_at)} />
          <Meta label="Received"      value={fmtRelative(lead.created_at)} />
        </div>

        {(lead.campaign_name || lead.adset_name || lead.ad_name || lead.meta_page_id) && (
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
            <Meta label="Campaign name" value={lead.campaign_name || '—'} />
            <Meta label="Ad set"        value={lead.adset_name || '—'} />
            <Meta label="Ad name"       value={lead.ad_name || '—'} />
            {lead.meta_campaign_id && <Meta label="Campaign ID" value={lead.meta_campaign_id} mono />}
            {lead.meta_adset_id && <Meta label="Ad set ID" value={lead.meta_adset_id} mono />}
            {lead.meta_ad_id && <Meta label="Ad ID" value={lead.meta_ad_id} mono />}
            {lead.meta_page_id && <Meta label="Meta Page ID" value={lead.meta_page_id} mono />}
            {lead.meta_created_time && <Meta label="Meta Lead Time" value={fmtDate(lead.meta_created_time)} />}
          </div>
        )}
      </div>

      {/* ── WORKFLOW SECTION ─────────────────────────────────── */}
      <WorkflowErrorBoundary>
        <WorkflowPanel leadId={id} isAdmin={user.role === 'super_admin'} />
      </WorkflowErrorBoundary>

      <LeadCommunicationPanel leadId={id} lead={lead} remarks={lead.remarks} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card-padded lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">Call log & remarks</h3>
            <span className="ml-auto text-xs text-slate-500">{lead.remarks.length} entries</span>
          </div>
          {lead.remarks.length === 0 ? (
            <EmptyState
              title="No remarks yet"
              description="When you log a call or add a note, it'll appear here."
              action={<Button onClick={() => setRemarkOpen(true)} leftIcon={<MessageSquarePlus className="h-4 w-4" />}>Add first remark</Button>}
            />
          ) : (
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {lead.remarks.map(r => (
                <li key={r.id} className="relative">
                  <span className="absolute -left-[26px] top-1 grid h-3 w-3 place-items-center rounded-full bg-brand-500 ring-4 ring-brand-50" />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-slate-900">{r.by_name || r.author_name}</span>
                    {r.call_status && <StatusChip status={r.call_status} />}
                    <span className="ml-auto text-xs text-slate-500" title={fmtDate(r.created_at)}>{fmtRelative(r.created_at)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.remark}</p>
                  {r.next_followup_at && (
                    <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-700">
                      <Calendar className="h-3 w-3" /> Followup: {fmtDate(r.next_followup_at)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="card-padded">
          <div className="mb-4 flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">Assignment history</h3>
          </div>
          {lead.history.length === 0 ? (
            <EmptyState title="No history" description="This lead hasn't been reassigned." />
          ) : (
            <ul className="space-y-3">
              {lead.history.map((h, i) => (
                <li key={i} className={clsx('rounded-lg border p-3', !h.unassigned_at ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200 bg-white')}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-900">{h.user_name || '—'}</div>
                    {!h.unassigned_at && <span className="chip-pink">Current</span>}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {fmtDate(h.assigned_at)} {h.unassigned_at ? `→ ${fmtDate(h.unassigned_at)}` : '· active'}
                  </div>
                  {h.reason && <div className="mt-1 text-xs text-slate-600">Reason: {h.reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <RemarkModal   leadId={id} open={remarkOpen}   onClose={() => setRemarkOpen(false)} />
      <ReassignModal leadId={id} open={reassignOpen} onClose={() => setReassignOpen(false)} />
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={clsx('mt-0.5 text-sm text-slate-800', mono && 'font-mono text-xs break-all')}>{value}</div>
    </div>
  );
}

class WorkflowErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('WorkflowPanel CRASH:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{background:'#fef2f2',border:'2px solid #ef4444',borderRadius:'12px',padding:'20px',margin:'8px 0'}}>
          <p style={{color:'#dc2626',fontWeight:'bold',fontSize:'16px'}}>WorkflowPanel CRASHED</p>
          <p style={{color:'#991b1b',fontSize:'13px',marginTop:'8px',fontFamily:'monospace'}}>{this.state.error.message}</p>
          <pre style={{color:'#7f1d1d',fontSize:'11px',marginTop:'8px',maxHeight:'200px',overflow:'auto',whiteSpace:'pre-wrap'}}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
