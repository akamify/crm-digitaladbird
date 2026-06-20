'use client';

import { FormEvent, KeyboardEvent, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/ui/Modal';
import { fmtPhone, fmtRelative, clsx, humanize } from '@/lib/format';
import type { ChatMessage } from '@/hooks/useChat';
import { LeadCategoryBadge } from './LeadCategoryBadge';

interface Props {
  lead?: {
    full_name?: string | null;
    phone?: string | null;
    source?: string | null;
    campaign_name?: string | null;
    campaign_label?: string | null;
    meta_form_id?: string | null;
    assigned_to_name?: string | null;
    category?: 'trader' | 'partner' | 'unknown' | null;
    category_source?: string | null;
  };
  messages: ChatMessage[];
  loading: boolean;
  disabled?: boolean;
  sending?: boolean;
  onSend: (body: string) => void;
  currentUserId?: string;
}

export function LeadChatThread({ lead, messages, loading, disabled, sending, onSend, currentUserId }: Props) {
  const [body, setBody] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || disabled || sending) return;
    onSend(text);
    setBody('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const form = e.currentTarget.form;
    if (form) form.requestSubmit();
  }

  if (loading) return <Skeleton className="h-72" />;

  return (
    <div className="space-y-3">
      {lead && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">{lead.full_name || 'Unnamed lead'}</div>
              <LeadCategoryBadge category={lead.category} className="mt-1" />
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                {lead.phone && <span>{fmtPhone(lead.phone)}</span>}
                <span>{humanize(lead.source || 'manual')}</span>
                <span>{lead.campaign_name || lead.campaign_label || lead.meta_form_id || 'No campaign'}</span>
              </div>
            </div>
            <div className="text-xs text-slate-500">Assigned: {lead.assigned_to_name || 'Unassigned'}</div>
          </div>
        </div>
      )}
      <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
        {messages.length === 0 ? (
          <EmptyState title="No conversation yet" description="Send the first message from CRM." />
        ) : messages.map((m) => {
          const mine = m.sender_id === currentUserId;
          const system = m.message_type === 'system';
          return (
            <div key={m.id} className={clsx('flex', system ? 'justify-center' : mine ? 'justify-end' : 'justify-start')}>
              <div className={clsx(
                'max-w-[82%] rounded-xl px-3 py-2 text-sm shadow-sm',
                system ? 'bg-white text-xs text-slate-500' : mine ? 'bg-brand-600 text-white' : 'bg-white text-slate-800',
              )}>
                {!system && <div className={clsx('mb-1 text-[11px] font-medium', mine ? 'text-brand-100' : 'text-slate-500')}>{m.sender_name}</div>}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <div className={clsx('mt-1 text-[10px]', mine ? 'text-brand-100' : 'text-slate-400')}>{fmtRelative(m.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <textarea
          className="input min-h-20 flex-1 resize-none"
          value={body}
          disabled={disabled || sending}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Communication is disabled for this lead' : 'Type a CRM message...'}
          maxLength={2000}
        />
        <button className="btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm sm:self-end" disabled={!body.trim() || disabled || sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send
        </button>
      </form>
    </div>
  );
}
