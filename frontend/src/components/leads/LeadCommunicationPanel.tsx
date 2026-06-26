'use client';

import { useState } from 'react';
import { MessageCircle, PhoneCall, History } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState } from '@/components/ui/Modal';
import { useAuth } from '@/lib/auth';
import { clsx, humanize } from '@/lib/format';
import { LeadChatThread } from './LeadChatThread';
import { LeadCallPanel } from './LeadCallPanel';
import { leadCommunicationErrorMessage, useLeadCommunication } from '@/hooks/useLeadCommunication';

type Tab = 'chat' | 'calls' | 'history';

interface Props {
  leadId: string;
  lead: {
    id: string;
    full_name?: string | null;
    phone?: string | null;
    source?: string | null;
    campaign_name?: string | null;
    campaign_label?: string | null;
    meta_form_id?: string | null;
    assigned_to_name?: string | null;
    assigned_to_user_id?: string | null;
    stage?: string;
    call_status?: string;
    category?: 'trader' | 'partner' | 'unknown' | null;
    category_source?: string | null;
  };
  remarks?: Array<{ id: string; remark: string; created_at: string; by_name?: string; author_name?: string }>;
  defaultTab?: Tab;
}

export function LeadCommunicationPanel({ leadId, lead, remarks = [], defaultTab = 'chat' }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>(defaultTab);
  const comm = useLeadCommunication(leadId);
  const calls = comm.calls.data || [];
  const error = comm.isError ? leadCommunicationErrorMessage(comm.error) : null;
  const closed = ['won', 'lost', 'dropped'].includes(String(lead.stage || ''));

  if (error) {
    return (
      <section className="card-padded">
        <EmptyState title="Communication unavailable" description={error} icon={<MessageCircle className="h-6 w-6" />} />
      </section>
    );
  }

  return (
    <section className="card-padded">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-brand-600" />
          <h3 className="text-sm font-semibold text-slate-900">Communication</h3>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
          {([
            ['chat', MessageCircle],
            ['calls', PhoneCall],
            ['history', History],
          ] as const).map(([key, Icon]) => (
            <button
              key={key}
              className={clsx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium', tab === key ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
              onClick={() => setTab(key)}
            >
              <Icon className="h-3.5 w-3.5" />
              {humanize(key)}
            </button>
          ))}
        </div>
      </div>

      {closed && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">This lead is closed. New communication is disabled.</div>}

      {tab === 'chat' && (
        <LeadChatThread
          messages={comm.messages}
          loading={comm.isLoading}
          disabled={closed || !comm.conversationId}
          sending={comm.isSending}
          currentUserId={user?.id}
          onSend={(body) => comm.sendMessage(body).catch((err) => toast.error(leadCommunicationErrorMessage(err)))}
        />
      )}

      {tab === 'calls' && (
        <LeadCallPanel
          phone={lead.phone}
          calls={calls}
          loading={comm.calls.isLoading}
          disabled={closed}
          starting={comm.startCall.isPending}
          logging={comm.logCall.isPending}
          autoStart={defaultTab === 'calls'}
          onStart={() => comm.startCall.mutateAsync(undefined)}
          onLog={(body) => comm.logCall.mutateAsync(body)}
        />
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          {remarks.length === 0 ? <EmptyState title="No notes yet" description="Remarks and call notes will appear here." /> : remarks.slice(0, 20).map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-medium text-slate-500">{r.by_name || r.author_name || 'User'}</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.remark}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
