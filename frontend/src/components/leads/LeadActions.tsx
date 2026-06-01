'use client';
/**
 * Three universal quick-action buttons on every lead row: Call, WhatsApp, Email.
 *
 * They use plain platform deep-links (`tel:`, `https://wa.me/`, `mailto:`) so
 * nothing breaks if the phone/email is missing — the corresponding button is
 * simply rendered as a disabled stub. All three buttons stop click propagation
 * so embedding them inside a clickable row (e.g. <Link>) still works without
 * the action accidentally navigating away.
 *
 * Used by:
 *   - /leads list page
 *   - /leads/[id] detail page
 *   - /dashboard/admin/leads-manager
 *   - Admin Fresh Leads tab
 *   - Member / RM lead lists
 */
import { Phone, MessageCircle, Mail } from 'lucide-react';
import { clsx } from '@/lib/format';

type Size = 'xs' | 'sm';

interface Props {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  /** A short prefilled WhatsApp message — defaults to "Hi <name>" if name set. */
  waMessage?: string;
  size?: Size;
  /** If you want to hide labels on space-tight rows, pass `compact`. */
  compact?: boolean;
}

function digitsOnly(s: string): string {
  return String(s || '').replace(/[^\d+]/g, '');
}

function phoneForCall(p?: string | null): string | null {
  if (!p) return null;
  const d = digitsOnly(p);
  // tel: should retain the leading + for international dialing
  return d || null;
}

function phoneForWa(p?: string | null): string | null {
  if (!p) return null;
  // wa.me ONLY accepts digits, no `+` or spaces. India default if no country code.
  let d = digitsOnly(p).replace(/^\+/, '');
  if (!d) return null;
  if (d.length === 10) d = '91' + d;
  return d;
}

export function LeadActions({ phone, email, name, waMessage, size = 'xs', compact = false }: Props) {
  const tel  = phoneForCall(phone);
  const wa   = phoneForWa(phone);
  const text = (waMessage || (name ? `Hi ${name},` : 'Hi,')).trim();
  const waUrl = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : null;
  const mailto = email ? `mailto:${email}` : null;

  const cls = size === 'sm'
    ? 'px-2 py-1.5 text-xs'
    : 'px-1.5 py-1 text-[11px]';
  const icon = size === 'sm' ? 'h-3.5 w-3.5' : 'h-3 w-3';

  return (
    <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {tel ? (
        <a href={`tel:${tel}`} title={`Call ${phone}`}
          onClick={(e) => e.stopPropagation()}
          className={clsx('inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 font-medium text-blue-700 hover:bg-blue-100 transition', cls)}>
          <Phone className={icon} />{!compact && 'Call'}
        </a>
      ) : (
        <span title="No phone" className={clsx('inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed', cls)}>
          <Phone className={icon} />{!compact && 'Call'}
        </span>
      )}

      {waUrl ? (
        <a href={waUrl} target="_blank" rel="noopener noreferrer" title={`WhatsApp ${phone}`}
          onClick={(e) => e.stopPropagation()}
          className={clsx('inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 font-medium text-emerald-700 hover:bg-emerald-100 transition', cls)}>
          <MessageCircle className={icon} />{!compact && 'WhatsApp'}
        </a>
      ) : (
        <span title="No phone" className={clsx('inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed', cls)}>
          <MessageCircle className={icon} />{!compact && 'WhatsApp'}
        </span>
      )}

      {mailto ? (
        <a href={mailto} title={`Email ${email}`}
          onClick={(e) => e.stopPropagation()}
          className={clsx('inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 font-medium text-violet-700 hover:bg-violet-100 transition', cls)}>
          <Mail className={icon} />{!compact && 'Email'}
        </a>
      ) : (
        <span title="No email" className={clsx('inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed', cls)}>
          <Mail className={icon} />{!compact && 'Email'}
        </span>
      )}
    </div>
  );
}
