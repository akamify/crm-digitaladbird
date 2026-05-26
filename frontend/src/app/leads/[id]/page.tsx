'use client';
import { useState, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Lock, Unlock, Phone, Mail, MapPin, Tag, Calendar,
  MessageSquarePlus, UserCog, ClipboardList, Briefcase, ExternalLink,
  MessageCircle, PhoneCall, History,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Skeleton, EmptyState, StatusChip, PageLoader } from '@/components/ui/Modal';
import { RemarkModal } from '@/components/leads/RemarkModal';
import { ReassignModal } from '@/components/leads/ReassignModal';
import { WorkflowPanel } from '@/components/leads/WorkflowPanel';
import { useLead, useLockLead, useUnlockLead } from '@/hooks/useLeads';
import { useCreateConversation, useLeadThread } from '@/hooks/useChat';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtRelative, fmtPhone, humanize, stageChip, clsx } from '@/lib/format';

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

  const [remarkOpen, setRemarkOpen]     = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const createConv = useCreateConversation();
  const { data: leadThread } = useLeadThread(id);

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
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} className="text-brand-600 hover:text-brand-700" title="Call">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
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
              variant="primary" leftIcon={<MessageSquarePlus className="h-4 w-4" />}
              onClick={() => setRemarkOpen(true)}
            >Add remark</Button>
            {canReassign && (
              <Button
                variant="ghost" leftIcon={<UserCog className="h-4 w-4" />}
                onClick={() => setReassignOpen(true)}
              >Reassign</Button>
            )}
            <Button
              variant="outline"
              leftIcon={<MessageCircle className="h-4 w-4" />}
              loading={createConv.isPending}
              onClick={async () => {
                try {
                  const result = await createConv.mutateAsync({ type: 'lead', lead_id: id, title: `Lead: ${lead.full_name || 'Unknown'}` });
                  router.push(`/chat?conv=${result.id}`);
                } catch { toast.error('Could not open chat'); }
              }}
            >Message</Button>
            {lead.phone && (
              <>
                <a href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" leftIcon={<svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>}>WhatsApp</Button>
                </a>
                <a href={`tel:${lead.phone}`}>
                  <Button variant="outline" leftIcon={<PhoneCall className="h-4 w-4" />}>Call</Button>
                </a>
              </>
            )}
            {leadThread?.conversationId && (
              <Button
                variant="ghost"
                leftIcon={<History className="h-4 w-4" />}
                onClick={() => setShowChatHistory(!showChatHistory)}
              >Chat History ({leadThread.messages?.length || 0})</Button>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <Meta label="Assigned to"   value={lead.assigned_to_name || '—'} />
          <Meta label="Source"        value={humanize(lead.source)} />
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

      {showChatHistory && leadThread?.messages && leadThread.messages.length > 0 && (
        <div className="card-padded">
          <div className="mb-4 flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-teal-600" />
            <h3 className="text-sm font-semibold text-slate-900">Chat History</h3>
            <span className="ml-auto text-xs text-slate-500">{leadThread.messages.length} messages</span>
            <Button variant="primary" leftIcon={<ExternalLink className="h-3 w-3" />}
              onClick={() => router.push(`/chat?conv=${leadThread.conversationId}`)}>
              Open Full Chat
            </Button>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {leadThread.messages.slice(-15).map((m: any) => (
              <div key={m.id} className={clsx('rounded-lg px-3 py-2 text-sm', m.sender_id === user.id ? 'bg-emerald-50 ml-8' : 'bg-slate-50 mr-8')}>
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-0.5">
                  <span className="font-medium text-slate-700">{m.sender_name}</span>
                  <span>{fmtRelative(m.created_at)}</span>
                </div>
                <p className="text-slate-700">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

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
