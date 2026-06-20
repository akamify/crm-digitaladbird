'use client';
import { useCallback, useRef, useState } from 'react';

export function useNewMessageSound(defaultEnabled = true) {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const played = useRef<Set<string>>(new Set());

  const play = useCallback((messageId?: string | null) => {
    if (!enabled) return;
    const key = messageId || `msg-${Date.now()}`;
    if (played.current.has(key)) return;
    played.current.add(key);
    try {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = new AudioContextCtor();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.value = 0.035;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.12);
      window.setTimeout(() => ctx.close().catch(() => {}), 250);
    } catch {
      // Browser may block audio before user interaction.
    }
  }, [enabled]);

  return { enabled, setEnabled, play };
}

