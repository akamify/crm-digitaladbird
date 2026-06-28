'use client';

import { Component, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Lock, MessageCircle, MessageSquarePlus, Phone, Unlock, UserCog } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState, PageLoader, Skeleton } from '@/components/ui/Modal';
import { LeadProfileHeader } from '@/components/leads/LeadProfileHeader';
import { LeadSummaryCard, AssignmentCard, FollowUpCard, TechnicalMetaDetails } from '@/components/leads/LeadProfileSidebar';
import { LeadRemarkTimeline } from '@/components/leads/LeadRemarkTimeline';
import { LeadActionBar } from '@/components/leads/LeadActionBar';
import { RemarkModal } from '@/components/leads/RemarkModal';
import { ReassignModal } from '@/components/leads/ReassignModal';
import { WorkflowPanel } from '@/components/leads/WorkflowPanel';
import { LeadCommunicationPanel } from '@/components/leads/LeadCommunicationPanel';
import { useLead, useLockLead, useUnlockLead } from '@/hooks/useLeads';
import { useLeadCommunication } from '@/hooks/useLeadCommunication';
import { useAuth } from '@/lib/auth';
import { useUpdateLeadCategory } from '@/hooks/useAdminEnterprise';
import { triggerPhoneCall } from '@/lib/phone';

export default function LeadDetailPage() {
  return <AppShell title="Lead Profile" subtitle="Actions, workflow, communication, and history"><LeadDetailInner /></AppShell>;
}

function LeadDetailInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const comm = useLeadCommunication(id);
  const leadQuery = useLead(id);
  const lock = useLockLead();
  const unlock = useUnlockLead();
  const updateCategory = useUpdateLeadCategory();
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);

  if (!user) return <PageLoader />;
  if (leadQuery.isLoading) return <LeadDetailSkeleton />;
  if (leadQuery.isError) return <EmptyState title="Could not load lead" description="The lead profile is temporarily unavailable." action={<Button onClick={() => leadQuery.refetch()}>Try again</Button>} />;
  const lead = leadQuery.data;
  if (!lead) return <EmptyState title="Lead not found" description="It may have been deleted or you may not have access." action={<Button onClick={() => router.push('/leads')}>Back to leads</Button>} />;

  const lockedByMe = lead.locked_by_user_id === user.id;
  const lockedByOther = Boolean(lead.locked_until && new Date(lead.locked_until) > new Date() && !lockedByMe);
  const canReassign = user.role === 'super_admin' || user.role === 'rm';
  const canEditCategory = user.role === 'super_admin' || user.role === 'admin';
  const canSeeTechnical = user.role === 'super_admin' || user.role === 'admin';
  const readOnlyAccess = Boolean(lead.read_only_access);
  const leadPhone = lead.phone;

  async function callLead() {
    if (!leadPhone) {
      toast.error('This lead does not have a valid phone number.');
      return;
    }
    if (readOnlyAccess) {
      toast.error('This reassigned lead is read-only for your account.');
      return;
    }

    triggerPhoneCall(leadPhone);
    try {
      await comm.startCall.mutateAsync(undefined);
      toast.success('Dialer opened and call log created.');
    } catch {
      toast.error('Could not record call in CRM.');
    }
  }

  const desktopActions = (
    <>
      {canEditCategory && !readOnlyAccess && <select className="input h-10 w-auto text-xs" aria-label="Lead category" value={lead.category || 'unknown'} disabled={updateCategory.isPending} onChange={event => {
        const category = event.target.value as 'trader' | 'partner' | 'unknown';
        updateCategory.mutate({ leadId: id, category, reason: 'Manual correction from lead profile' }, { onSuccess: () => toast.success('Lead category updated'), onError: () => toast.error('Category update failed') });
      }}><option value="trader">Trader Lead</option><option value="partner">Partner Lead</option><option value="unknown">Unknown</option></select>}
      <Button variant="outline" leftIcon={<Phone className="h-4 w-4" />} onClick={callLead} disabled={!lead.phone || readOnlyAccess}>Call</Button>
      {!readOnlyAccess && <Button variant="outline" leftIcon={<MessageCircle className="h-4 w-4" />} onClick={() => router.push(`/chat?leadId=${id}`)}>Chat</Button>}
      {!readOnlyAccess && <Button leftIcon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setRemarkOpen(true)}>Add Remark</Button>}
      {canReassign && !readOnlyAccess && <Button variant="ghost" leftIcon={<UserCog className="h-4 w-4" />} onClick={() => setReassignOpen(true)}>Reassign</Button>}
      {!readOnlyAccess && (lockedByMe ? <Button variant="ghost" leftIcon={<Unlock className="h-4 w-4" />} loading={unlock.isPending} onClick={() => unlock.mutate({ id }, { onSuccess: () => toast.success('Lock released'), onError: () => toast.error('Failed to release lock') })}>Release lock</Button> : <Button variant="ghost" leftIcon={<Lock className="h-4 w-4" />} loading={lock.isPending} disabled={lockedByOther} onClick={() => lock.mutate({ id, minutes: 10 }, { onSuccess: () => toast.success('Lead locked for 10 minutes'), onError: () => toast.error('Could not acquire lock') })}>{lockedByOther ? 'Locked' : 'Lock'}</Button>)}
    </>
  );

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      <LeadProfileHeader lead={lead} lockedByMe={lockedByMe} lockedByOther={lockedByOther} actions={desktopActions} />
      {readOnlyAccess && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This lead was reassigned to another member. You can review the profile, remarks, and history, but editing actions are disabled.
        </div>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.85fr)_minmax(280px,1fr)]">
        <main className="min-w-0 space-y-5">
          {!readOnlyAccess && (
            <section className="card-padded">
              <WorkflowBoundary><WorkflowPanel leadId={id} isAdmin={user.role === 'super_admin'} /></WorkflowBoundary>
            </section>
          )}
          {!readOnlyAccess && <LeadCommunicationPanel leadId={id} lead={lead} remarks={lead.remarks} />}
          <LeadRemarkTimeline remarks={lead.remarks} onAdd={() => setRemarkOpen(true)} canAdd={!readOnlyAccess} />
        </main>
        <aside className="lg:sticky lg:top-20 lg:self-start min-w-0 space-y-4 lg:overflow-y-auto lg:pr-1">
          <LeadSummaryCard lead={lead} />
          <AssignmentCard lead={lead} />
          <FollowUpCard lead={lead} />
          {canSeeTechnical && <TechnicalMetaDetails lead={lead} />}
        </aside>
      </div>

      {!readOnlyAccess && <LeadActionBar onCall={callLead} callDisabled={!lead.phone} onChat={() => router.push(`/chat?leadId=${id}`)} onRemark={() => setRemarkOpen(true)} onReassign={canReassign ? () => setReassignOpen(true) : undefined} />}
      {!readOnlyAccess && <RemarkModal leadId={id} open={remarkOpen} onClose={() => setRemarkOpen(false)} />}
      {!readOnlyAccess && <ReassignModal leadId={id} open={reassignOpen} onClose={() => setReassignOpen(false)} />}
    </div>
  );
}

function LeadDetailSkeleton() {
  return <div className="space-y-5"><Skeleton className="h-36" /><div className="grid gap-5 lg:grid-cols-[1.85fr_1fr]"><div className="space-y-5"><Skeleton className="h-80" /><Skeleton className="h-72" /></div><div className="space-y-4"><Skeleton className="h-72" /><Skeleton className="h-40" /></div></div></div>;
}

class WorkflowBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { if (process.env.NODE_ENV === 'development') console.error('WorkflowPanel error', error, info); }
  render() { return this.state.failed ? <EmptyState title="Workflow unavailable" description="Refresh the page to try loading workflow again." /> : this.props.children; }
}
