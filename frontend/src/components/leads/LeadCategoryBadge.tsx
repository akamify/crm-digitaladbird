import { clsx } from '@/lib/format';
import type { LeadCategory } from '@/types';

export const LEAD_CATEGORY_LABELS: Record<LeadCategory, string> = {
  trader: 'Trader Lead',
  partner: 'Partner Lead',
  unknown: 'Needs Categorisation',
};

export function LeadCategoryBadge({ category, className }: { category?: LeadCategory | null; className?: string }) {
  const value: LeadCategory = category === 'trader' || category === 'partner' ? category : 'unknown';
  return (
    <span className={clsx(
      'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold',
      value === 'trader' && 'bg-emerald-100 text-emerald-700',
      value === 'partner' && 'bg-blue-100 text-blue-700',
      value === 'unknown' && 'bg-amber-100 text-amber-700',
      className,
    )}>
      {LEAD_CATEGORY_LABELS[value]}
    </span>
  );
}
