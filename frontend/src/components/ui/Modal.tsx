'use client';

import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
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

const sizeClass = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-5xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'app-modal-title' : undefined}
      aria-describedby={description ? 'app-modal-description' : undefined}
      className="fixed inset-0 z-[9999] flex items-end justify-center overflow-y-auto px-3 py-4 sm:items-center sm:px-5 sm:py-8"
    >
      <button
        type="button"
        aria-label="Close modal backdrop"
        className="fixed inset-0 cursor-default bg-slate-950/55 backdrop-blur-[3px] transition-opacity"
        onClick={onClose}
      />

      <div
        className={clsx(
          'relative flex w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)] ring-1 ring-slate-900/5 sm:rounded-3xl',
          'max-h-[92dvh] sm:max-h-[calc(100dvh-4rem)]',
          'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-200 sm:slide-in-from-bottom-0',
          sizeClass[size],
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || description) && (
          <div className="shrink-0 border-b border-slate-100 bg-white px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {title && (
                  <h2
                    id="app-modal-title"
                    className="truncate text-base font-semibold tracking-tight text-slate-950 sm:text-lg"
                  >
                    {title}
                  </h2>
                )}

                {description && (
                  <p
                    id="app-modal-description"
                    className="mt-1 line-clamp-2 text-sm leading-5 text-slate-500"
                  >
                    {description}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {!title && !description && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-slate-100 bg-slate-50/80 px-5 py-4 sm:px-6">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              {footer}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;

  return createPortal(modal, document.body);
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-brand-600', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm">
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-50 text-slate-400">
          {icon}
        </div>
      )}

      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>

      {description && (
        <p className="mt-1.5 max-w-md text-sm leading-5 text-slate-500">
          {description}
        </p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton-shimmer rounded-lg bg-slate-200/70', className)} />;
}

export function StatusChip({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="chip-slate">—</span>;

  const cls = callStatusChip[status] || 'chip-slate';

  return <span className={cls}>{humanize(status)}</span>;
}
