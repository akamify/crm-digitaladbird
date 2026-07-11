'use client';

import Link from 'next/link';
import { Plus, Tag } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Skeleton } from '@/components/ui/Modal';
import { CreateLabelModal } from '@/components/leads/LeadLabelsCard';
import { useLabels } from '@/hooks/useLeadLabels';
import { useState } from 'react';

export default function LabelsPage() {
  return <AppShell title="Labels" subtitle="Create labels and open the leads assigned to each label" roles={['super_admin', 'admin']}><LabelsInner /></AppShell>;
}

function LabelsInner() {
  const [createOpen, setCreateOpen] = useState(false);
  const labels = useLabels();
  return <div className="space-y-5"><div className="flex justify-end"><button type="button" onClick={() => setCreateOpen(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"><Plus className="h-4 w-4" /> Create Label</button></div>{labels.isLoading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-28" />)}</div> : labels.isError ? <EmptyState title="Could not load labels" description="Refresh the page to retry." /> : labels.data?.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{labels.data.map(label => <Link key={label.id} href={`/leads?label_id=${encodeURIComponent(label.id)}`} className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"><div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: label.color }} /><span className="min-w-0 truncate font-semibold text-slate-900">{label.name}</span></div><div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>{label.visibility === 'global' ? 'Global label' : `Custom by ${label.created_by_name || 'user'}`}</span><span>{label.lead_count || 0} leads</span></div></Link>)}</div> : <EmptyState title="No labels created" description="Create a label to organize leads." icon={<Tag className="h-6 w-6" />} />}<CreateLabelModal open={createOpen} onClose={() => setCreateOpen(false)} /></div>;
}
