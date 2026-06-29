'use client';
import { ReactNode, useEffect } from 'react';
import { Loader2, X } from 'lucide-react';
import { clsx, callStatusChip, humanize } from '@/lib/format';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClass = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[1000] flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4"
    >
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx(
        'relative w-full rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl',
        'flex max-h-[92dvh] flex-col sm:max-h-[calc(100dvh-2rem)]',
        sizeClass[size],
      )}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 sm:px-5 py-3 sm:py-4 shrink-0">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-base font-semibold text-slate-900 truncate">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 shrink-0" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && <div className="border-t border-slate-100 px-4 sm:px-5 py-3 flex flex-col sm:flex-row justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-brand-600', className)} />;
}

export function PageLoader() {
  return <div className="flex h-64 items-center justify-center"><Spinner className="h-6 w-6" /></div>;
}

export function EmptyState({
  title, description, action, icon,
}: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {description && <p className="mt-1 max-w-md text-xs text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-slate-200/60', className)} />;
}

export function StatusChip({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="chip-slate">—</span>;
  const cls = callStatusChip[status] || 'chip-slate';
  return <span className={cls}>{humanize(status)}</span>;
}
