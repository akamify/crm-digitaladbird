'use client';

import { Phone, MessageCircle } from 'lucide-react';
import { clsx } from '@/lib/format';
import { buildTelHref, triggerPhoneCall } from '@/lib/phone';

type Size = 'xs' | 'sm';

interface Props {
  phone?: string | null;
  size?: Size;
  compact?: boolean;
  onCall?: () => void | Promise<unknown>;
  onChat?: () => void;
}

export function LeadActions({ phone, size = 'xs', compact = false, onCall, onChat }: Props) {
  const telHref = buildTelHref(phone);
  const cls = size === 'sm' ? 'px-2 py-1.5 text-xs' : 'px-1.5 py-1 text-[11px]';
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-3 w-3';

  async function handleCall() {
    if (!telHref) return;
    triggerPhoneCall(phone);
    await onCall?.();
  }

  return (
    <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {telHref ? (
        <a
          href={telHref}
          title={`Call ${phone}`}
          onClick={(e) => { e.stopPropagation(); void handleCall(); }}
          className={clsx('inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 font-medium text-blue-700 hover:bg-blue-100 transition', cls)}
        >
          <Phone className={icon} />{!compact && 'Call'}
        </a>
      ) : (
        <span title={phone ? 'Open lead communication to call' : 'No phone'} className={clsx('inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed', cls)}>
          <Phone className={icon} />{!compact && 'Call'}
        </span>
      )}

      {onChat ? (
        <button
          type="button"
          title="Open CRM chat"
          onClick={(e) => { e.stopPropagation(); onChat(); }}
          className={clsx('inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 font-medium text-emerald-700 hover:bg-emerald-100 transition', cls)}
        >
          <MessageCircle className={icon} />{!compact && 'Chat'}
        </button>
      ) : (
        <span title="Open lead communication to chat" className={clsx('inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed', cls)}>
          <MessageCircle className={icon} />{!compact && 'Chat'}
        </span>
      )}
    </div>
  );
}
