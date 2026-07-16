'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  MessageSquare, Send, Search, Plus, ArrowLeft, Megaphone, Loader2,
  MessageCircle, Hash, ChevronRight, Circle, Smile, Paperclip,
  MoreVertical, Check, CheckCheck, Pin, BellOff, Trash2, Reply,
  Download, FileText, Image as ImageIcon, File as FileIcon, X, Users, ZoomIn,
  Forward, Edit3, Copy, Star, Archive, Mic, Play, Pause,
  Phone, Video, Moon, Sun,
  FileDown, ChevronDown, RefreshCw,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/lib/auth';
import { clsx, initials } from '@/lib/format';
import {
  useChatConversations, useChatMessages, useSendMessage, useCreateConversation,
  useChatContacts, useMarkConversationRead, useSendBroadcast,
  useChatUnread,
  useUploadFile, useReactToMessage, useDeleteMessage,
  usePinConversation, useMuteConversation, useArchiveConversation,
  useEditMessage, useForwardMessage, useStarMessage, useSearchMessages,
  useTypingIndicator, usePinMessage, useDeleteForMe,
  useSendMessageWithMentions, usePinnedMessages,
  useUploadMultipleFiles, useAdminExportChat,
  useConversationParticipants, useSocketConnection, useLeadThread,
  useSendWaspMessage, useSyncWaspInbox,
  ChatConversation, ChatMessage, ChatContact, ChatAttachment,
} from '@/hooks/useChat';
import { onConnectionStatus } from '@/lib/socket';
import { LeadCategoryBadge } from '@/components/leads/LeadCategoryBadge';

// ─── Constants ──────────────────────────────────────────────────────

const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😋', '😛', '😜', '🤪', '😎', '🤓', '🧐', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '😈'],
  'Gestures': ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤙', '👋', '🤚', '✋', '🖖', '👏', '🙌', '🤲', '🤝', '🙏', '💪', '🦾'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💝'],
  'Objects': ['🔥', '💯', '⭐', '🌟', '✨', '💫', '🎉', '🎊', '🏆', '🥇', '💎', '🔔', '📌', '💡', '🎯', '🚀', '💼', '📎', '✅', '❌', '⚠️', '💬', '👀', '🤔'],
};
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏', '🎉', '💯', '🤔', '👀'];
const STICKER_PACKS = {
  'Reactions': ['👍🏻', '👎🏻', '🙌🏻', '👏🏻', '🤝🏻', '💪🏻', '🫡', '🫶🏻'],
  'Emotions': ['🥳', '🤯', '😱', '🥶', '🥵', '😵‍💫', '🤮', '🥴'],
  'Animals': ['🐶', '🐱', '🐻', '🦊', '🐼', '🐨', '🦁', '🐸'],
};

const WA_GREEN_DARK = '#075e54';
const WA_GREEN_LIGHT = '#128c7e';
const WA_GREEN_TEAL = '#25d366';
const WA_CHAT_BG = '#efeae2';
const WA_DARK_CHAT = '#0b141a';
const WA_DARK_HEADER = '#202c33';
const WA_DARK_BUBBLE_ME = '#005c4b';
const WA_DARK_BUBBLE_OTHER = '#202c33';

const AVATAR_COLORS = [
  'from-emerald-500 to-teal-600', 'from-blue-500 to-indigo-600',
  'from-violet-500 to-purple-600', 'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600', 'from-cyan-500 to-sky-600',
  'from-fuchsia-500 to-pink-600', 'from-lime-500 to-green-600',
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ─── Dark Mode Hook ─────────────────────────────────────────────────

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('chat-dark-mode') === 'true';
  });
  const toggle = useCallback(() => {
    setDark(p => {
      localStorage.setItem('chat-dark-mode', String(!p));
      return !p;
    });
  }, []);
  return { dark, toggle };
}

// ─── Notification helpers ───────────────────────────────────────────

let notifAudio: HTMLAudioElement | null = null;
function playNotificationSound() {
  try {
    if (!notifAudio) {
      notifAudio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
      notifAudio.volume = 0.3;
    }
    notifAudio.currentTime = 0;
    notifAudio.play().catch(() => { });
  } catch { }
}

function requestDesktopNotification(title: string, body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
  if (Notification.permission === 'granted' && document.hidden) {
    new Notification(title, { body, icon: '/favicon.png', tag: 'chat-msg' });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function Avatar({ name, size = 'md', type }: { name: string; size?: 'sm' | 'md' | 'lg'; type?: string }) {
  const s = size === 'sm' ? 'h-8 w-8 text-[10px]' : size === 'lg' ? 'h-12 w-12 text-sm' : 'h-10 w-10 text-xs';
  if (type === 'broadcast') return <div className={clsx(s, 'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white font-bold')}><Megaphone className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /></div>;
  if (type === 'lead') return <div className={clsx(s, 'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white font-bold')}><Hash className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /></div>;
  return <div className={clsx(s, 'grid shrink-0 place-items-center rounded-full bg-gradient-to-br text-white font-bold select-none', avatarColor(name))}>{initials(name)}</div>;
}

function OnlineDot() {
  return <span className="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-800 animate-pulse" />;
}

function formatTime(d: string) {
  try { return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
  catch { return ''; }
}

function formatListTime(d: string | null) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    if (msgDay.getTime() === today.getTime()) return formatTime(d);
    const y = new Date(today); y.setDate(y.getDate() - 1);
    if (msgDay.getTime() === y.getTime()) return 'Yesterday';
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function formatLastSeen(d: string | null) {
  if (!d) return 'offline';
  const diff = (Date.now() - new Date(d).getTime()) / 60000;
  if (diff < 2) return 'online';
  if (diff < 60) return `last seen ${Math.floor(diff)}m ago`;
  if (diff < 1440) return `last seen ${Math.floor(diff / 60)}h ago`;
  return `last seen ${new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function formatSessionExpiry(d?: string | null) {
  if (!d) return '';
  const diffMs = new Date(d).getTime() - Date.now();
  if (diffMs <= 0) return 'expired';
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
}

function sessionBadge(session?: ChatConversation['session']) {
  if (!session) return null;
  if (session.status === 'open') return { label: `Session open${session.expires_at ? ` - ${formatSessionExpiry(session.expires_at)}` : ''}`, tone: 'emerald' };
  if (session.status === 'expired') return { label: 'WhatsApp session expired', tone: 'amber' };
  if (session.status === 'waiting_for_customer') return { label: 'Waiting for customer message', tone: 'slate' };
  if (session.status === 'admin_only_external') return { label: 'Admin-only external chat', tone: 'violet' };
  return null;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function getFileUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_WS_URL || '';
  return base ? `${base}${path}` : path;
}

function chatErrorText(error: unknown) {
  const data = (error as { response?: { status?: number; data?: { code?: string; message?: string; error?: { code?: string; message?: string } } } })?.response?.data;
  const code = data?.code || data?.error?.code;
  if (code === 'LEAD_COMMUNICATION_FORBIDDEN' || (error as { response?: { status?: number } })?.response?.status === 403) {
    return 'You can communicate only with leads assigned to you.';
  }
  if (code === 'DIRECT_CHAT_DISABLED_FOR_ROLE') {
    return 'Members and partners can start chat only from an assigned lead.';
  }
  return data?.message || data?.error?.message || 'Could not open lead conversation.';
}

function isImageFile(type: string) { return /image\/(jpeg|jpg|png|gif|webp)/i.test(type); }
function isVideoFile(type: string) { return /video\/(mp4|webm|ogg)/i.test(type); }
function isAudioFile(type: string) { return /audio\/(ogg|webm|wav|mp3|mpeg)/i.test(type); }

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function extractMentions(text: string, contacts: ChatContact[]): string[] {
  const mentions: string[] = [];
  const regex = /@(\w[\w\s]*?)(?=\s|$|@)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim().toLowerCase();
    const contact = contacts.find(c => c.full_name.toLowerCase().includes(name));
    if (contact && !mentions.includes(contact.id)) mentions.push(contact.id);
  }
  return mentions;
}

// ─── Animations ─────────────────────────────────────────────────────

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 150, 300].map(d => <span key={d} className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
    </span>
  );
}

function DeliveryTicks({ status, dark }: { status?: string; dark?: boolean }) {
  if (status === 'read') return <CheckCheck className="h-3.5 w-3.5 text-sky-500" />;
  if (status === 'delivered') return <CheckCheck className={clsx('h-3.5 w-3.5', dark ? 'text-slate-400' : 'text-slate-400')} />;
  return <Check className={clsx('h-3.5 w-3.5', dark ? 'text-slate-400' : 'text-slate-400')} />;
}

// ─── Image Preview Modal ────────────────────────────────────────────

function ImagePreviewModal({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 z-10 transition"><X className="h-5 w-5" /></button>
      <a href={src} download={alt} className="absolute top-4 right-16 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 z-10 transition" title="Download"><Download className="h-5 w-5" /></a>
      <img src={src} alt={alt} className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" onClick={e => e.stopPropagation()} />
    </div>
  );
}

// ─── Media Preview Before Send ──────────────────────────────────────

function MediaPreviewDialog({ files, onSend, onCancel, dark }: {
  files: File[];
  onSend: (files: File[], caption: string) => void;
  onCancel: () => void;
  dark: boolean;
}) {
  const [caption, setCaption] = useState('');
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map(f => {
      if (f.type.startsWith('image/') || f.type.startsWith('video/')) return URL.createObjectURL(f);
      return '';
    });
    setPreviews(urls);
    return () => urls.forEach(u => { if (u) URL.revokeObjectURL(u); });
  }, [files]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className={clsx('w-full max-w-lg rounded-2xl shadow-2xl', dark ? 'bg-[#202c33]' : 'bg-white')} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: dark ? '#374151' : '#e2e8f0' }}>
          <h3 className={clsx('font-bold', dark ? 'text-white' : 'text-slate-800')}>Preview ({files.length} file{files.length > 1 ? 's' : ''})</h3>
          <button onClick={onCancel} className={clsx('grid h-8 w-8 place-items-center rounded-full transition', dark ? 'text-slate-400 hover:bg-white/10' : 'text-slate-400 hover:bg-slate-100')}><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 max-h-[400px] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            {files.map((f, i) => (
              <div key={i} className={clsx('rounded-xl overflow-hidden border', dark ? 'border-slate-600' : 'border-slate-200')}>
                {f.type.startsWith('image/') && previews[i] && (
                  <img src={previews[i]} alt={f.name} className="w-full h-32 object-cover" />
                )}
                {f.type.startsWith('video/') && previews[i] && (
                  <video src={previews[i]} className="w-full h-32 object-cover" controls={false} />
                )}
                {!f.type.startsWith('image/') && !f.type.startsWith('video/') && (
                  <div className={clsx('h-32 flex flex-col items-center justify-center gap-2', dark ? 'bg-slate-700' : 'bg-slate-50')}>
                    <FileIcon className={clsx('h-8 w-8', dark ? 'text-slate-400' : 'text-slate-400')} />
                  </div>
                )}
                <div className={clsx('px-2 py-1.5', dark ? 'bg-slate-700' : 'bg-slate-50')}>
                  <p className={clsx('truncate text-xs font-medium', dark ? 'text-slate-200' : 'text-slate-700')}>{f.name}</p>
                  <p className={clsx('text-[10px]', dark ? 'text-slate-400' : 'text-slate-400')}>{formatFileSize(f.size)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className={clsx('px-4 py-3 border-t flex items-center gap-2', dark ? 'border-slate-600' : 'border-slate-200')}>
          <input
            value={caption} onChange={e => setCaption(e.target.value)}
            placeholder="Add a caption..."
            className={clsx('flex-1 rounded-xl px-4 py-2 text-sm outline-none transition', dark ? 'bg-slate-700 text-white border-slate-600 placeholder-slate-400' : 'bg-slate-100 border-slate-200 placeholder-slate-400')}
            onKeyDown={e => { if (e.key === 'Enter') onSend(files, caption); }}
          />
          <button onClick={() => onSend(files, caption)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white shadow-sm transition hover:brightness-110" style={{ backgroundColor: WA_GREEN_TEAL }}>
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Voice Note Player ──────────────────────────────────────────────

function VoicePlayer({ url, isMe, dark }: { url: string; isMe: boolean; dark: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration || 0));
    audio.addEventListener('timeupdate', () => setCurrent(audio.currentTime));
    audio.addEventListener('ended', () => { setPlaying(false); setCurrent(0); });
    return () => { audio.pause(); audio.src = ''; };
  }, [url]);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  };

  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const btnBg = isMe
    ? (dark ? 'bg-emerald-700 text-white' : 'bg-white/20 text-white')
    : (dark ? 'bg-slate-600 text-teal-400' : 'bg-teal-100 text-teal-700');
  const barBg = isMe
    ? (dark ? 'bg-emerald-900' : 'bg-white/20')
    : (dark ? 'bg-slate-600' : 'bg-slate-200');
  const barFill = isMe
    ? (dark ? 'bg-emerald-400' : 'bg-white/80')
    : (dark ? 'bg-teal-400' : 'bg-teal-500');

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <button onClick={toggle} className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full transition', btnBg)}>
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={clsx('h-1.5 rounded-full overflow-hidden', barBg)}>
          <div className={clsx('h-full rounded-full transition-all duration-100', barFill)} style={{ width: `${pct}%` }} />
        </div>
        <div className={clsx('flex items-center gap-1 text-[10px] mt-0.5', isMe ? (dark ? 'text-emerald-300' : 'text-white/60') : (dark ? 'text-slate-400' : 'text-slate-400'))}>
          {playing ? formatDuration(current) : formatDuration(duration)}
          <Mic className="h-2.5 w-2.5" />
          <a href={url} download className="ml-auto opacity-60 hover:opacity-100 transition"><Download className="h-2.5 w-2.5" /></a>
        </div>
      </div>
    </div>
  );
}

// ─── Voice Recorder ─────────────────────────────────────────────────

function VoiceRecorder({ onSend, onCancel, sendRecording, sendStopRecording, dark }: {
  onSend: (file: File) => void; onCancel: () => void;
  sendRecording: () => void; sendStopRecording: () => void; dark: boolean;
}) {
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start();
      setRecording(true);
      sendRecording();
      timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
    } catch { onCancel(); }
  }, [onCancel, sendRecording]);

  useEffect(() => { start(); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, [start]);

  const stop = useCallback((send: boolean) => {
    if (timerRef.current) clearInterval(timerRef.current);
    sendStopRecording();
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (send && blob.size > 0) {
          const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
          onSend(file);
        }
        mediaRef.current?.stream?.getTracks().forEach(t => t.stop());
      };
      mediaRef.current.stop();
    }
    setRecording(false);
    onCancel();
  }, [onSend, onCancel, sendStopRecording]);

  return (
    <div className={clsx('flex items-center gap-3 px-4 py-2 border-t', dark ? 'bg-red-900/30 border-red-900/50' : 'bg-red-50 border-red-100')}>
      <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
      <span className={clsx('text-sm font-medium', dark ? 'text-red-300' : 'text-red-700')}>Recording {formatDuration(elapsed)}</span>
      <div className="flex-1" />
      <button onClick={() => stop(false)} className={clsx('grid h-8 w-8 place-items-center rounded-full transition', dark ? 'bg-slate-600 text-slate-300 hover:bg-slate-500' : 'bg-slate-200 text-slate-500 hover:bg-slate-300')}><X className="h-4 w-4" /></button>
      <button onClick={() => stop(true)} className="grid h-8 w-8 place-items-center rounded-full bg-teal-500 text-white hover:bg-teal-600 transition"><Send className="h-4 w-4" /></button>
    </div>
  );
}

// ─── Attachment Bubble ──────────────────────────────────────────────

function AttachmentBubble({ att, isMe, dark, onImageClick }: { att: ChatAttachment; isMe: boolean; dark: boolean; onImageClick?: (url: string, name: string) => void }) {
  const url = getFileUrl(att.file_path);

  if (isImageFile(att.file_type)) {
    return (
      <div className="mt-1 rounded-lg overflow-hidden max-w-[260px] cursor-pointer group/img" onClick={() => onImageClick?.(url, att.file_name)}>
        <div className="relative">
          <img src={url} alt={att.file_name} className="w-full rounded-lg" loading="lazy" />
          <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition flex items-center justify-center">
            <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition drop-shadow-lg" />
          </div>
        </div>
        <div className={clsx('flex items-center gap-1 mt-1 text-[10px]', dark ? 'text-slate-400' : 'text-slate-500')}>
          <ImageIcon className="h-3 w-3" /><span className="truncate">{att.file_name}</span>
        </div>
      </div>
    );
  }

  if (isVideoFile(att.file_type)) {
    return (
      <div className="mt-1 rounded-lg overflow-hidden max-w-[280px]">
        <video src={url} controls className="w-full rounded-lg" preload="metadata" />
        <div className={clsx('flex items-center gap-1 mt-1 text-[10px]', dark ? 'text-slate-400' : 'text-slate-500')}>
          <Video className="h-3 w-3" /><span className="truncate">{att.file_name}</span>
        </div>
      </div>
    );
  }

  if (isAudioFile(att.file_type)) {
    return <div className="mt-1"><VoicePlayer url={url} isMe={isMe} dark={dark} /></div>;
  }

  const iconColor = att.file_type.includes('pdf') ? 'text-red-500' : att.file_type.includes('doc') ? 'text-blue-600' : att.file_type.includes('zip') || att.file_type.includes('rar') ? 'text-amber-500' : 'text-blue-500';

  return (
    <a href={url} download={att.file_name} target="_blank" rel="noopener noreferrer"
      className={clsx('flex items-center gap-2 mt-1 rounded-lg p-2 transition',
        isMe ? (dark ? 'bg-emerald-800/50 hover:bg-emerald-800/70' : 'bg-white/10 hover:bg-white/20')
          : (dark ? 'bg-slate-600/50 hover:bg-slate-600/70' : 'bg-slate-100 hover:bg-slate-200'))}>
      <div className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-lg', isMe ? (dark ? 'bg-emerald-700' : 'bg-white/20') : (dark ? 'bg-slate-500' : 'bg-white'))}>
        {att.file_type.includes('pdf') ? <FileText className={clsx('h-5 w-5', isMe && !dark ? 'text-white' : iconColor)} />
          : <FileIcon className={clsx('h-5 w-5', isMe && !dark ? 'text-white' : iconColor)} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className={clsx('truncate text-xs font-medium', isMe ? (dark ? 'text-emerald-100' : 'text-white') : (dark ? 'text-slate-200' : 'text-slate-700'))}>{att.file_name}</p>
        <p className={clsx('text-[10px]', isMe ? (dark ? 'text-emerald-300' : 'text-white/60') : (dark ? 'text-slate-400' : 'text-slate-400'))}>{formatFileSize(att.file_size)}</p>
      </div>
      <Download className={clsx('h-4 w-4 shrink-0', isMe ? (dark ? 'text-emerald-300' : 'text-white/70') : (dark ? 'text-slate-400' : 'text-slate-400'))} />
    </a>
  );
}

// ─── Emoji Picker ───────────────────────────────────────────────────

function EmojiPicker({ onSelect, onClose, dark }: { onSelect: (emoji: string) => void; onClose: () => void; dark: boolean }) {
  const [tab, setTab] = useState<'emoji' | 'sticker'>('emoji');
  const [category, setCategory] = useState(Object.keys(EMOJI_CATEGORIES)[0]);
  const [search, setSearch] = useState('');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.emoji-picker-container')) onCloseRef.current();
    };
    const timer = setTimeout(() => window.addEventListener('click', h), 0);
    return () => { clearTimeout(timer); window.removeEventListener('click', h); };
  }, []);

  return (
    <div data-menu className={clsx('emoji-picker-container absolute bottom-full mb-2 left-0 z-50 w-72 rounded-2xl shadow-2xl border overflow-hidden animate-in slide-in-from-bottom-2 duration-200',
      dark ? 'bg-[#202c33] border-slate-600' : 'bg-white border-slate-200')}>
      <div className={clsx('flex border-b', dark ? 'border-slate-600' : 'border-slate-200')}>
        <button onClick={() => setTab('emoji')} className={clsx('flex-1 py-2 text-xs font-medium transition', tab === 'emoji' ? 'text-teal-500 border-b-2 border-teal-500' : (dark ? 'text-slate-400' : 'text-slate-500'))}>Emoji</button>
        <button onClick={() => setTab('sticker')} className={clsx('flex-1 py-2 text-xs font-medium transition', tab === 'sticker' ? 'text-teal-500 border-b-2 border-teal-500' : (dark ? 'text-slate-400' : 'text-slate-500'))}>Stickers</button>
      </div>
      {tab === 'emoji' && (
        <>
          <div className="px-2 py-1.5">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search emoji..."
              className={clsx('w-full rounded-lg px-3 py-1.5 text-xs outline-none', dark ? 'bg-slate-700 text-white placeholder-slate-400' : 'bg-slate-100 placeholder-slate-400')} />
          </div>
          <div className={clsx('flex gap-1 px-2 pb-1 overflow-x-auto', dark ? 'border-slate-600' : '')}>
            {Object.keys(EMOJI_CATEGORIES).map(cat => (
              <button key={cat} onClick={() => setCategory(cat)}
                className={clsx('shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium transition',
                  category === cat ? 'bg-teal-500 text-white' : (dark ? 'text-slate-400 hover:bg-slate-600' : 'text-slate-500 hover:bg-slate-100'))}>
                {cat}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-8 gap-0.5 p-2 max-h-48 overflow-y-auto">
            {(EMOJI_CATEGORIES[category as keyof typeof EMOJI_CATEGORIES] || []).map(e => (
              <button key={e} onClick={() => { onSelect(e); onClose(); }}
                className={clsx('grid h-8 w-8 place-items-center rounded-lg text-lg transition', dark ? 'hover:bg-slate-600' : 'hover:bg-slate-100')}>
                {e}
              </button>
            ))}
          </div>
        </>
      )}
      {tab === 'sticker' && (
        <div className="p-2 max-h-56 overflow-y-auto">
          {Object.entries(STICKER_PACKS).map(([pack, stickers]) => (
            <div key={pack}>
              <p className={clsx('text-[10px] font-bold uppercase tracking-wider mb-1 px-1', dark ? 'text-slate-400' : 'text-slate-500')}>{pack}</p>
              <div className="grid grid-cols-4 gap-1 mb-2">
                {stickers.map(s => (
                  <button key={s} onClick={() => { onSelect(s); onClose(); }}
                    className={clsx('grid h-14 w-14 place-items-center rounded-xl text-3xl transition', dark ? 'hover:bg-slate-600' : 'hover:bg-slate-100')}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Mention Autocomplete ───────────────────────────────────────────

function MentionAutocomplete({ query, contacts, onSelect, dark }: {
  query: string; contacts: ChatContact[];
  onSelect: (contact: ChatContact) => void; dark: boolean;
}) {
  const filtered = contacts.filter(c => c.full_name.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
  if (!filtered.length) return null;

  return (
    <div className={clsx('absolute bottom-full mb-1 left-12 z-40 w-56 rounded-xl shadow-xl border overflow-hidden animate-in slide-in-from-bottom-1 duration-150',
      dark ? 'bg-[#202c33] border-slate-600' : 'bg-white border-slate-200')}>
      {filtered.map(c => (
        <button key={c.id} onClick={() => onSelect(c)}
          className={clsx('flex w-full items-center gap-2 px-3 py-2 text-left transition',
            dark ? 'hover:bg-slate-600' : 'hover:bg-teal-50')}>
          <Avatar name={c.full_name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className={clsx('truncate text-xs font-semibold', dark ? 'text-slate-200' : 'text-slate-700')}>{c.full_name}</p>
            <p className={clsx('text-[10px] capitalize', dark ? 'text-slate-400' : 'text-slate-500')}>{c.role.replace('_', ' ')}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Delete Confirmation Dialog ─────────────────────────────────────

function DeleteDialog({ isMe, onDeleteForMe, onDeleteForEveryone, onClose, dark }: {
  isMe: boolean; onDeleteForMe: () => void; onDeleteForEveryone: () => void; onClose: () => void; dark: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={clsx('w-full max-w-xs rounded-2xl shadow-2xl p-5', dark ? 'bg-[#202c33]' : 'bg-white')} onClick={e => e.stopPropagation()}>
        <h3 className={clsx('text-lg font-bold mb-4', dark ? 'text-white' : 'text-slate-800')}>Delete message?</h3>
        <div className="space-y-2">
          <button onClick={() => { onDeleteForMe(); onClose(); }}
            className={clsx('w-full rounded-xl py-2.5 text-sm font-medium transition border',
              dark ? 'border-slate-600 text-slate-200 hover:bg-slate-600' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}>
            <Trash2 className="inline h-3.5 w-3.5 mr-2" />Delete for me
          </button>
          {isMe && (
            <button onClick={() => { onDeleteForEveryone(); onClose(); }}
              className="w-full rounded-xl py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition">
              <Trash2 className="inline h-3.5 w-3.5 mr-2" />Delete for everyone
            </button>
          )}
          <button onClick={onClose}
            className={clsx('w-full rounded-xl py-2.5 text-sm font-medium transition', dark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700')}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Message Context Menu ───────────────────────────────────────────

function MsgContextMenu({ msg, isMe, user, dark, onReply, onEdit, onForward, onStar, onPin, onCopy, onDelete, onClose }: {
  msg: ChatMessage; isMe: boolean; user: { role: string }; dark: boolean;
  onReply: () => void; onEdit: () => void; onForward: () => void;
  onStar: () => void; onPin: () => void; onCopy: () => void; onDelete: () => void; onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const h = () => onCloseRef.current();
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, []);

  return (
    <div data-menu className={clsx('absolute z-50 w-48 rounded-xl border py-1 shadow-xl animate-in fade-in slide-in-from-top-1 duration-150',
      dark ? 'bg-[#202c33] border-slate-600' : 'bg-white border-slate-200',
      isMe ? 'right-0' : 'left-0')} style={{ top: '-4px' }} onClick={e => e.stopPropagation()}>
      <button onClick={onReply} className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition', dark ? 'text-slate-200 hover:bg-slate-600' : 'text-slate-700 hover:bg-slate-50')}>
        <Reply className="h-3.5 w-3.5 text-slate-400" /> Reply
      </button>
      <button onClick={onForward} className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition', dark ? 'text-slate-200 hover:bg-slate-600' : 'text-slate-700 hover:bg-slate-50')}>
        <Forward className="h-3.5 w-3.5 text-slate-400" /> Forward
      </button>
      {isMe && !msg.is_deleted && (
        <button onClick={onEdit} className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition', dark ? 'text-slate-200 hover:bg-slate-600' : 'text-slate-700 hover:bg-slate-50')}>
          <Edit3 className="h-3.5 w-3.5 text-slate-400" /> Edit
        </button>
      )}
      <button onClick={onCopy} className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition', dark ? 'text-slate-200 hover:bg-slate-600' : 'text-slate-700 hover:bg-slate-50')}>
        <Copy className="h-3.5 w-3.5 text-slate-400" /> Copy
      </button>
      <button onClick={onStar} className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition', dark ? 'text-slate-200 hover:bg-slate-600' : 'text-slate-700 hover:bg-slate-50')}>
        <Star className={clsx('h-3.5 w-3.5', msg.is_starred ? 'text-amber-500 fill-amber-500' : 'text-slate-400')} /> {msg.is_starred ? 'Unstar' : 'Star'}
      </button>
      <button onClick={onPin} className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition', dark ? 'text-slate-200 hover:bg-slate-600' : 'text-slate-700 hover:bg-slate-50')}>
        <Pin className={clsx('h-3.5 w-3.5 rotate-45', msg.is_pinned ? 'text-teal-500' : 'text-slate-400')} /> {msg.is_pinned ? 'Unpin' : 'Pin'}
      </button>
      {(isMe || user.role === 'super_admin') && (
        <>
          <div className={clsx('my-0.5 border-t', dark ? 'border-slate-600' : 'border-slate-100')} />
          <button onClick={onDelete} className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition', dark ? 'text-red-400 hover:bg-red-900/30' : 'text-red-600 hover:bg-red-50')}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </>
      )}
    </div>
  );
}

// ─── Pinned Messages Bar ────────────────────────────────────────────

function PinnedMessagesBar({ conversationId, dark, onJumpTo }: { conversationId: string; dark: boolean; onJumpTo: (msgId: string) => void }) {
  const { data: pinned = [] } = usePinnedMessages(conversationId);
  const [expanded, setExpanded] = useState(false);

  if (!pinned.length) return null;

  return (
    <div className={clsx('shrink-0 border-b transition-all', dark ? 'bg-[#1a2a32] border-slate-600' : 'bg-amber-50/80 border-amber-100')}>
      <button onClick={() => setExpanded(v => !v)} className={clsx('flex items-center gap-2 w-full px-4 py-1.5 text-left', dark ? 'hover:bg-slate-700/50' : 'hover:bg-amber-100/50')}>
        <Pin className={clsx('h-3.5 w-3.5 rotate-45 shrink-0', dark ? 'text-amber-400' : 'text-amber-600')} />
        <span className={clsx('text-xs font-medium flex-1 truncate', dark ? 'text-amber-200' : 'text-amber-800')}>
          {pinned.length} pinned message{pinned.length > 1 ? 's' : ''} {!expanded && `— ${pinned[0]?.body?.slice(0, 40) || ''}`}
        </span>
        <ChevronDown className={clsx('h-3.5 w-3.5 shrink-0 transition-transform', expanded && 'rotate-180', dark ? 'text-amber-400' : 'text-amber-500')} />
      </button>
      {expanded && (
        <div className="px-4 pb-2 space-y-1">
          {pinned.map((p: any) => (
            <button key={p.id} onClick={() => onJumpTo(p.id)}
              className={clsx('w-full text-left rounded-lg px-3 py-1.5 transition', dark ? 'hover:bg-slate-600' : 'hover:bg-amber-100')}>
              <p className={clsx('text-xs font-semibold', dark ? 'text-slate-200' : 'text-slate-700')}>{p.sender_name}</p>
              <p className={clsx('text-xs truncate', dark ? 'text-slate-400' : 'text-slate-500')}>{p.body?.slice(0, 60)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Forward Dialog ─────────────────────────────────────────────────

function ForwardDialog({ onSelect, onClose, dark }: { onSelect: (convId: string) => void; onClose: () => void; dark: boolean }) {
  const { data: conversations = [] } = useChatConversations();
  const [search, setSearch] = useState('');
  const filtered = conversations.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = c.type === 'direct' ? c.other_user?.full_name : c.title;
    return name?.toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={clsx('w-full max-w-md rounded-2xl shadow-2xl', dark ? 'bg-[#202c33]' : 'bg-white')} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 rounded-t-2xl text-white" style={{ background: `linear-gradient(135deg, ${WA_GREEN_DARK}, ${WA_GREEN_LIGHT})` }}>
          <h3 className="text-lg font-bold">Forward to</h3>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations..." className="w-full rounded-lg bg-white/15 py-2 pl-9 pr-3 text-sm text-white placeholder-white/50 outline-none focus:bg-white/25 transition" autoFocus />
          </div>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {filtered.map(conv => {
            const name = conv.type === 'direct' ? conv.other_user?.full_name || 'Unknown' : conv.title || 'Conversation';
            return (
              <button key={conv.id} onClick={() => { onSelect(conv.id); onClose(); }}
                className={clsx('flex w-full items-center gap-3 px-5 py-2.5 text-left transition', dark ? 'hover:bg-slate-600' : 'hover:bg-teal-50')}>
                <Avatar name={name} type={conv.type} size="sm" />
                <span className={clsx('truncate text-sm font-medium', dark ? 'text-slate-200' : 'text-slate-700')}>{name}</span>
                <ChevronRight className={clsx('h-4 w-4 ml-auto', dark ? 'text-slate-500' : 'text-slate-300')} />
              </button>
            );
          })}
        </div>
        <div className={clsx('border-t px-5 py-3', dark ? 'border-slate-600' : 'border-slate-100')}>
          <button onClick={onClose} className={clsx('w-full rounded-xl border py-2.5 text-sm font-medium transition', dark ? 'border-slate-600 text-slate-300 hover:bg-slate-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Conversation List ──────────────────────────────────────────────

function ConversationList({
  conversations, selected, onSelect, onNewChat, onBroadcast, user, loading, dark,
}: {
  conversations: ChatConversation[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onBroadcast: () => void;
  user: { id: string; role: string; name: string };
  loading: boolean;
  dark: boolean;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'direct' | 'lead' | 'broadcast' | 'whatsapp' | 'external' | 'open' | 'expired' | 'archived'>('all');
  const [leadCategory, setLeadCategory] = useState<'all' | 'trader' | 'partner' | 'unknown'>('all');
  const leadOnly = user.role === 'member' || user.role === 'partner';
  const { data: unreadData } = useChatUnread();
  const syncWasp = useSyncWaspInbox();
  const totalUnread = unreadData?.unread || 0;
  const { data: searchResults } = useSearchMessages(search);
  const { data: archivedConvs = [] } = useChatConversations(undefined, filter === 'archived');

  const displayConversations = (filter === 'archived' ? archivedConvs : conversations)
    .filter(c => !leadOnly || c.type === 'lead')
    .filter(c => leadCategory === 'all' || (c.type === 'lead' && (c.lead?.category || 'unknown') === leadCategory));

  const pinned = displayConversations.filter(c => c.is_pinned && (filter === 'all' || (filter === 'unread' && c.unread_count > 0)));
  const regular = displayConversations.filter(c => {
    if (filter === 'archived') return true;
    if (filter === 'unread' && c.unread_count === 0) return false;
    if (filter === 'whatsapp' && c.channel !== 'whatsapp') return false;
    if (filter === 'external' && !c.is_external_unknown) return false;
    if (filter === 'open' && c.session?.status !== 'open') return false;
    if (filter === 'expired' && c.session?.status !== 'expired') return false;
    if (!['all', 'unread', 'whatsapp', 'external', 'open', 'expired'].includes(filter) && c.type !== filter) return false;
    if (pinned.includes(c)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    const name = c.type === 'direct' ? c.other_user?.full_name : c.title;
    return name?.toLowerCase().includes(q) || c.last_message?.toLowerCase().includes(q);
  });

  const renderConv = (conv: ChatConversation) => {
    const isActive = conv.id === selected;
    const name = conv.type === 'direct' ? conv.other_user?.full_name || 'Unknown' : conv.type === 'broadcast' ? conv.title || 'Broadcast' : conv.title || 'Lead Discussion';
    const isOnline = conv.type === 'direct' && conv.other_user?.status === 'active';

    return (
      <button key={conv.id} onClick={() => onSelect(conv.id)}
        className={clsx('flex w-full items-center gap-3 px-4 py-3 text-left transition-all duration-200 border-b',
          dark ? (isActive ? 'bg-[#2a3942] border-slate-700' : 'border-slate-700/50 hover:bg-[#202c33]')
            : (isActive ? 'bg-teal-50/70 border-slate-50' : 'border-slate-50 hover:bg-slate-50'))}>
        <div className="relative shrink-0">
          <Avatar name={name} type={conv.type} />
          {isOnline && <OnlineDot />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 min-w-0">
              {conv.is_pinned && <Pin className={clsx('h-3 w-3 shrink-0 rotate-45', dark ? 'text-slate-500' : 'text-slate-400')} />}
              {conv.is_muted && <BellOff className={clsx('h-3 w-3 shrink-0', dark ? 'text-slate-500' : 'text-slate-400')} />}
              <span className={clsx('truncate text-sm', conv.unread_count > 0
                ? (dark ? 'font-bold text-white' : 'font-bold text-slate-900')
                : (dark ? 'font-medium text-slate-200' : 'font-medium text-slate-700'))}>{name}</span>
              {conv.type === 'lead' && <LeadCategoryBadge category={conv.lead?.category} />}
              {conv.channel === 'whatsapp' && (
                <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">WA</span>
              )}
              {conv.is_external_unknown && (
                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">External</span>
              )}
            </div>
            <span className={clsx('shrink-0 text-[11px]', conv.unread_count > 0 ? 'text-teal-500 font-medium' : (dark ? 'text-slate-500' : 'text-slate-400'))}>
              {formatListTime(conv.last_message_at)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1 mt-0.5">
            <p className={clsx('truncate text-[13px]', conv.unread_count > 0 ? (dark ? 'text-slate-300' : 'text-slate-700') : (dark ? 'text-slate-500' : 'text-slate-400'))}>
              {conv.last_message_type === 'file' ? <><Paperclip className="inline h-3 w-3 mr-0.5" /> Attachment</>
                : conv.last_message_type === 'voice' ? <><Mic className="inline h-3 w-3 mr-0.5" /> Voice note</>
                  : conv.last_message ? <>{conv.last_sender_id === user.id && <CheckCheck className="inline h-3 w-3 mr-0.5 text-sky-500" />}{conv.last_message.slice(0, 55)}</>
                    : <span className="italic">No messages</span>}
            </p>
            {conv.unread_count > 0 && (
              <span className="grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-teal-500 px-1.5 text-[10px] font-bold text-white">
                {conv.unread_count > 99 ? '99+' : conv.unread_count}
              </span>
            )}
          </div>
          {conv.channel === 'whatsapp' && conv.session && (
            <div className={clsx('mt-1 text-[10px]', conv.session.status === 'open' ? 'text-emerald-500' : dark ? 'text-amber-300' : 'text-amber-600')}>
              {conv.session.status === 'open' ? `WhatsApp session open${conv.session.expires_at ? ` - ${formatSessionExpiry(conv.session.expires_at)}` : ''}` : conv.disabled_reason || conv.session.disabled_reason}
            </div>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-4 py-3" style={{ background: dark ? WA_DARK_HEADER : `linear-gradient(135deg, ${WA_GREEN_DARK}, ${WA_GREEN_LIGHT})` }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> Messages
            {totalUnread > 0 && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{totalUnread}</span>}
          </h2>
          <div className="flex items-center gap-1">
            {(user.role === 'super_admin' || user.role === 'rm') && (
              <button onClick={onBroadcast} className="grid h-8 w-8 place-items-center rounded-full text-white/80 hover:bg-white/10 transition" title="Broadcast"><Megaphone className="h-4 w-4" /></button>
            )}
            {!leadOnly && (
              <button onClick={onNewChat} className="grid h-8 w-8 place-items-center rounded-full text-white/80 hover:bg-white/10 transition" title="New Chat"><Plus className="h-4 w-4" /></button>
            )}
          </div>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-3 top-2 h-4 w-4 text-white/40" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search messages & chats..."
            className="w-full rounded-lg bg-white/15 py-1.5 pl-9 pr-3 text-sm text-white placeholder-white/40 outline-none focus:bg-white/25 transition" />
        </div>
      </div>

      <div className={clsx('shrink-0 flex gap-1 px-3 py-2 border-b overflow-x-auto', dark ? 'border-slate-700 bg-[#111b21]' : 'border-slate-100 bg-white')}>
        {(leadOnly
          ? (['all', 'unread', 'lead', 'whatsapp', 'open', 'expired', 'archived'] as const)
          : (['all', 'unread', 'direct', 'lead', 'whatsapp', 'external', 'open', 'expired', 'broadcast', 'archived'] as const)
        ).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={clsx('rounded-full px-3 py-1 text-[11px] font-medium transition whitespace-nowrap',
              filter === f
                ? 'bg-teal-600 text-white'
                : (dark ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'))}>
            {f === 'all' ? 'All' : f === 'whatsapp' ? 'WhatsApp' : f === 'external' ? 'External' : f === 'open' ? 'Open session' : f === 'expired' ? 'Expired' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        {['super_admin', 'admin', 'rm'].includes(user.role) && (
          <button
            type="button"
            onClick={() => syncWasp.mutate()}
            disabled={syncWasp.isPending}
            className={clsx('ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium transition whitespace-nowrap',
              dark ? 'bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/60' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100')}
            title="Pull latest WhatsApp conversations from WaspAkamify External Chat API"
          >
            <RefreshCw className={clsx('h-3 w-3', syncWasp.isPending && 'animate-spin')} />
            Sync WhatsApp
          </button>
        )}
      </div>
      <div className={clsx('shrink-0 flex gap-1 px-3 py-2 border-b overflow-x-auto', dark ? 'border-slate-700 bg-[#111b21]' : 'border-slate-100 bg-white')}>
        {(['all', 'trader', 'partner', 'unknown'] as const).map(category => (
          <button key={category} onClick={() => setLeadCategory(category)} className={clsx('rounded-full px-3 py-1 text-[11px] font-medium whitespace-nowrap', leadCategory === category ? 'bg-violet-600 text-white' : dark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600')}>
            {category === 'all' ? 'All categories' : category === 'trader' ? 'Trader Leads' : category === 'partner' ? 'Partner Leads' : 'Unknown'}
          </button>
        ))}
      </div>

      {search.length >= 2 && searchResults && searchResults.length > 0 && (
        <div className={clsx('border-b max-h-40 overflow-y-auto', dark ? 'bg-[#1a2a32] border-slate-700' : 'bg-amber-50/50 border-slate-200')}>
          <div className={clsx('px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider', dark ? 'text-slate-400' : 'text-slate-500')}>Search Results</div>
          {searchResults.slice(0, 5).map((r: any) => (
            <button key={r.id} onClick={() => onSelect(r.conversation_id)} className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs', dark ? 'hover:bg-slate-600' : 'hover:bg-amber-50')}>
              <Search className="h-3 w-3 text-slate-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className={clsx('font-medium', dark ? 'text-slate-200' : 'text-slate-700')}>{r.sender_name}</span>
                <span className={clsx('ml-1 truncate', dark ? 'text-slate-400' : 'text-slate-400')}>{r.body?.slice(0, 50)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className={clsx('flex-1 overflow-y-auto', dark ? 'bg-[#111b21]' : 'bg-white')}>
        {loading && !conversations.length && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin mb-2" /><p className="text-sm">Loading...</p></div>
        )}
        {!loading && !pinned.length && !regular.length && (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <MessageCircle className={clsx('h-12 w-12 mb-3', dark ? 'text-slate-600' : 'text-slate-200')} />
            <p className={clsx('text-sm', dark ? 'text-slate-400' : 'text-slate-500')}>
              {search ? 'No matches' : leadOnly ? 'No lead conversations yet. Open a lead and click Chat.' : filter === 'archived' ? 'No archived chats' : 'No conversations yet'}
            </p>
            {!leadOnly && !search && filter !== 'archived' && <button onClick={onNewChat} className="mt-3 flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 transition"><Plus className="h-3.5 w-3.5" /> New Chat</button>}
          </div>
        )}
        {pinned.length > 0 && (
          <>
            <div className={clsx('px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider', dark ? 'text-teal-400' : 'text-teal-600')}>
              <Pin className="inline h-3 w-3 rotate-45 mr-1" />Pinned
            </div>
            {pinned.map(renderConv)}
          </>
        )}
        {regular.length > 0 && pinned.length > 0 && (
          <div className={clsx('px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider', dark ? 'text-slate-500' : 'text-slate-400')}>All Chats</div>
        )}
        {regular.map(renderConv)}
      </div>
    </div>
  );
}

// ─── Message Thread ─────────────────────────────────────────────────

function MessageThread({
  conversationId, conversation, user, dark, onBack, onToggleDark,
}: {
  conversationId: string;
  conversation?: ChatConversation;
  user: { id: string; name: string; role: string };
  dark: boolean;
  onBack: () => void;
  onToggleDark: () => void;
}) {
  const { data, isLoading } = useChatMessages(conversationId);
  const sendMsg = useSendMessage(conversationId);
  const sendMsgWithMentions = useSendMessageWithMentions(conversationId);
  const sendWasp = useSendWaspMessage(conversationId);
  const markRead = useMarkConversationRead(conversationId);
  const uploadFile = useUploadFile(conversationId);
  const uploadMulti = useUploadMultipleFiles(conversationId);
  const reactToMsg = useReactToMessage();
  const deleteMsg = useDeleteMessage();
  const deleteForMe = useDeleteForMe();
  const editMsg = useEditMessage();
  const forwardMsg = useForwardMessage();
  const starMsg = useStarMessage();
  const pinMsg = usePinMessage();
  const pinConv = usePinConversation();
  const muteConv = useMuteConversation();
  const archiveConv = useArchiveConversation();
  const exportChat = useAdminExportChat();
  const { data: contacts = [] } = useChatContacts();
  const { data: participants = [] } = useConversationParticipants(conversationId);
  const { typingUsers, recordingUsers, sendTyping, sendStopTyping, sendRecording, sendStopRecording } = useTypingIndicator(conversationId);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [showEmoji, setShowEmoji] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [contextMenu, setContextMenu] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [forwardMsgId, setForwardMsgId] = useState<string | null>(null);
  const [searchInChat, setSearchInChat] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<ChatMessage | null>(null);
  const [mediaPreview, setMediaPreview] = useState<File[] | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [sendMode, setSendMode] = useState<'internal' | 'whatsapp'>('internal');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<NodeJS.Timeout | null>(null);
  const prevMsgCount = useRef(0);
  const messages = data?.messages || [];
  const isWaspConversation = conversation?.channel === 'whatsapp' || conversation?.provider === 'wasp';
  const canSendWasp = Boolean(isWaspConversation && conversation?.can_send_whatsapp);
  const sessionInfo = sessionBadge(conversation?.session);
  const waspDisabledReason = conversation?.disabled_reason || conversation?.session?.disabled_reason || 'Waiting for customer message. WhatsApp reply is available only after the customer sends a message.';
  const isSending = sendMode === 'whatsapp' ? sendWasp.isPending : (sendMsg.isPending || sendMsgWithMentions.isPending);

  useEffect(() => {
    setSendMode('internal');
  }, [conversationId]);

  useEffect(() => {
    const draft = localStorage.getItem(`chat-draft-${conversationId}`);
    if (draft) setInput(draft);
  }, [conversationId]);

  const markReadFired = useRef(false);
  useEffect(() => {
    if (conversationId && !markReadFired.current) {
      markReadFired.current = true;
      markRead.mutate();
    }
  }, [conversationId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  useEffect(() => {
    if (messages.length > prevMsgCount.current && prevMsgCount.current > 0) {
      const latest = messages[messages.length - 1];
      if (latest && latest.sender_id !== user.id) {
        playNotificationSound();
        requestDesktopNotification(latest.sender_name, latest.body?.slice(0, 100) || 'New message');
      }
    }
    prevMsgCount.current = messages.length;
  }, [messages.length]);

  const handleSend = () => {
    if (editingMsg) {
      editMsg.mutate({ messageId: editingMsg.id, body: input.trim() });
      setEditingMsg(null);
      setInput('');
      return;
    }
    const text = input.trim();
    if (!text || isSending) return;

    if (sendMode === 'whatsapp') {
      if (!canSendWasp) {
        toast.error(waspDisabledReason);
        return;
      }
      sendWasp.mutate({ text }, {
        onSuccess: () => {
          setInput('');
          setReplyTo(null);
          sendStopTyping();
          localStorage.removeItem(`chat-draft-${conversationId}`);
          inputRef.current?.focus();
        },
      });
      return;
    }

    const mentionIds = extractMentions(text, contacts);
    if (mentionIds.length > 0) {
      sendMsgWithMentions.mutate({ body: text, reply_to_id: replyTo?.id, mentions: mentionIds });
    } else {
      sendMsg.mutate({ body: text, reply_to_id: replyTo?.id });
    }
    setInput('');
    setReplyTo(null);
    sendStopTyping();
    localStorage.removeItem(`chat-draft-${conversationId}`);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleInputChange = (val: string) => {
    setInput(val);
    localStorage.setItem(`chat-draft-${conversationId}`, val);
    sendTyping();
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => sendStopTyping(), 2000);

    const lastAt = val.lastIndexOf('@');
    if (lastAt >= 0) {
      const afterAt = val.slice(lastAt + 1);
      const hasSpace = afterAt.includes(' ');
      if (!hasSpace && afterAt.length > 0 && afterAt.length < 20) {
        setMentionQuery(afterAt);
        setShowMentions(true);
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }
  };

  const handleMentionSelect = (contact: ChatContact) => {
    const lastAt = input.lastIndexOf('@');
    if (lastAt >= 0) {
      setInput(input.slice(0, lastAt) + `@${contact.full_name} `);
    }
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setMediaPreview(files);
    }
    e.target.value = '';
  };

  const handleMediaSend = (files: File[], caption: string) => {
    if (files.length === 1) {
      uploadFile.mutate(files[0]);
    } else {
      uploadMulti.mutate(files);
    }
    if (caption.trim()) {
      sendMsg.mutate({ body: caption.trim() });
    }
    setMediaPreview(null);
  };

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) setMediaPreview(files);
  }, []);

  const handleCopyMsg = (body: string) => {
    navigator.clipboard.writeText(body).catch(() => { });
    setContextMenu(null);
  };

  const handleForward = (targetConvId: string) => {
    if (forwardMsgId) forwardMsg.mutate({ messageId: forwardMsgId, conversationId: targetConvId });
    setForwardMsgId(null);
  };

  const handleExportChat = async () => {
    try {
      const result = await exportChat.mutateAsync(conversationId);
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-export-${conversationId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { }
    setShowMenu(false);
  };

  const title = conversation?.type === 'direct' ? conversation.other_user?.full_name || 'Chat' : conversation?.title || 'Conversation';
  const isOnline = conversation?.type === 'direct' && conversation.other_user?.status === 'active';
  const lastSeen = conversation?.type === 'direct' ? formatLastSeen(conversation.other_user?.last_seen_at || null) : null;

  const typingNames = Array.from(typingUsers.values()).filter(n => n !== user.name);
  const recordingNames = Array.from(recordingUsers.values()).filter(n => n !== user.name);

  const { data: inChatSearch } = useSearchMessages(searchInChat, conversationId);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-menu]')) {
        setShowEmoji(null);
        setContextMenu(null);
        setShowMenu(false);
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const grouped = useMemo(() => {
    const g: { date: string; msgs: ChatMessage[] }[] = [];
    let cur = '';
    messages.forEach(m => {
      const d = new Date(m.created_at);
      const k = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      if (k !== cur) { cur = k; g.push({ date: k, msgs: [m] }); }
      else g[g.length - 1].msgs.push(m);
    });
    return g;
  }, [messages]);

  const renderMsgBody = (body: string) => {
    if (!body) return null;
    const parts = body.split(/(@\w[\w\s]*?)(?=\s|$|@)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return <span key={i} className={clsx('font-semibold', dark ? 'text-sky-400' : 'text-teal-700')}>{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5" style={{ background: dark ? WA_DARK_HEADER : `linear-gradient(135deg, ${WA_GREEN_DARK}, ${WA_GREEN_LIGHT})` }}>
        <button onClick={onBack} className="grid h-8 w-8 place-items-center rounded-full text-white/80 hover:bg-white/10 sm:hidden transition"><ArrowLeft className="h-5 w-5" /></button>
        <div className="relative cursor-pointer" onClick={() => setShowParticipants(v => !v)}>
          <Avatar name={title} type={conversation?.type} />
          {isOnline && <OnlineDot />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-white">{title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {conversation?.type === 'lead' && <LeadCategoryBadge category={conversation.lead?.category} />}
            {isWaspConversation && (
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white">
                WaspAkamify WhatsApp
              </span>
            )}
            {conversation?.is_external_unknown && (
              <span className="rounded-full bg-violet-500/25 px-2 py-0.5 text-[10px] font-semibold text-violet-100">
                Admin-only external
              </span>
            )}
            {sessionInfo && (
              <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold',
                sessionInfo.tone === 'emerald' ? 'bg-emerald-500/25 text-emerald-100'
                  : sessionInfo.tone === 'amber' ? 'bg-amber-500/25 text-amber-100'
                    : sessionInfo.tone === 'violet' ? 'bg-violet-500/25 text-violet-100'
                      : 'bg-white/15 text-white/80')}>
                {sessionInfo.label}
              </span>
            )}
          </div>
          <div className="text-[11px] text-white/70">
            {recordingNames.length > 0 ? <span className="text-red-200">{recordingNames.join(', ')} recording <Mic className="inline h-2.5 w-2.5 animate-pulse" /></span>
              : typingNames.length > 0 ? <span className="text-emerald-200">{typingNames.join(', ')} typing <TypingDots /></span>
                : isOnline ? <span className="text-emerald-200 flex items-center gap-1"><Circle className="h-2 w-2 fill-emerald-400 text-emerald-400" /> Online</span>
                  : lastSeen && lastSeen !== 'online' ? lastSeen
                    : conversation?.type === 'broadcast' ? 'Broadcast' : conversation?.type === 'lead' ? 'Lead Discussion'
                      : conversation?.other_user?.role?.replace('_', ' ') || ''}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {conversation?.type === 'direct' && conversation.other_user?.email && (
            <button type="button" disabled className="grid h-8 w-8 place-items-center rounded-full text-white/40" title="In-system calls are available from lead communication"><Phone className="h-4 w-4" /></button>
          )}
          <button onClick={() => setShowSearch(v => !v)} className="grid h-8 w-8 place-items-center rounded-full text-white/80 hover:bg-white/10 transition"><Search className="h-4 w-4" /></button>
          <button onClick={onToggleDark} className="grid h-8 w-8 place-items-center rounded-full text-white/80 hover:bg-white/10 transition" title="Toggle dark mode">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <div className="relative" data-menu>
            <button onClick={() => setShowMenu(v => !v)} className="grid h-8 w-8 place-items-center rounded-full text-white/80 hover:bg-white/10 transition"><MoreVertical className="h-4 w-4" /></button>
            {showMenu && (
              <div className={clsx('absolute right-0 top-10 z-50 w-52 rounded-xl border py-1 shadow-lg', dark ? 'bg-[#202c33] border-slate-600' : 'bg-white border-slate-200')}>
                <button onClick={() => { pinConv.mutate(conversationId); setShowMenu(false); }} className={clsx('flex w-full items-center gap-2 px-3 py-2 text-sm transition', dark ? 'text-slate-200 hover:bg-slate-600' : 'text-slate-700 hover:bg-slate-50')}>
                  <Pin className="h-3.5 w-3.5 rotate-45" /> {conversation?.is_pinned ? 'Unpin' : 'Pin'} Chat
                </button>
                <button onClick={() => { muteConv.mutate(conversationId); setShowMenu(false); }} className={clsx('flex w-full items-center gap-2 px-3 py-2 text-sm transition', dark ? 'text-slate-200 hover:bg-slate-600' : 'text-slate-700 hover:bg-slate-50')}>
                  <BellOff className="h-3.5 w-3.5" /> {conversation?.is_muted ? 'Unmute' : 'Mute'}
                </button>
                <button onClick={() => { archiveConv.mutate(conversationId); setShowMenu(false); }} className={clsx('flex w-full items-center gap-2 px-3 py-2 text-sm transition', dark ? 'text-slate-200 hover:bg-slate-600' : 'text-slate-700 hover:bg-slate-50')}>
                  <Archive className="h-3.5 w-3.5" /> {conversation?.is_archived ? 'Unarchive' : 'Archive'}
                </button>
                <button onClick={() => setShowParticipants(v => !v)} className={clsx('flex w-full items-center gap-2 px-3 py-2 text-sm transition', dark ? 'text-slate-200 hover:bg-slate-600' : 'text-slate-700 hover:bg-slate-50')}>
                  <Users className="h-3.5 w-3.5" /> Participants
                </button>
                {user.role === 'super_admin' && (
                  <>
                    <div className={clsx('my-0.5 border-t', dark ? 'border-slate-600' : 'border-slate-100')} />
                    <button onClick={handleExportChat} className={clsx('flex w-full items-center gap-2 px-3 py-2 text-sm transition', dark ? 'text-slate-200 hover:bg-slate-600' : 'text-slate-700 hover:bg-slate-50')}>
                      <FileDown className="h-3.5 w-3.5" /> Export Chat
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Participants panel */}
      {showParticipants && (
        <div className={clsx('shrink-0 border-b max-h-48 overflow-y-auto', dark ? 'bg-[#1a2a32] border-slate-600' : 'bg-white border-slate-200')}>
          <div className={clsx('flex items-center justify-between px-4 py-2', dark ? '' : '')}>
            <span className={clsx('text-xs font-bold uppercase tracking-wider', dark ? 'text-slate-400' : 'text-slate-500')}>Participants ({participants.length})</span>
            <button onClick={() => setShowParticipants(false)} className={clsx('text-slate-400 hover:text-slate-600')}><X className="h-3.5 w-3.5" /></button>
          </div>
          {participants.map((p: any) => (
            <div key={p.id} className={clsx('flex items-center gap-2.5 px-4 py-1.5', dark ? 'hover:bg-slate-600' : 'hover:bg-slate-50')}>
              <div className="relative"><Avatar name={p.full_name} size="sm" />{p.status === 'active' && <OnlineDot />}</div>
              <div className="min-w-0 flex-1">
                <p className={clsx('truncate text-xs font-semibold', dark ? 'text-slate-200' : 'text-slate-700')}>{p.full_name}</p>
                <p className={clsx('text-[10px] capitalize', dark ? 'text-slate-400' : 'text-slate-500')}>{p.role?.replace('_', ' ')}</p>
              </div>
              {p.is_blocked && <span className="text-[10px] text-red-500 font-medium">Blocked</span>}
            </div>
          ))}
        </div>
      )}

      {/* In-chat search */}
      {showSearch && (
        <div className={clsx('shrink-0 flex items-center gap-2 px-3 py-2 border-b', dark ? 'bg-[#1a2a32] border-slate-600' : 'bg-white border-slate-200')}>
          <Search className={clsx('h-4 w-4', dark ? 'text-slate-400' : 'text-slate-400')} />
          <input value={searchInChat} onChange={e => setSearchInChat(e.target.value)} placeholder="Search in conversation..."
            className={clsx('flex-1 text-sm outline-none', dark ? 'bg-transparent text-white placeholder-slate-400' : 'bg-transparent')} autoFocus />
          {inChatSearch && inChatSearch.length > 0 && <span className={clsx('text-xs', dark ? 'text-slate-400' : 'text-slate-500')}>{inChatSearch.length} found</span>}
          <button onClick={() => { setShowSearch(false); setSearchInChat(''); }} className={clsx(dark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-400 hover:text-slate-600')}><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Pinned messages bar */}
      <PinnedMessagesBar conversationId={conversationId} dark={dark} onJumpTo={() => { }} />

      {/* Messages area */}
      <div className={clsx('flex-1 overflow-y-auto px-3 py-2 sm:px-4 relative transition-colors', isDragging && 'ring-4 ring-inset ring-teal-400/50')}
        style={dark ? { backgroundColor: WA_DARK_CHAT } : { backgroundColor: WA_CHAT_BG, backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cdefs%3E%3Cpattern id='p' width='40' height='40' patternUnits='userSpaceOnUse'%3E%3Cpath d='M20 3c2 0 3 1 3 3s-1 3-3 3-3-1-3-3 1-3 3-3zm-7 14c1 0 2 .5 2 1.5s-1 1.5-2 1.5-2-.5-2-1.5.9-1.5 2-1.5zm14 0c1 0 2 .5 2 1.5s-1 1.5-2 1.5-2-.5-2-1.5.9-1.5 2-1.5zm-7 11c1.5 0 2.5 1 2.5 2s-1 2-2.5 2-2.5-1-2.5-2 1-2 2.5-2z' fill='%23d4cfc6' fill-opacity='.25'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='200' height='200' fill='url(%23p)'/%3E%3C/svg%3E")` }}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>

        {isDragging && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-teal-500/10 backdrop-blur-[2px] pointer-events-none">
            <div className={clsx('rounded-2xl border-2 border-dashed border-teal-500 px-8 py-6 shadow-lg text-center', dark ? 'bg-slate-800/90' : 'bg-white/90')}>
              <Paperclip className="h-8 w-8 text-teal-500 mx-auto mb-2" />
              <p className={clsx('text-sm font-semibold', dark ? 'text-teal-300' : 'text-teal-700')}>Drop files to upload</p>
            </div>
          </div>
        )}

        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>}
        {!isLoading && !messages.length && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className={clsx('grid h-16 w-16 place-items-center rounded-full shadow mb-3', dark ? 'bg-[#202c33]' : 'bg-white')}><MessageCircle className="h-8 w-8 text-teal-400" /></div>
            <p className={clsx('text-sm font-medium', dark ? 'text-slate-300' : 'text-slate-600')}>Start the conversation!</p>
            <p className={clsx('text-xs mt-1', dark ? 'text-slate-500' : 'text-slate-400')}>Messages are end-to-end managed by your CRM</p>
          </div>
        )}

        {grouped.map(group => (
          <div key={group.date}>
            <div className="flex justify-center my-3">
              <span className={clsx('rounded-lg px-3 py-1 text-[11px] font-medium shadow-sm', dark ? 'bg-[#202c33] text-slate-300' : 'bg-white/80 text-slate-500')}>{group.date}</span>
            </div>
            <div className="space-y-0.5">
              {group.msgs.map((msg, i) => {
                const isMe = msg.sender_id === user.id;
                const isSystem = msg.message_type === 'system';
                const prev = i > 0 ? group.msgs[i - 1] : null;
                const showSender = !isMe && (!prev || prev.sender_id !== msg.sender_id);

                if (isSystem) return (
                  <div key={msg.id} className="flex justify-center my-2">
                    <span className={clsx('rounded-lg px-3 py-1 text-xs border', dark ? 'bg-[#1a2a32] border-slate-600 text-slate-300' : 'bg-amber-50 border-amber-100 text-amber-700')}>{msg.body}</span>
                  </div>
                );

                return (
                  <div key={msg.id} className={clsx('flex group relative', isMe ? 'justify-end' : 'justify-start')} style={{ transition: 'all 0.2s ease' }}>
                    <div className={clsx('max-w-[80%] sm:max-w-[65%] relative')}>
                      {showSender && (
                        <div className="mb-0.5 ml-1 flex items-center gap-1.5">
                          <span className="text-xs font-semibold" style={{ color: dark ? '#4fd1c5' : WA_GREEN_DARK }}>{msg.sender_name}</span>
                          <span className={clsx('text-[10px] capitalize', dark ? 'text-slate-500' : 'text-slate-400')}>~ {msg.sender_role?.replace('_', ' ')}</span>
                        </div>
                      )}

                      {msg.forwarded_from && (
                        <div className={clsx('flex items-center gap-1 mb-0.5 ml-1 text-[10px]', dark ? 'text-slate-500' : isMe ? 'text-slate-500' : 'text-slate-400')}>
                          <Forward className="h-2.5 w-2.5" /> Forwarded
                        </div>
                      )}

                      {msg.is_pinned && (
                        <div className={clsx('flex items-center gap-1 mb-0.5 ml-1 text-[10px]', dark ? 'text-amber-400' : 'text-amber-600')}>
                          <Pin className="h-2.5 w-2.5 rotate-45" /> Pinned
                        </div>
                      )}

                      {msg.reply_to && (
                        <div className={clsx('rounded-t-lg px-3 py-1.5 text-xs border-l-4',
                          isMe ? (dark ? 'bg-emerald-900/40 border-emerald-500' : 'bg-emerald-600/30 border-emerald-300')
                            : (dark ? 'bg-slate-700 border-teal-500' : 'bg-slate-200 border-teal-500'))}>
                          <p className={clsx('font-semibold', dark ? 'text-teal-400' : isMe ? 'text-teal-800' : 'text-teal-700')}>{msg.reply_to.sender_name}</p>
                          <p className={clsx('truncate', dark ? 'text-slate-400' : isMe ? 'text-slate-600' : 'text-slate-500')}>{msg.reply_to.body?.slice(0, 60)}</p>
                        </div>
                      )}

                      <div className={clsx('rounded-2xl px-3 py-1.5 text-[14px] leading-relaxed shadow-sm relative',
                        isMe ? (dark ? `bg-[${WA_DARK_BUBBLE_ME}] text-slate-100 rounded-tr-sm` : 'bg-[#dcf8c6] text-slate-800 rounded-tr-sm')
                          : (dark ? `bg-[${WA_DARK_BUBBLE_OTHER}] text-slate-100 rounded-tl-sm` : 'bg-white text-slate-800 rounded-tl-sm'),
                        msg.reply_to && 'rounded-t-none',
                        msg.is_deleted && 'italic opacity-60')}
                        style={isMe ? { backgroundColor: dark ? WA_DARK_BUBBLE_ME : '#dcf8c6' } : { backgroundColor: dark ? WA_DARK_BUBBLE_OTHER : 'white' }}>

                        {msg.is_starred && <Star className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 text-amber-500 fill-amber-500 drop-shadow" />}

                        {msg.attachments?.length > 0 && msg.attachments.map((att: ChatAttachment) => (
                          <AttachmentBubble key={att.id} att={att} isMe={isMe} dark={dark} onImageClick={(url, name) => setPreviewImage({ url, name })} />
                        ))}

                        {msg.body && !msg.is_deleted && msg.message_type !== 'file' && msg.message_type !== 'voice' && (
                          <div className="whitespace-pre-wrap break-words">{renderMsgBody(msg.body)}</div>
                        )}
                        {msg.is_deleted && <span className={clsx('italic text-xs', dark ? 'text-slate-500' : 'text-slate-500')}>This message was deleted</span>}

                        <div className="flex items-center justify-end gap-1 mt-0.5 -mb-0.5">
                          {msg.edited_at && <span className={clsx('text-[9px] italic', dark ? 'text-slate-500' : 'text-slate-400')}>edited</span>}
                          <span className={clsx('text-[10px]', dark ? 'text-slate-500' : 'text-slate-400')}>{formatTime(msg.created_at)}</span>
                          {isMe && <DeliveryTicks status={msg.delivery_status} dark={dark} />}
                        </div>

                        {msg.reactions?.length > 0 && (
                          <div className="flex flex-wrap gap-0.5 mt-1">
                            {Object.entries(msg.reactions.reduce<Record<string, number>>((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {}))
                              .map(([emoji, count]) => (
                                <span key={emoji} className={clsx('inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] shadow-sm cursor-pointer transition',
                                  dark ? 'bg-slate-700 border-slate-600 hover:bg-slate-600' : 'bg-white border-slate-200 hover:bg-slate-50')}
                                  onClick={() => reactToMsg.mutate({ messageId: msg.id, emoji })}>
                                  {emoji} {count > 1 && <span className={clsx('text-[9px]', dark ? 'text-slate-400' : 'text-slate-500')}>{count}</span>}
                                </span>
                              ))}
                          </div>
                        )}
                      </div>

                      {!msg.is_deleted && (
                        <div data-menu className={clsx('absolute top-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 z-10', isMe ? 'left-0 -translate-x-full pr-1' : 'right-0 translate-x-full pl-1')}>
                          <button onClick={() => setShowEmoji(showEmoji === msg.id ? null : msg.id)} className={clsx('grid h-6 w-6 place-items-center rounded-full shadow transition', dark ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-white text-slate-400 hover:text-slate-600')}><Smile className="h-3 w-3" /></button>
                          <button onClick={() => { setReplyTo(msg); inputRef.current?.focus(); }} className={clsx('grid h-6 w-6 place-items-center rounded-full shadow transition', dark ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-white text-slate-400 hover:text-slate-600')}><Reply className="h-3 w-3" /></button>
                          <button onClick={(e) => { e.stopPropagation(); setContextMenu(contextMenu === msg.id ? null : msg.id); }} className={clsx('grid h-6 w-6 place-items-center rounded-full shadow transition', dark ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-white text-slate-400 hover:text-slate-600')}><MoreVertical className="h-3 w-3" /></button>
                        </div>
                      )}

                      {showEmoji === msg.id && (
                        <div data-menu className={clsx('absolute z-20 flex flex-wrap gap-1 rounded-xl shadow-lg border p-2 max-w-[200px]',
                          dark ? 'bg-[#202c33] border-slate-600' : 'bg-white border-slate-200',
                          isMe ? 'right-0 bottom-full mb-1' : 'left-0 bottom-full mb-1')}>
                          {QUICK_REACTIONS.map(e => (
                            <button key={e} onClick={() => { reactToMsg.mutate({ messageId: msg.id, emoji: e }); setShowEmoji(null); }}
                              className={clsx('grid h-8 w-8 place-items-center rounded-lg text-lg transition', dark ? 'hover:bg-slate-600' : 'hover:bg-slate-100')}>{e}</button>
                          ))}
                        </div>
                      )}

                      {contextMenu === msg.id && (
                        <MsgContextMenu msg={msg} isMe={isMe} user={user} dark={dark}
                          onReply={() => { setReplyTo(msg); setContextMenu(null); inputRef.current?.focus(); }}
                          onEdit={() => { setEditingMsg(msg); setInput(msg.body); setContextMenu(null); inputRef.current?.focus(); }}
                          onForward={() => { setForwardMsgId(msg.id); setContextMenu(null); }}
                          onStar={() => { starMsg.mutate(msg.id); setContextMenu(null); }}
                          onPin={() => { pinMsg.mutate(msg.id); setContextMenu(null); }}
                          onCopy={() => handleCopyMsg(msg.body)}
                          onDelete={() => { setDeleteDialog(msg); setContextMenu(null); }}
                          onClose={() => setContextMenu(null)} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {(typingNames.length > 0 || recordingNames.length > 0) && (
          <div className="flex justify-start mt-1">
            <div className={clsx('rounded-xl px-3 py-2 shadow-sm', dark ? 'bg-[#202c33]' : 'bg-white')}>
              {recordingNames.length > 0 ? (
                <p className="text-xs text-red-500 flex items-center gap-1"><Mic className="h-3 w-3 animate-pulse" /> {recordingNames.join(', ')} recording...</p>
              ) : (
                <><p className={clsx('text-xs', dark ? 'text-slate-400' : 'text-slate-500')}>{typingNames.join(', ')} typing</p><TypingDots /></>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Edit bar */}
      {editingMsg && (
        <div className={clsx('shrink-0 flex items-center gap-2 px-4 py-2 border-t', dark ? 'bg-blue-900/30 border-blue-900/50' : 'bg-blue-50 border-blue-200')}>
          <Edit3 className="h-4 w-4 text-blue-500" />
          <div className="flex-1 min-w-0">
            <p className={clsx('text-xs font-semibold', dark ? 'text-blue-300' : 'text-blue-700')}>Editing message</p>
            <p className={clsx('text-xs truncate', dark ? 'text-blue-400' : 'text-blue-500')}>{editingMsg.body?.slice(0, 80)}</p>
          </div>
          <button onClick={() => { setEditingMsg(null); setInput(''); }} className={clsx('grid h-6 w-6 place-items-center rounded-full', dark ? 'text-blue-400 hover:bg-blue-900/50' : 'text-blue-400 hover:bg-blue-100')}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Reply bar */}
      {replyTo && !editingMsg && (
        <div className={clsx('shrink-0 flex items-center gap-2 px-4 py-2 border-t', dark ? 'bg-[#1a2a32] border-slate-600' : 'bg-slate-50 border-slate-200')}>
          <div className="flex-1 min-w-0 border-l-4 border-teal-500 pl-3">
            <p className={clsx('text-xs font-semibold', dark ? 'text-teal-400' : 'text-teal-700')}>{replyTo.sender_name}</p>
            <p className={clsx('text-xs truncate', dark ? 'text-slate-400' : 'text-slate-500')}>{replyTo.body?.slice(0, 80)}</p>
          </div>
          <button onClick={() => setReplyTo(null)} className={clsx('grid h-6 w-6 place-items-center rounded-full', dark ? 'text-slate-400 hover:bg-slate-600' : 'text-slate-400 hover:bg-slate-200')}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Upload progress */}
      {(uploadFile.isPending || uploadMulti.isPending) && (
        <div className={clsx('shrink-0 flex items-center gap-2 px-4 py-2 border-t', dark ? 'bg-teal-900/30 border-teal-900/50' : 'bg-teal-50 border-teal-100')}>
          <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
          <span className={clsx('text-xs', dark ? 'text-teal-300' : 'text-teal-700')}>Uploading file...</span>
        </div>
      )}

      {/* Voice recorder */}
      {isRecording && (
        <VoiceRecorder dark={dark}
          onSend={(file) => { uploadFile.mutate(file); setIsRecording(false); }}
          onCancel={() => setIsRecording(false)}
          sendRecording={sendRecording}
          sendStopRecording={sendStopRecording}
        />
      )}

      {/* Input area */}
      {!isRecording && (
        <div className={clsx('shrink-0 border-t', dark ? 'bg-[#202c33] border-slate-700' : 'bg-slate-100 border-slate-200')} style={{ position: 'relative' }}>
          {isWaspConversation && !editingMsg && (
            <div className={clsx('flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b', dark ? 'border-slate-700' : 'border-slate-200')}>
              <div className="flex items-center gap-1 rounded-full p-1" style={{ backgroundColor: dark ? '#111b21' : '#e2e8f0' }}>
                <button type="button" onClick={() => setSendMode('internal')}
                  className={clsx('rounded-full px-3 py-1 text-[11px] font-semibold transition',
                    sendMode === 'internal' ? 'bg-white text-slate-800 shadow-sm' : dark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900')}>
                  Internal note
                </button>
                <button type="button" disabled={!canSendWasp}
                  onClick={() => canSendWasp ? setSendMode('whatsapp') : toast.error(waspDisabledReason)}
                  className={clsx('rounded-full px-3 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                    sendMode === 'whatsapp' ? 'bg-emerald-600 text-white shadow-sm' : dark ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900')}>
                  WhatsApp reply
                </button>
              </div>
              <span className={clsx('text-[11px]', canSendWasp ? (dark ? 'text-emerald-300' : 'text-emerald-700') : (dark ? 'text-amber-300' : 'text-amber-700'))}>
                {canSendWasp ? 'Customer session is open.' : waspDisabledReason}
              </span>
            </div>
          )}

          <div className="flex items-end gap-2 px-3 py-2">
            <input ref={fileRef} type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.rar,.7z,.webm,.ogg" multiple onChange={handleFileUpload} />

            {showMentions && mentionQuery && (
              <MentionAutocomplete query={mentionQuery} contacts={contacts} onSelect={handleMentionSelect} dark={dark} />
            )}

            {showEmojiPicker && (
              <EmojiPicker dark={dark}
                onSelect={(emoji) => { setInput(prev => prev + emoji); inputRef.current?.focus(); }}
                onClose={() => setShowEmojiPicker(false)} />
            )}

            <button data-menu onClick={() => setShowEmojiPicker(v => !v)} className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-full transition', dark ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200')}>
              <Smile className="h-5 w-5" />
            </button>
            <button onClick={() => fileRef.current?.click()} className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-full transition', dark ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200')}>
              <Paperclip className="h-5 w-5" />
            </button>
            <textarea
              ref={inputRef} value={input} onChange={e => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown} placeholder={editingMsg ? 'Edit message...' : 'Type a message... (use @ to mention)'} rows={1}
              className={clsx('flex-1 resize-none rounded-2xl border px-4 py-2.5 text-sm outline-none transition max-h-32',
                dark ? 'bg-[#2a3942] border-slate-600 text-white placeholder-slate-400 focus:border-teal-500' : 'border-slate-200 bg-white focus:border-teal-400 focus:ring-1 focus:ring-teal-200')}
              style={{ minHeight: '42px' }}
            />
            {input.trim() ? (
              <button onClick={handleSend} disabled={isSending || (sendMode === 'whatsapp' && !canSendWasp)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white shadow-sm transition hover:brightness-110"
                style={{ backgroundColor: editingMsg ? '#3b82f6' : sendMode === 'whatsapp' ? '#16a34a' : WA_GREEN_TEAL }}>
                {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            ) : (
              <button onClick={() => setIsRecording(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white shadow-sm transition hover:brightness-110" style={{ backgroundColor: WA_GREEN_TEAL }}>
                <Mic className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      )}

      {previewImage && <ImagePreviewModal src={previewImage.url} alt={previewImage.name} onClose={() => setPreviewImage(null)} />}
      {forwardMsgId && <ForwardDialog onSelect={handleForward} onClose={() => setForwardMsgId(null)} dark={dark} />}
      {deleteDialog && (
        <DeleteDialog
          isMe={deleteDialog.sender_id === user.id}
          dark={dark}
          onDeleteForMe={() => { deleteForMe.mutate(deleteDialog.id); setDeleteDialog(null); }}
          onDeleteForEveryone={() => { deleteMsg.mutate(deleteDialog.id); setDeleteDialog(null); }}
          onClose={() => setDeleteDialog(null)}
        />
      )}
      {mediaPreview && <MediaPreviewDialog files={mediaPreview} onSend={handleMediaSend} onCancel={() => setMediaPreview(null)} dark={dark} />}
    </div>
  );
}

// ─── New Chat Dialog ────────────────────────────────────────────────

function NewChatDialog({ open, onClose, onSelect, dark }: { open: boolean; onClose: () => void; onSelect: (userId: string) => void; dark: boolean }) {
  const { data: contacts, isLoading } = useChatContacts();
  const [search, setSearch] = useState('');
  if (!open) return null;

  const filtered = (contacts || []).filter(c => !search || c.full_name.toLowerCase().includes(search.toLowerCase()) || c.role.includes(search.toLowerCase()));
  const grouped = filtered.reduce<Record<string, ChatContact[]>>((acc, c) => {
    const label = c.role === 'super_admin' ? 'Admins' : c.role === 'rm' ? 'RMs' : c.role === 'partner' ? 'Partners' : 'Team Members';
    (acc[label] = acc[label] || []).push(c);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={clsx('w-full max-w-md rounded-2xl shadow-2xl', dark ? 'bg-[#202c33]' : 'bg-white')} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 rounded-t-2xl text-white" style={{ background: `linear-gradient(135deg, ${WA_GREEN_DARK}, ${WA_GREEN_LIGHT})` }}>
          <h3 className="text-lg font-bold">New Conversation</h3>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search contacts..."
              className="w-full rounded-lg bg-white/15 py-2 pl-9 pr-3 text-sm text-white placeholder-white/50 outline-none focus:bg-white/25 transition" autoFocus />
          </div>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {isLoading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-teal-500" /></div>}
          {Object.entries(grouped).map(([label, list]) => (
            <div key={label}>
              <div className={clsx('sticky top-0 px-5 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b',
                dark ? 'bg-[#1a2a32] text-slate-400 border-slate-600' : 'bg-slate-50/95 text-slate-500 border-slate-100')}>{label} ({list.length})</div>
              {list.map(c => (
                <button key={c.id} onClick={() => { onSelect(c.id); onClose(); }}
                  className={clsx('flex w-full items-center gap-3 px-5 py-2.5 text-left transition group', dark ? 'hover:bg-slate-600' : 'hover:bg-teal-50')}>
                  <div className="relative"><Avatar name={c.full_name} />{c.status === 'active' && <OnlineDot />}</div>
                  <div className="min-w-0 flex-1">
                    <div className={clsx('truncate text-sm font-semibold', dark ? 'text-slate-200 group-hover:text-teal-400' : 'text-slate-800 group-hover:text-teal-700')}>{c.full_name}</div>
                    <div className="flex items-center gap-2">
                      <span className={clsx('text-xs capitalize', dark ? 'text-slate-400' : 'text-slate-500')}>{c.role.replace('_', ' ')}</span>
                      {c.status === 'active' ? <span className="text-[10px] text-emerald-500">Online</span>
                        : c.last_seen_at && <span className={clsx('text-[10px]', dark ? 'text-slate-500' : 'text-slate-400')}>{formatLastSeen(c.last_seen_at)}</span>}
                    </div>
                  </div>
                  <ChevronRight className={clsx('h-4 w-4', dark ? 'text-slate-500 group-hover:text-teal-400' : 'text-slate-300 group-hover:text-teal-500')} />
                </button>
              ))}
            </div>
          ))}
          {!isLoading && !filtered.length && <div className="px-5 py-10 text-center"><Users className={clsx('h-8 w-8 mx-auto mb-2', dark ? 'text-slate-600' : 'text-slate-300')} /><p className={clsx('text-sm', dark ? 'text-slate-400' : 'text-slate-500')}>No contacts found</p></div>}
        </div>
        <div className={clsx('border-t px-5 py-3', dark ? 'border-slate-600' : 'border-slate-100')}>
          <button onClick={onClose} className={clsx('w-full rounded-xl border py-2.5 text-sm font-medium transition', dark ? 'border-slate-600 text-slate-300 hover:bg-slate-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Broadcast Dialog ───────────────────────────────────────────────

function BroadcastDialog({ open, onClose, dark }: { open: boolean; onClose: () => void; dark: boolean }) {
  const broadcast = useSendBroadcast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  if (!open) return null;

  const handleSend = () => {
    if (!body.trim()) return;
    broadcast.mutate({ title: title.trim() || 'Broadcast', body: body.trim() }, { onSuccess: () => { setTitle(''); setBody(''); onClose(); } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={clsx('w-full max-w-md rounded-2xl shadow-2xl', dark ? 'bg-[#202c33]' : 'bg-white')} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 bg-gradient-to-r from-violet-500 to-purple-600 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-lg font-bold text-white"><Megaphone className="h-5 w-5" /> Broadcast</h3>
          <p className="text-xs text-white/70 mt-0.5">Sends to all team members</p>
        </div>
        <div className="space-y-3 p-5">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)"
            className={clsx('w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition',
              dark ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400 focus:border-violet-400' : 'border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-100')} />
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Broadcast message..." rows={4}
            className={clsx('w-full resize-none rounded-xl border px-4 py-2.5 text-sm outline-none transition',
              dark ? 'bg-slate-700 border-slate-600 text-white placeholder-slate-400 focus:border-violet-400' : 'border-slate-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-100')} autoFocus />
        </div>
        <div className={clsx('flex gap-3 border-t px-5 py-4', dark ? 'border-slate-600' : 'border-slate-100')}>
          <button onClick={onClose} className={clsx('flex-1 rounded-xl border py-2.5 text-sm font-medium transition', dark ? 'border-slate-600 text-slate-300 hover:bg-slate-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>Cancel</button>
          <button onClick={handleSend} disabled={!body.trim() || broadcast.isPending} className="flex-1 rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50 shadow-sm transition">{broadcast.isPending ? 'Sending...' : 'Send to All'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Online Users Panel ─────────────────────────────────────────────

function OnlinePanel({ dark }: { dark: boolean }) {
  const { data: contacts, isLoading } = useChatContacts();
  const online = (contacts || []).filter(c => c.status === 'active');
  const offline = (contacts || []).filter(c => c.status !== 'active');

  return (
    <div className={clsx('flex h-full flex-col border-l', dark ? 'bg-[#111b21] border-slate-700' : 'bg-white border-slate-200')}>
      <div className={clsx('shrink-0 px-4 py-3 border-b', dark ? 'border-slate-700' : 'border-slate-200')}>
        <div className="flex items-center gap-2">
          <Circle className="h-3 w-3 fill-emerald-500 text-emerald-500" />
          <span className={clsx('text-sm font-bold', dark ? 'text-slate-200' : 'text-slate-800')}>Online ({online.length})</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-slate-300" /></div>}
        {online.map(c => (
          <div key={c.id} className={clsx('flex items-center gap-2.5 px-4 py-2 transition', dark ? 'hover:bg-slate-700' : 'hover:bg-slate-50')}>
            <div className="relative"><Avatar name={c.full_name} size="sm" /><OnlineDot /></div>
            <div className="min-w-0">
              <p className={clsx('truncate text-xs font-semibold', dark ? 'text-slate-200' : 'text-slate-700')}>{c.full_name}</p>
              <p className="text-[10px] capitalize text-emerald-500">{c.role.replace('_', ' ')}</p>
            </div>
          </div>
        ))}
        {offline.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-1"><p className={clsx('text-[10px] font-bold uppercase tracking-wider', dark ? 'text-slate-500' : 'text-slate-400')}>Offline ({offline.length})</p></div>
            {offline.slice(0, 20).map(c => (
              <div key={c.id} className="flex items-center gap-2.5 px-4 py-1.5 opacity-50">
                <Avatar name={c.full_name} size="sm" />
                <div className="min-w-0">
                  <p className={clsx('truncate text-xs', dark ? 'text-slate-400' : 'text-slate-600')}>{c.full_name}</p>
                  <p className={clsx('text-[10px]', dark ? 'text-slate-500' : 'text-slate-400')}>{c.last_seen_at ? formatLastSeen(c.last_seen_at) : 'offline'}</p>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Connection Status Banner ──────────────────────────────────────

function ConnectionBanner({ dark }: { dark: boolean }) {
  const [status, setStatus] = useState<string>('disconnected');
  useEffect(() => onConnectionStatus(setStatus), []);
  if (status === 'connected' || status === 'disconnected') return null;
  return (
    <div className={clsx('shrink-0 flex items-center justify-center gap-2 py-1.5 text-xs font-medium',
      status === 'reconnecting'
        ? (dark ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-50 text-amber-700')
        : (dark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-50 text-blue-700'))}>
      <Loader2 className="h-3 w-3 animate-spin" />
      {status === 'reconnecting' ? 'Reconnecting...' : 'Connecting...'}
    </div>
  );
}

// ─── Error Boundary ────────────────────────────────────────────────

class ChatErrorBoundary extends React.Component<
  { children: React.ReactNode; dark: boolean },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; dark: boolean }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className={clsx('flex flex-col items-center justify-center h-full p-8 text-center',
          this.props.dark ? 'bg-[#0b141a] text-slate-300' : 'bg-white text-slate-700')}>
          <MessageSquare className="h-12 w-12 text-red-400 mb-4" />
          <h3 className="text-lg font-bold mb-2">Chat encountered an error</h3>
          <p className="text-sm text-slate-400 mb-4">{this.state.error?.message || 'Something went wrong'}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition">
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function ChatPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const { dark, toggle: toggleDark } = useDarkMode();
  useSocketConnection();
  const { data: conversations = [], isLoading, refetch: refetchConversations } = useChatConversations();
  const createConv = useCreateConversation();
  const leadId = searchParams.get('leadId');
  const leadThread = useLeadThread(leadId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const convId = params.get('conv');
    if (convId && !selectedId) setSelectedId(convId);
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!leadThread.data?.conversationId) return;
    setSelectedId(leadThread.data.conversationId);
    refetchConversations();
  }, [leadThread.data?.conversationId, refetchConversations]);

  const selectedConv = useMemo(() => {
    const found = conversations.find(c => c.id === selectedId);
    if (found || !leadThread.data || selectedId !== leadThread.data.conversationId) return found;
    return {
      id: leadThread.data.conversationId,
      type: 'lead',
      title: leadThread.data.lead?.full_name ? `Lead: ${leadThread.data.lead.full_name}` : 'Lead Discussion',
      lead_id: leadId,
      is_pinned: false,
      is_archived: false,
      is_muted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_message: null,
      last_message_type: null,
      last_sender_id: null,
      last_sender_name: null,
      last_message_at: null,
      unread_count: 0,
      lead: leadThread.data.lead || null,
      channel: leadThread.data.conversation?.channel,
      provider: leadThread.data.conversation?.provider,
      session: leadThread.data.conversation?.session,
      can_send_whatsapp: leadThread.data.conversation?.can_send_whatsapp,
      disabled_reason: leadThread.data.conversation?.disabled_reason,
      session_status: leadThread.data.conversation?.session_status,
      session_expires_at: leadThread.data.conversation?.session_expires_at,
      is_external_unknown: leadThread.data.conversation?.is_external_unknown,
    } as ChatConversation;
  }, [conversations, leadId, leadThread.data, selectedId]);

  const handleNewChat = async (targetUserId: string) => {
    if (user?.role === 'member' || user?.role === 'partner') {
      toast.error('Members and partners can start chat only from an assigned lead.');
      return;
    }
    const result = await createConv.mutateAsync({ type: 'direct', target_user_id: targetUserId });
    setSelectedId(result.id);
  };

  if (!user) return null;

  return (
    <AppShell title="Messages" roles={['super_admin', 'rm', 'member', 'partner']}>
      <ChatErrorBoundary dark={dark}>
        <ConnectionBanner dark={dark} />
        <div className={clsx('flex overflow-hidden rounded-xl border shadow-card', dark ? 'border-slate-700' : 'border-slate-200')} style={{ height: 'calc(100vh - 7rem)' }}>
          {/* Left - Conversations */}
          <div className={clsx('w-full sm:w-[320px] md:w-[360px] shrink-0 border-r',
            dark ? 'bg-[#111b21] border-slate-700' : 'bg-white border-slate-200',
            selectedId ? 'hidden sm:flex sm:flex-col' : 'flex flex-col')}>
            <ConversationList conversations={conversations} selected={selectedId} onSelect={setSelectedId}
              onNewChat={() => user.role === 'member' || user.role === 'partner' ? toast('Members and partners can start chat only from an assigned lead.') : setShowNew(true)} onBroadcast={() => setShowBroadcast(true)}
              user={{ id: user.id, role: user.role, name: user.name }} loading={isLoading} dark={dark} />
          </div>

          {/* Center - Messages */}
          <div className={clsx('flex-1 min-w-0 flex flex-col', !selectedId ? 'hidden sm:flex' : 'flex')}>
            {leadThread.isError && !selectedId ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center" style={{ backgroundColor: dark ? WA_DARK_CHAT : WA_CHAT_BG }}>
                <MessageSquare className="mb-3 h-10 w-10 text-rose-400" />
                <h3 className={clsx('text-lg font-bold', dark ? 'text-slate-200' : 'text-slate-700')}>Could not open lead conversation.</h3>
                <p className={clsx('mt-2 max-w-sm text-sm', dark ? 'text-slate-400' : 'text-slate-500')}>
                  {chatErrorText(leadThread.error)}
                </p>
              </div>
            ) : selectedId ? (
              <MessageThread key={selectedId} conversationId={selectedId} conversation={selectedConv}
                user={{ id: user.id, name: user.name, role: user.role }} dark={dark} onBack={() => setSelectedId(null)} onToggleDark={toggleDark} />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center px-6" style={{ backgroundColor: dark ? WA_DARK_CHAT : WA_CHAT_BG }}>
                <div className={clsx('grid h-20 w-20 place-items-center rounded-full shadow-md mb-4', dark ? 'bg-[#202c33]' : 'bg-white')}>
                  <MessageSquare className="h-10 w-10" style={{ color: WA_GREEN_LIGHT }} />
                </div>
                <h3 className={clsx('text-xl font-bold', dark ? 'text-slate-200' : 'text-slate-700')}>Digital AdBird Chat</h3>
                <p className={clsx('text-sm mt-2 max-w-sm', dark ? 'text-slate-400' : 'text-slate-400')}>Send and receive messages with your team in real-time. Select a conversation or start a new chat.</p>
                <div className="flex items-center gap-3 mt-4">
                  {user.role !== 'member' && user.role !== 'partner' && <button onClick={() => setShowNew(true)} className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:brightness-110 transition" style={{ backgroundColor: WA_GREEN_TEAL }}>
                    <Plus className="h-4 w-4" /> Start New Chat
                  </button>}
                  <button onClick={toggleDark} className={clsx('grid h-10 w-10 place-items-center rounded-xl border transition', dark ? 'border-slate-600 text-slate-300 hover:bg-slate-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')} title="Toggle dark mode">
                    {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right - Online panel */}
          <div className="hidden xl:flex xl:w-56 xl:flex-col">
            <OnlinePanel dark={dark} />
          </div>
        </div>

        <NewChatDialog open={showNew} onClose={() => setShowNew(false)} onSelect={handleNewChat} dark={dark} />
        <BroadcastDialog open={showBroadcast} onClose={() => setShowBroadcast(false)} dark={dark} />
      </ChatErrorBoundary>
    </AppShell>
  );
}
