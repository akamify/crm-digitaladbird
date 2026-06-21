'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { connectSocket, getSocket } from '@/lib/socket';
import { useChatMessages, type ChatMessage } from '@/hooks/useChat';

export interface LeadThread {
  conversationId: string;
  lead: {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
    source?: string | null;
    campaign_name?: string | null;
    campaign_label?: string | null;
    meta_form_id?: string | null;
    stage?: string;
    call_status?: string;
    assigned_to_user_id?: string | null;
    assigned_to_name?: string | null;
  };
  messages: ChatMessage[];
}

export interface LeadCallLog {
  id: string;
  lead_id: string;
  user_id: string;
  user_name?: string;
  provider: string | null;
  provider_call_id: string | null;
  direction: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  notes: string | null;
  failure_reason: string | null;
  created_at: string;
}

export function useLeadCommunication(leadId: string | null | undefined) {
  const qc = useQueryClient();

  const thread = useQuery({
    queryKey: ['lead-communication-thread', leadId],
    queryFn: () => apiGet<LeadThread>(`/chat/lead/${leadId}/thread`),
    enabled: !!leadId,
    staleTime: 5_000,
    retry: (count, error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      return status === 403 ? false : count < 2;
    },
  });

  const conversationId = thread.data?.conversationId || null;
  const messagesQuery = useChatMessages(conversationId);

  const calls = useQuery({
    queryKey: ['lead-calls', leadId],
    queryFn: () => apiGet<LeadCallLog[]>(`/leads/${leadId}/calls`),
    enabled: !!leadId,
    staleTime: 10_000,
  });

  const sendMessage = useMutation({
    mutationFn: (body: string) => apiPost<ChatMessage>(`/chat/conversations/${conversationId}/messages`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-communication-thread', leadId] });
      qc.invalidateQueries({ queryKey: ['chat-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });

  const markRead = useMutation({
    mutationFn: () => apiPost(`/chat/conversations/${conversationId}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat-conversations'] }),
  });

  const startCall = useMutation({
    mutationFn: () => apiPost(`/leads/${leadId}/calls/start`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-calls', leadId] });
      qc.invalidateQueries({ queryKey: ['lead-communication-thread', leadId] });
      qc.invalidateQueries({ queryKey: ['lead', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });

  const logCall = useMutation({
    mutationFn: (body: {
      status: string;
      duration_seconds?: number | string;
      notes?: string;
      next_followup_at?: string;
    }) => apiPost(`/leads/${leadId}/calls/log`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-calls', leadId] });
      qc.invalidateQueries({ queryKey: ['lead-communication-thread', leadId] });
      qc.invalidateQueries({ queryKey: ['lead', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['lead-communication-thread', leadId] });
      qc.invalidateQueries({ queryKey: ['chat-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['lead-calls', leadId] });
    };
    const onMessage = (msg: ChatMessage) => {
      if (msg.conversation_id === conversationId) refresh();
    };
    const onCall = (payload?: { lead_id?: string }) => {
      if (!payload?.lead_id || payload.lead_id === leadId) refresh();
    };

    connectSocket().then((socket) => {
      if (cancelled) return;
      socket.on('message:new', onMessage);
      socket.on('lead:call:created', onCall);
      socket.on('lead:call:updated', onCall);
      socket.io.on('reconnect', refresh);
    }).catch(() => {
      // Existing chat polling remains the fallback when realtime is unavailable.
    });

    return () => {
      cancelled = true;
      const socket = getSocket();
      socket?.off('message:new', onMessage);
      socket?.off('lead:call:created', onCall);
      socket?.off('lead:call:updated', onCall);
      socket?.io.off('reconnect', refresh);
    };
  }, [conversationId, leadId, qc]);

  const threadError = thread.error;
  const messagesError = messagesQuery.error;
  const isForbidden = isLeadCommunicationForbidden(threadError) || isLeadCommunicationForbidden(messagesError);
  const messages = messagesQuery.data?.messages || thread.data?.messages || [];
  const refetch = async () => {
    await Promise.allSettled([
      thread.refetch(),
      messagesQuery.refetch(),
      calls.refetch(),
    ]);
  };

  return {
    isLoading: thread.isLoading || (!!conversationId && messagesQuery.isLoading),
    isError: thread.isError || messagesQuery.isError,
    error: threadError || messagesError || null,
    isForbidden,
    conversation: conversationId ? { id: conversationId, lead: thread.data?.lead } : null,
    messages,
    isSending: sendMessage.isPending,
    sendMessage: (body: string) => sendMessage.mutateAsync(body),
    refetch,
    thread,
    messagesQuery,
    calls,
    conversationId,
    sendMessageMutation: sendMessage,
    markRead,
    startCall,
    logCall,
  };
}

function isLeadCommunicationForbidden(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { code?: string; error?: { code?: string } } } })?.response;
  const code = response?.data?.code || response?.data?.error?.code;
  return response?.status === 403 || code === 'LEAD_COMMUNICATION_FORBIDDEN';
}

export function leadCommunicationErrorMessage(error: unknown) {
  const data = (error as { response?: { data?: { code?: string; message?: string; error?: { code?: string; message?: string } } } })?.response?.data;
  const code = data?.code || data?.error?.code;
  if (code === 'LEAD_COMMUNICATION_FORBIDDEN') return 'You can communicate only with leads assigned to you.';
  return data?.message || data?.error?.message || 'Could not load lead communication.';
}
