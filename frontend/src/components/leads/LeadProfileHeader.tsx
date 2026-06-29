'use client';

import { ArrowLeft, MapPin, Phone } from 'lucide-react';
import Link from 'next/link';
import type { LeadDetail } from '@/types';
import { LeadCategoryBadge } from './LeadCategoryBadge';
import { fmtPhone, humanize } from '@/lib/format';
import { getStatusBadgeVariant, isMeaningfulValue } from './leadProfileUtils';

interface Props {
  lead: LeadDetail;
  actions: React.ReactNode;
}

export function LeadProfileHeader({ lead, actions }: Props) {
  const location = [lead.city, lead.state].filter(isMeaningfulValue).join(', ');
  return (
    <header className="sticky top-0 z-20 -mx-3 border-b border-slate-200 bg-white/95 px-3 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border lg:static lg:px-5 lg:py-4">
      <Link href="/leads" className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to leads
      </Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-semibold text-slate-950 sm:text-2xl">{lead.full_name || 'Unnamed lead'}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1.5 tabular-nums"><Phone className="h-3.5 w-3.5" />{fmtPhone(lead.phone)}</span>
            {location && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{location}</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={getStatusBadgeVariant(lead.stage)}>{humanize(lead.stage)}</span>
            <span className={getStatusBadgeVariant(lead.call_status)}>{humanize(lead.call_status)}</span>
            <LeadCategoryBadge category={lead.category} />
            {isMeaningfulValue(lead.source) && <span className="chip-slate">{humanize(lead.source)}</span>}
          </div>
        </div>
        <div className="hidden min-w-0 max-w-[60%] flex-wrap items-center justify-end gap-2 lg:flex">{actions}</div>
      </div>
    </header>
  );
}
