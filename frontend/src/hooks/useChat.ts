'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { apiGet, apiPost, api } from '@/lib/api';
import { getSocket, connectSocket, joinConversation, leaveConversation, emitTyping, emitStopTyping } from '@/lib/socket';
import { useAuth } from '@/lib/auth';

// ─── Types ──────────────────────────────────────────────────────────

export interface ChatContact {
  id: string;
  full_name: string;
  role: string;
  email: string;
  status: string;
  last_seen_at: string | null;
}

export interface ChatConversation {
  id: string;
  type: 'direct' | 'lead' | 'broadcast';
  title: string | null;
  lead_id: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  is_muted: boolean;
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_type: string | null;
  last_sender_id: string | null;
  last_sender_name: string | null;
  last_message_at: string | null;
  unread_count: number;
  other_user?: { id: string; full_name: string; role: string; status: string; email: string; last_seen_at: string | null } | null;
  lead?: { id: string; full_name: string; phone: string; email: string } | null;
}

export interface ChatAttachment {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_path: string;
}

export interface ChatReaction {
  emoji: string;
  user_id: string;
  user_name: string;
}

export interface ChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  body: string;
  message_type: 'text' | 'system' | 'file' | 'voice';
  metadata?: Record<string, unknown>;
  created_at: string;
  edited_at?: string;
  conversation_id?: string;
  is_deleted: boolean;
  is_starred: boolean;
  is_pinned?: boolean;
  reply_to_id?: string;
  reply_to?: { id: string; body: string; sender_id: string; sender_name: string } | null;
  forwarded_from_id?: string;
  forwarded_from?: { id: string; body: string; sender_name: string } | null;
  delivery_status?: 'sent' | 'delivered' | 'read';
  attachments: ChatAttachment[];
  reactions: ChatReaction[];
  mentions?: string[];
}

export interface ChatNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  conversation_id: string | null;
  sender_id: string | null;
  sender_name: string | null;
  is_read: boolean;
  created_at: string;
}

// ─── Safe API wrappers ─────────────────────────────────────────────

async function safeApiGet<T>(url: string): Promise<T> {
  try {
    return await apiGet<T>(url);
  } catch (err) {
    console.error(`[Chat API] GET ${url} failed:`, err);
    throw err;
  }
}

async function safeApiPost<T>(url: string, data?: unknown): Promise<T> {
  try {
    return await apiPost<T>(url, data);
  } catch (err) {
    console.error(`[Chat API] POST ${url} failed:`, err);
    throw err;
  }
}

// ─── Socket connection manager with debounced cache invalidation ───

export function useSocketConnection() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const listenersAttached = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (listenersAttached.current) return;
    let cancelled = false;

    const pendingKeys = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (pendingKeys.size === 0) return;
      const keys = Array.from(pendingKeys);
      pendingKeys.clear();
      flushTimer = null;
      keys.forEach(k => qc.invalidateQueries({ queryKey: [k] }));
    };

    const enqueue = (...keys: string[]) => {
      keys.forEach(k => pendingKeys.add(k));
      if (!flushTimer) {
        flushTimer = setTimeout(flush, 300);
      }
    };

    const handlers = {
      'message:new': (msg: ChatMessage) => {
        enqueue('chat-conversations');
        if (msg.conversation_id) {
          qc.invalidateQueries({ queryKey: ['chat-messages', msg.conversation_id] });
          if (msg.sender_id !== user.id) {
            safeApiPost(`/chat/conversations/${msg.conversation_id}/delivered`).catch(() => {});
          }
        }
      },
      'message:deleted': () => enqueue('chat-conversations', 'chat-messages'),
      'message:edited': () => enqueue('chat-messages'),
      'message:reaction': () => enqueue('chat-messages'),
      'message:pinned': () => enqueue('chat-messages', 'chat-pinned'),
      'message:read': () => enqueue('chat-conversations', 'chat-messages'),
      'message:delivered': () => enqueue('chat-messages'),
      'notification:new': () => enqueue('chat-unread', 'chat-notifications'),
      'unread:update': () => enqueue('chat-unread', 'chat-conversations'),
      'broadcast:new': () => enqueue('chat-conversations', 'chat-unread'),
      'user:online': () => enqueue('chat-contacts', 'chat-conversations'),
      'user:offline': () => enqueue('chat-contacts', 'chat-conversations'),
      'reconnect': () => enqueue('chat-conversations', 'chat-messages', 'chat-unread'),

      // Real-time lead ingestion — fired by the backend whenever a Meta webhook,
      // periodic Meta pull, sheet import or manual create lands a new lead.
      // We invalidate every list/aggregate the UI uses so the leads page,
      // dashboards, reports and RM panels refresh without a page reload.
      'lead:new': (lead: { id: string; full_name: string | null; campaign_name: string | null; assigned_to_user_id: string | null; _source?: string }) => {
        enqueue('leads', 'reports', 'admin', 'rankings', 'dist-stats');
        // RMs + admins get a passive toast — members only if it's their lead
        const mine = lead.assigned_to_user_id === user.id;
        if (user.role === 'super_admin' || user.role === 'rm' || mine) {
          const tag = lead.campaign_name ? `· ${lead.campaign_name}` : '';
          toast.success(`New lead${lead.full_name ? `: ${lead.full_name}` : ''} ${tag}`, { id: `lead-${lead.id}`, duration: 4000 });
        }
      },
    } as const;

    let socketRef: ReturnType<typeof getSocket> = null;

    connectSocket().then((socket) => {
      if (cancelled) return;
      listenersAttached.current = true;
      socketRef = socket;

      Object.entries(handlers).forEach(([event, handler]) => {
        socket.on(event, handler as (...args: unknown[]) => void);
      });
    }).catch((err) => {
      console.error('[Socket] Connection failed, will retry:', err);
    });

    return () => {
      cancelled = true;
      listenersAttached.current = false;
      if (flushTimer) clearTimeout(flushTimer);
      pendingKeys.clear();
      if (socketRef) {
        Object.entries(handlers).forEach(([event, handler]) => {
          socketRef!.off(event, handler as (...args: unknown[]) => void);
        });
      }
    };
  }, [user, qc]);
}

// ─── Data hooks ────────────────────────────────────────────────────

export function useChatContacts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['chat-contacts'],
    queryFn: () => safeApiGet<ChatContact[]>('/chat/contacts'),
    enabled: !!user,
    staleTime: 60_000,
    retry: 2,
  });
}

export function useChatConversations(type?: string, archived?: boolean) {
  const { user } = useAuth();
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (archived) params.set('archived', 'true');
  const qs = params.toString();
  return useQuery({
    queryKey: ['chat-conversations', type ?? null, archived ?? null],
    queryFn: () => safeApiGet<ChatConversation[]>(`/chat/conversations${qs ? `?${qs}` : ''}`),
    enabled: !!user,
    staleTime: 5_000,
    refetchInterval: 30_000,
    retry: 2,
  });
}

export function useChatMessages(conversationId: string | null) {
  useEffect(() => {
    if (!conversationId) return;
    try { joinConversation(conversationId); } catch {}
    return () => { try { leaveConversation(conversationId); } catch {} };
  }, [conversationId]);

  return useQuery({
    queryKey: ['chat-messages', conversationId],
    queryFn: () => safeApiGet<{ messages: ChatMessage[]; total: number; page: number }>(
      `/chat/conversations/${conversationId}/messages`
    ),
    enabled: !!conversationId,
    staleTime: 3_000,
    refetchInterval: 15_000,
    retry: 2,
  });
}

export function useSendMessage(conversationId: string | null) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (data: { body: string; reply_to_id?: string; forwarded_from_id?: string }) =>
      safeApiPost<ChatMessage>(`/chat/conversations/${conversationId}/messages`, data),
    onMutate: async (newMsg) => {
      if (!conversationId || !user) return;
      await qc.cancelQueries({ queryKey: ['chat-messages', conversationId] });
      const prev = qc.getQueryData<{ messages: ChatMessage[]; total: number; page: number }>(['chat-messages', conversationId]);
      const optimistic: ChatMessage = {
        id: `temp-${Date.now()}`,
        sender_id: user.id,
        sender_name: user.name,
        sender_role: user.role,
        body: newMsg.body,
        message_type: 'text',
        created_at: new Date().toISOString(),
        is_deleted: false,
        is_starred: false,
        delivery_status: 'sent',
        attachments: [],
        reactions: [],
        reply_to_id: newMsg.reply_to_id,
      };
      qc.setQueryData(['chat-messages', conversationId], (old: { messages: ChatMessage[]; total: number; page: number } | undefined) =>
        old
          ? { ...old, messages: [...old.messages, optimistic], total: old.total + 1 }
          : { messages: [optimistic], total: 1, page: 1 }
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(['chat-messages', conversationId], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

export function useUploadFile(conversationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: globalThis.File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(`/chat/conversations/${conversationId}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data?.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { type: string; target_user_id?: string; lead_id?: string; title?: string }) =>
      safeApiPost<{ id: string; existing: boolean }>('/chat/conversations', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

export function useMarkConversationRead(conversationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => safeApiPost(`/chat/conversations/${conversationId}/read`),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['chat-conversations'] });
      const prevQueries = qc.getQueriesData<ChatConversation[]>({ queryKey: ['chat-conversations'] });
      qc.setQueriesData<ChatConversation[]>(
        { queryKey: ['chat-conversations'] },
        (old) => old?.map(c => c.id === conversationId ? { ...c, unread_count: 0 } : c)
      );
      return { prevQueries };
    },
    onError: (_err, _vars, ctx) => {
      ctx?.prevQueries?.forEach(([key, data]) => {
        if (data) qc.setQueryData(key, data);
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['chat-unread'] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

export function useEditMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, body }: { messageId: string; body: string }) => {
      const res = await api.put(`/chat/messages/${messageId}`, { body });
      return res.data?.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages'] });
    },
  });
}

export function useForwardMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, conversationId }: { messageId: string; conversationId: string }) =>
      safeApiPost(`/chat/messages/${messageId}/forward`, { conversation_id: conversationId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages'] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

export function useReactToMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      safeApiPost<ChatReaction[]>(`/chat/messages/${messageId}/react`, { emoji }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages'] });
    },
  });
}

export function useStarMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      safeApiPost<{ starred: boolean }>(`/chat/messages/${messageId}/star`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages'] });
      qc.invalidateQueries({ queryKey: ['chat-starred'] });
    },
  });
}

export function useStarredMessages() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['chat-starred'],
    queryFn: () => safeApiGet<any[]>('/chat/starred'),
    enabled: !!user,
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      await api.delete(`/chat/messages/${messageId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages'] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

export function usePinConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      api.patch(`/chat/conversations/${conversationId}/pin`).then(r => r.data?.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

export function useMuteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      api.patch(`/chat/conversations/${conversationId}/mute`).then(r => r.data?.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

export function useArchiveConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      api.patch(`/chat/conversations/${conversationId}/archive`).then(r => r.data?.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useSearchMessages(searchQuery: string, conversationId?: string | null) {
  const { user } = useAuth();
  const debouncedQuery = useDebouncedValue(searchQuery, 400);
  const params = new URLSearchParams();
  if (debouncedQuery) params.set('q', debouncedQuery);
  if (conversationId) params.set('conversation_id', conversationId);
  return useQuery({
    queryKey: ['chat-search', debouncedQuery, conversationId ?? null],
    queryFn: () => safeApiGet<any[]>(`/chat/search?${params.toString()}`),
    enabled: !!user && debouncedQuery.length >= 2,
    staleTime: 10_000,
  });
}

export function useChatUnread() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['chat-unread'],
    queryFn: () => safeApiGet<{ unread: number }>('/chat/unread'),
    enabled: !!user,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

export function useSendBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; body: string }) =>
      safeApiPost('/chat/broadcast', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

export function useChatNotifications() {
  return useQuery({
    queryKey: ['chat-notifications'],
    queryFn: () => safeApiGet<{ notifications: ChatNotification[]; unread: number }>('/chat/notifications'),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useLeadThread(leadId: string | null) {
  return useQuery({
    queryKey: ['chat-lead-thread', leadId],
    queryFn: () => safeApiGet<{ conversationId: string; lead: any; messages: ChatMessage[] }>(
      `/chat/lead/${leadId}/thread`
    ),
    enabled: !!leadId,
  });
}

export function useConversationParticipants(conversationId: string | null) {
  return useQuery({
    queryKey: ['chat-participants', conversationId],
    queryFn: () => safeApiGet<any[]>(`/chat/conversations/${conversationId}/participants`),
    enabled: !!conversationId,
    staleTime: 30_000,
  });
}

export function usePinMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      safeApiPost<{ pinned: boolean }>(`/chat/messages/${messageId}/pin`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages'] });
      qc.invalidateQueries({ queryKey: ['chat-pinned'] });
    },
  });
}

export function usePinnedMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['chat-pinned', conversationId],
    queryFn: () => safeApiGet<any[]>(`/chat/conversations/${conversationId}/pinned`),
    enabled: !!conversationId,
    staleTime: 10_000,
  });
}

export function useDeleteForMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (messageId: string) => {
      await api.delete(`/chat/messages/${messageId}/for-me`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages'] });
    },
  });
}

export function useSendMessageWithMentions(conversationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { body: string; reply_to_id?: string; mentions?: string[] }) =>
      safeApiPost<ChatMessage>(`/chat/conversations/${conversationId}/messages/with-mentions`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

export function useMentions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['chat-mentions'],
    queryFn: () => safeApiGet<any[]>('/chat/mentions'),
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function useUploadMultipleFiles(conversationId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (files: globalThis.File[]) => {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      const res = await api.post(`/chat/conversations/${conversationId}/upload-multi`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data?.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });
}

export function useAdminExportChat() {
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const res = await api.get(`/chat/admin/export/${conversationId}`);
      return res.data?.data;
    },
  });
}

export function useAdminGlobalSearch(q: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['chat-admin-search', q],
    queryFn: () => safeApiGet<any[]>(`/chat/admin/search?q=${encodeURIComponent(q)}`),
    enabled: !!user && q.length >= 2,
    staleTime: 5_000,
  });
}

export function useAdminBlockedUsers() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['chat-admin-blocked'],
    queryFn: () => safeApiGet<any[]>('/chat/admin/blocked-users'),
    enabled: !!user,
  });
}

export function useAdminBlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { conversation_id: string; user_id: string; block: boolean }) =>
      safeApiPost('/chat/admin/block-user', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-admin-blocked'] });
      qc.invalidateQueries({ queryKey: ['chat-participants'] });
    },
  });
}

export function useAdminJoinConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      safeApiPost(`/chat/admin/join/${conversationId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
      qc.invalidateQueries({ queryKey: ['chat-participants'] });
    },
  });
}

export function useAdminMuteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { conversation_id: string; user_id: string; mute: boolean }) =>
      safeApiPost('/chat/admin/mute-user', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-participants'] });
    },
  });
}

export function useTypingIndicator(conversationId: string | null) {
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [recordingUsers, setRecordingUsers] = useState<Map<string, string>>(new Map());
  const timers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    let attachedSocket: ReturnType<typeof getSocket> = null;

    const handleTyping = (data: { conversationId: string; userId: string; userName: string }) => {
      if (data.conversationId !== conversationId) return;
      const existing = timers.current.get(`t:${data.userId}`);
      if (existing) clearTimeout(existing);
      setTypingUsers(prev => new Map(prev).set(data.userId, data.userName));
      timers.current.set(`t:${data.userId}`, setTimeout(() => {
        setTypingUsers(prev => { const n = new Map(prev); n.delete(data.userId); return n; });
        timers.current.delete(`t:${data.userId}`);
      }, 3000));
    };

    const handleStop = (data: { conversationId: string; userId: string }) => {
      if (data.conversationId !== conversationId) return;
      const existing = timers.current.get(`t:${data.userId}`);
      if (existing) clearTimeout(existing);
      setTypingUsers(prev => { const n = new Map(prev); n.delete(data.userId); return n; });
      timers.current.delete(`t:${data.userId}`);
    };

    const handleRecording = (data: { conversationId: string; userId: string; userName: string }) => {
      if (data.conversationId !== conversationId) return;
      const existing = timers.current.get(`r:${data.userId}`);
      if (existing) clearTimeout(existing);
      setRecordingUsers(prev => new Map(prev).set(data.userId, data.userName));
      timers.current.set(`r:${data.userId}`, setTimeout(() => {
        setRecordingUsers(prev => { const n = new Map(prev); n.delete(data.userId); return n; });
        timers.current.delete(`r:${data.userId}`);
      }, 5000));
    };

    const handleStopRecording = (data: { conversationId: string; userId: string }) => {
      if (data.conversationId !== conversationId) return;
      const existing = timers.current.get(`r:${data.userId}`);
      if (existing) clearTimeout(existing);
      setRecordingUsers(prev => { const n = new Map(prev); n.delete(data.userId); return n; });
      timers.current.delete(`r:${data.userId}`);
    };

    function attach(socket: NonNullable<ReturnType<typeof getSocket>>) {
      attachedSocket = socket;
      socket.on('user:typing', handleTyping);
      socket.on('user:stop_typing', handleStop);
      socket.on('user:recording', handleRecording);
      socket.on('user:stop_recording', handleStopRecording);
    }

    const socket = getSocket();
    if (socket) {
      attach(socket);
    } else {
      connectSocket().then((s) => {
        if (!cancelled) attach(s);
      }).catch(() => {});
    }

    return () => {
      cancelled = true;
      if (attachedSocket) {
        attachedSocket.off('user:typing', handleTyping);
        attachedSocket.off('user:stop_typing', handleStop);
        attachedSocket.off('user:recording', handleRecording);
        attachedSocket.off('user:stop_recording', handleStopRecording);
      }
      timers.current.forEach(t => clearTimeout(t));
      timers.current.clear();
      setTypingUsers(new Map());
      setRecordingUsers(new Map());
    };
  }, [conversationId]);

  const sendTyping = useCallback(() => {
    try { if (conversationId) emitTyping(conversationId); } catch {}
  }, [conversationId]);

  const sendStopTyping = useCallback(() => {
    try { if (conversationId) emitStopTyping(conversationId); } catch {}
  }, [conversationId]);

  const sendRecording = useCallback(() => {
    try {
      const socket = getSocket();
      if (socket && conversationId) socket.emit('recording', { conversationId });
    } catch {}
  }, [conversationId]);

  const sendStopRecording = useCallback(() => {
    try {
      const socket = getSocket();
      if (socket && conversationId) socket.emit('stop:recording', { conversationId });
    } catch {}
  }, [conversationId]);

  return { typingUsers, recordingUsers, sendTyping, sendStopTyping, sendRecording, sendStopRecording };
}
