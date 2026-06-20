'use client';

export function buildTelHref(phone?: string | null) {
  const raw = String(phone || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^+\d]/g, '');
  return cleaned ? `tel:${cleaned}` : null;
}

export function triggerPhoneCall(phone?: string | null) {
  const href = buildTelHref(phone);
  if (!href || typeof window === 'undefined' || typeof document === 'undefined') return false;
  const link = document.createElement('a');
  link.href = href;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}
