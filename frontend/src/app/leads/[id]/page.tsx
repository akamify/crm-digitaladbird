'use client';

import { Component, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, CalendarClock, MessageCircle, MessageSquarePlus, Phone, Tag, Trash2, UserCog } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState, Modal, PageLoader, Skeleton } from '@/components/ui/Modal';
import { LeadProfileHeader } from '@/components/leads/LeadProfileHeader';
import {
  LeadSummaryCard,
  AssignmentCard,
  FollowUpCard,
  PersonalMeetingsCard,
  LatestRmUpdateCard,
  TechnicalMetaDetails,
} from '@/components/leads/LeadProfileSidebar';
import { LeadRemarkTimeline } from '@/components/leads/LeadRemarkTimeline';
import { LeadActionBar } from '@/components/leads/LeadActionBar';
import { RemarkModal } from '@/components/leads/RemarkModal';
import { ReassignModal } from '@/components/leads/ReassignModal';
import { WorkflowPanel } from '@/components/leads/WorkflowPanel';
import { LeadCommunicationPanel } from '@/components/leads/LeadCommunicationPanel';
import { LeadSessionsCard } from '@/components/leads/LeadSessionsCard';
import { LeadLabelsCard } from '@/components/leads/LeadLabelsCard';
import { PersonalMeetingModal } from '@/components/leads/PersonalMeetingModal';
import { useDeleteLead, useLead } from '@/hooks/useLeads';
import { useLeadCommunication } from '@/hooks/useLeadCommunication';
import { useAuth } from '@/lib/auth';
import { useUpdateLeadCategory } from '@/hooks/useAdminEnterprise';
import { triggerPhoneCall } from '@/lib/phone';

export default function LeadDetailPage() {
  return (
    <AppShell title="Lead Profile" subtitle="Actions, workflow, communication, and history">
      <LeadDetailInner />
    </AppShell>
  );
}

function LeadDetailInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const comm = useLeadCommunication(id);
  const leadQuery = useLead(id);
  const deleteLead = useDeleteLead();
  const updateCategory = useUpdateLeadCategory();

  const [remarkOpen, setRemarkOpen] = useState(false);
  const [rmRemarkOpen, setRmRemarkOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sessionCreateSignal, setSessionCreateSignal] = useState(0);
  const [labelCreateSignal, setLabelCreateSignal] = useState(0);
  const [personalMeetingOpen, setPersonalMeetingOpen] = useState(false);

  if (!user) return <PageLoader />;

  if (leadQuery.isLoading) return <LeadDetailSkeleton />;

  if (leadQuery.isError) {
    return (
      <EmptyState
        title="Could not load lead"
        description="The lead profile is temporarily unavailable."
        action={<Button onClick={() => leadQuery.refetch()}>Try again</Button>}
      />
    );
  }

  const lead = leadQuery.data;

  if (!lead) {
    return (
      <EmptyState
        title="Lead not found"
        description="It may have been deleted or you may not have access."
        action={<Button onClick={() => router.push('/leads')}>Back to leads</Button>}
      />
    );
  }

  const canReassign = user.role === 'super_admin' || user.role === 'rm';
  const canAddRmUpdate = user.role === 'rm';
  const canEditCategory = user.role === 'super_admin' || user.role === 'admin';
  const canSeeTechnical = user.role === 'super_admin' || user.role === 'admin';
  const canSeeRmSummary = user.role === 'super_admin' || user.role === 'admin' || user.role === 'rm';
  const canDeleteLead = user.role === 'super_admin';
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

  async function handleDeleteLead() {
    try {
      await deleteLead.mutateAsync({ id });
      toast.success('Lead deleted permanently.');
      router.push('/leads');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || error?.response?.data?.message || 'Could not delete lead');
    }
  }

  const desktopActions = (
    <>
      {canEditCategory && !readOnlyAccess && (
        <select
          className="input h-10 w-auto text-xs"
          aria-label="Lead category"
          value={lead.category || 'unknown'}
          disabled={updateCategory.isPending}
          onChange={event => {
            const category = event.target.value as 'trader' | 'partner' | 'unknown';

            updateCategory.mutate(
              {
                leadId: id,
                category,
                reason: 'Manual correction from lead profile',
              },
              {
                onSuccess: () => toast.success('Lead category updated'),
                onError: () => toast.error('Category update failed'),
              },
            );
          }}
        >
          <option value="trader">Trader Lead</option>
          <option value="partner">Partner Lead</option>
          <option value="unknown">Unknown</option>
        </select>
      )}

      <Button
        variant="outline"
        leftIcon={<Phone className="h-4 w-4" />}
        onClick={callLead}
        disabled={!lead.phone || readOnlyAccess}
      >
        Call
      </Button>

      {!readOnlyAccess && (
        <Button
          variant="outline"
          leftIcon={<CalendarClock className="h-4 w-4" />}
          onClick={() => setPersonalMeetingOpen(true)}
        >
          Personal Meeting
        </Button>
      )}

      {!readOnlyAccess && (
        <Button
          variant="outline"
          leftIcon={<Tag className="h-4 w-4" />}
          onClick={() => setLabelCreateSignal(value => value + 1)}
        >
          Add Label
        </Button>
      )}

      {!readOnlyAccess && (
        <Button
          variant="outline"
          leftIcon={<MessageCircle className="h-4 w-4" />}
          onClick={() => router.push(`/chat?leadId=${id}`)}
        >
          Chat
        </Button>
      )}

      {!readOnlyAccess && !canAddRmUpdate && (
        <Button
          leftIcon={<MessageSquarePlus className="h-4 w-4" />}
          onClick={() => setRemarkOpen(true)}
        >
          Add Remark
        </Button>
      )}

      {!readOnlyAccess && canAddRmUpdate && (
        <Button
          variant="outline"
          leftIcon={<MessageSquarePlus className="h-4 w-4" />}
          onClick={() => setRmRemarkOpen(true)}
        >
          Add RM Update
        </Button>
      )}

      {!readOnlyAccess && (
        <Button
          variant="outline"
          leftIcon={<CalendarClock className="h-4 w-4" />}
          onClick={() => setSessionCreateSignal(value => value + 1)}
        >
          Add Session
        </Button>
      )}

      {canReassign && !readOnlyAccess && (
        <Button
          variant="ghost"
          leftIcon={<UserCog className="h-4 w-4" />}
          onClick={() => setReassignOpen(true)}
        >
          Reassign
        </Button>
      )}

      {canDeleteLead && !readOnlyAccess && (
        <Button
          variant="danger"
          leftIcon={<Trash2 className="h-4 w-4" />}
          onClick={() => setDeleteOpen(true)}
        >
          Delete Lead
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      <LeadProfileHeader lead={lead} actions={desktopActions} />

      {readOnlyAccess && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This lead was reassigned to another member. You can review the profile, remarks, and
          history, but editing actions are disabled.
        </div>
      )}

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1.85fr)_minmax(280px,1fr)]">
        <main className="min-w-0 space-y-5">
          {!readOnlyAccess && (
            <section className="card-padded">
              <WorkflowBoundary>
                <WorkflowPanel leadId={id} isAdmin={user.role === 'super_admin'} />
              </WorkflowBoundary>
            </section>
          )}

          {!readOnlyAccess && (
            <LeadCommunicationPanel leadId={id} lead={lead} remarks={lead.remarks} />
          )}

          <LeadRemarkTimeline
            remarks={lead.remarks}
            onAdd={() => (canAddRmUpdate ? setRmRemarkOpen(true) : setRemarkOpen(true))}
            canAdd={!readOnlyAccess}
            addLabel={canAddRmUpdate ? 'Add RM Update' : 'Add remark'}
          />
        </main>

        <aside className="min-w-0 lg:sticky lg:top-20 lg:h-fit lg:self-start">
          <div className="space-y-4">
            <LeadSummaryCard lead={lead} />
            <AssignmentCard lead={lead} />
            <FollowUpCard lead={lead} />
            <PersonalMeetingsCard lead={lead} />
            {canSeeRmSummary && <LatestRmUpdateCard lead={lead} />}
            <LeadLabelsCard leadId={id} canManage={!readOnlyAccess} createSignal={labelCreateSignal} />
            <LeadSessionsCard
              leadId={id}
              canManage={!readOnlyAccess}
              createSignal={sessionCreateSignal}
            />
            {canSeeTechnical && <TechnicalMetaDetails lead={lead} />}
          </div>
        </aside>
      </div>

      {!readOnlyAccess && (
        <LeadActionBar
          onCall={callLead}
          callDisabled={!lead.phone}
          onChat={() => router.push(`/chat?leadId=${id}`)}
          onRemark={() => (canAddRmUpdate ? setRmRemarkOpen(true) : setRemarkOpen(true))}
          onReassign={canReassign ? () => setReassignOpen(true) : undefined}
        />
      )}

      {!readOnlyAccess && (
        <RemarkModal leadId={id} open={remarkOpen} onClose={() => setRemarkOpen(false)} />
      )}
      {!readOnlyAccess && <PersonalMeetingModal lead={lead} open={personalMeetingOpen} onClose={() => setPersonalMeetingOpen(false)} />}

      {!readOnlyAccess && canAddRmUpdate && (
        <RemarkModal leadId={id} mode="rm_update" open={rmRemarkOpen} onClose={() => setRmRemarkOpen(false)} />
      )}

      {!readOnlyAccess && (
        <ReassignModal leadId={id} open={reassignOpen} onClose={() => setReassignOpen(false)} />
      )}

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Lead Permanently"
        description="This is a hard delete and cannot be undone."
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              size="sm"
              loading={deleteLead.isPending}
              onClick={handleDeleteLead}
            >
              I am sure, delete
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-2">
              <div className="font-semibold">{lead.full_name || 'Unnamed lead'}</div>
              <div>This will permanently delete the lead and its direct CRM history like remarks, workflow, sessions, labels, call logs, and payment attachments.</div>
              <div>Linked customer notes and chat records may remain in CRM but will no longer point to this lead.</div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function LeadDetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-36" />

      <div className="grid items-start gap-5 lg:grid-cols-[1.85fr_1fr]">
        <div className="space-y-5">
          <Skeleton className="h-80" />
          <Skeleton className="h-72" />
        </div>

        <div className="min-w-0">
          <div className="space-y-4 lg:sticky lg:top-24">
            <Skeleton className="h-72" />
            <Skeleton className="h-40" />
          </div>
        </div>
      </div>
    </div>
  );
}

class WorkflowBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (process.env.NODE_ENV === 'development') {
      console.error('WorkflowPanel error', error, info);
    }
  }

  render() {
    return this.state.failed ? (
      <EmptyState
        title="Workflow unavailable"
        description="Refresh the page to try loading workflow again."
      />
    ) : (
      this.props.children
    );
  }
}
