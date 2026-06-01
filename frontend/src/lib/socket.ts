'use client';

import type { Socket } from 'socket.io-client';
import { tokens } from './api';

let socket: Socket | null = null;
let ioModule: typeof import('socket.io-client') | null = null;
let connectPromise: Promise<Socket> | null = null;

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
let currentStatus: ConnectionStatus = 'disconnected';
const statusListeners = new Set<(status: ConnectionStatus) => void>();

function setStatus(s: ConnectionStatus) {
  currentStatus = s;
  statusListeners.forEach(fn => fn(s));
}

export function onConnectionStatus(fn: (status: ConnectionStatus) => void): () => void {
  statusListeners.add(fn);
  fn(currentStatus);
  return () => { statusListeners.delete(fn); };
}

async function loadIO() {
  if (!ioModule) {
    ioModule = await import('socket.io-client');
  }
  return ioModule;
}

function getWSUrl() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  if (apiUrl && apiUrl !== '/api') return apiUrl.replace('/api', '');
  if (typeof window !== 'undefined') {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (wsUrl) return wsUrl;
    return window.location.origin;
  }
  return '';
}

export function getSocket(): Socket | null {
  return socket;
}

export async function connectSocket(): Promise<Socket> {
  if (socket?.connected) return socket;

  if (connectPromise) return connectPromise;

  setStatus('connecting');

  connectPromise = (async () => {
    const tokenStr = tokens.access;
    if (!tokenStr) {
      setStatus('disconnected');
      throw new Error('No auth token');
    }

    if (socket) {
      try { socket.disconnect(); } catch {}
      socket = null;
    }

    const { io } = await loadIO();

    const s = io(getWSUrl(), {
      auth: { token: tokenStr },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,
      timeout: 10000,
    });

    s.on('connect', () => {
      setStatus('connected');
    });

    s.on('disconnect', (reason) => {
      setStatus(reason === 'io server disconnect' ? 'disconnected' : 'reconnecting');
      if (reason === 'io server disconnect') {
        setTimeout(() => {
          connectPromise = null;
          connectSocket().catch(() => {});
        }, 2000);
      }
    });

    s.io.on('reconnect_attempt', () => {
      setStatus('reconnecting');
    });

    s.io.on('reconnect', () => {
      setStatus('connected');
    });

    s.on('connect_error', (err) => {
      if (err.message === 'AUTH_FAILED' || err.message === 'AUTH_REQUIRED') {
        const freshToken = tokens.access;
        if (freshToken && s) {
          (s as any).auth = { token: freshToken };
        }
      }
    });

    socket = s;
    return s;
  })().catch((err) => {
    connectPromise = null;
    setStatus('disconnected');
    throw err;
  });

  connectPromise.then(() => {
    // Keep connectPromise set so concurrent callers share the same socket.
    // Only clear it on disconnect or error.
  });

  return connectPromise;
}

export function disconnectSocket() {
  connectPromise = null;
  setStatus('disconnected');
  if (socket) {
    try { socket.disconnect(); } catch {}
    socket = null;
  }
}

export function joinConversation(conversationId: string) {
  try { socket?.emit('join:conversation', conversationId); } catch {}
}

export function leaveConversation(conversationId: string) {
  try { socket?.emit('leave:conversation', conversationId); } catch {}
}

export function emitTyping(conversationId: string) {
  try { socket?.emit('typing', { conversationId }); } catch {}
}

export function emitStopTyping(conversationId: string) {
  try { socket?.emit('stop:typing', { conversationId }); } catch {}
}
