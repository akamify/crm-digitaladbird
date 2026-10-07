'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Skeleton } from '@/components/ui/Modal';

interface LeadCosts {
  total_leads: number; missing_cost_leads: number;
  groups: Array<{currency: string; priced_leads: number; average_cpl: number; allocated_cost: number; campaign_spend?: number; oldest_sync: string}>;
}
export function LeadCostCard() {
  const { user } = useAuth();
  const allowed = Boolean(user && ['super_admin','rm','member','partner'].includes(user.role));
  const query = useQuery({queryKey: ['reports','lead-costs',user?.id], enabled: allowed,
    queryFn: ({signal}) => apiGet<LeadCosts>('/reports/lead-costs', undefined, {signal}), staleTime: 60000, retry: false});
  if (!allowed) return null;
  const money = (amount: number, currency: string) => new Intl.NumberFormat('en-IN', {style:'currency',currency,maximumFractionDigits:2}).format(amount);
  return <section className="card-padded" aria-label="Lead cost analytics">
    <h2 className="text-sm font-semibold text-slate-900">{user?.role === 'rm' ? 'Team lead cost' : user?.role === 'super_admin' ? 'CRM lead cost' : 'Your lead cost'}</h2>
    <p className="mt-1 text-xs text-slate-500">All time · Current ownership · Latest synced Meta campaign CPL</p>
    {query.isLoading && <Skeleton className="mt-3 h-24" />}
    {query.isError && <p role="alert" className="mt-3 text-sm text-rose-700">Cost data could not be loaded. <button className="underline" onClick={() => void query.refetch()}>Retry</button></p>}
    {query.data && <>
      <p className="mt-3 text-sm text-slate-700">Total leads: <strong>{query.data.total_leads.toLocaleString()}</strong></p>
      {query.data.groups.map(group => <div key={group.currency} className="mt-3 rounded-xl border border-slate-200 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><p className="text-xs text-slate-500">Leads with cost · {group.currency}</p><strong className="text-xl">{group.priced_leads.toLocaleString()}</strong></div>
          <div><p className="text-xs text-slate-500">Average cost per lead</p><strong className="text-xl">{money(group.average_cpl,group.currency)}</strong></div>
          <div><p className="text-xs text-slate-500">Allocated lead cost</p><strong className="text-xl">{money(group.allocated_cost,group.currency)}</strong></div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Calculated per campaign: assigned leads × campaign CPL. Oldest metrics sync: {new Date(group.oldest_sync).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'})} IST.</p>
        {group.campaign_spend !== undefined && <p className="mt-2 text-xs text-slate-600">Meta spend for included priced campaigns: {money(group.campaign_spend,group.currency)}. Campaign spend can differ from allocated CRM cost.</p>}
      </div>)}
      {query.data.missing_cost_leads > 0 && <p className="mt-3 text-xs text-amber-800">{query.data.missing_cost_leads.toLocaleString()} leads have no usable synced campaign CPL/currency and are excluded from cost totals.</p>}
      {!query.data.groups.length && <p className="mt-3 text-sm text-slate-500">{query.data.total_leads ? 'Meta cost data unavailable. Sync campaign metrics in Meta settings.' : 'No leads in this scope.'}</p>}
    </>}
  </section>;
}
