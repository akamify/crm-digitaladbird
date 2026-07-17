'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Eye, Loader2, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Modal, Skeleton, EmptyState } from '@/components/ui/Modal';
import {
  useClients,
  useClientDetail,
  useClientStatusAction,
  useCreateClient,
  useDeleteClient,
  useResetClientPassword,
  useUpdateClient,
  type ClientAccount,
  type ClientInput,
} from '@/hooks/useClients';
import { clsx, humanize } from '@/lib/format';
import { formatISTCompact } from '@/lib/date';

export default function AdminClientsPage() {
  return (
    <AppShell title="Client Management" subtitle="Create clients and review their owned Meta assets, leads, and support history" roles={['super_admin', 'admin']}>
      <ClientsInner />
    </AppShell>
  );
}

function ClientsInner() {
  const [filters, setFilters] = useState({ search: '', status: 'all', sort: 'created_at', order: 'desc', page: 1, page_size: 20 });
  const [formClient, setFormClient] = useState<ClientAccount | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteClient, setDeleteClient] = useState<ClientAccount | null>(null);

  const clients = useClients(filters);
  const statusAction = useClientStatusAction();
  const resetPassword = useResetClientPassword();
  const deleteMutation = useDeleteClient();

  const rows = clients.data?.rows || [];
  const pagination = clients.data?.pagination || { page: 1, page_size: 20, total: 0 };
  const pages = Math.max(1, Math.ceil((pagination.total || 0) / pagination.page_size));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-10"
              placeholder="Search name, email, phone, user ID"
              value={filters.search}
              onChange={event => setFilters(current => ({ ...current, search: event.target.value, page: 1 }))}
            />
          </div>
          <select className="input w-36" value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value, page: 1 }))}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="blocked">Blocked</option>
          </select>
          <select className="input w-40" value={filters.sort} onChange={event => setFilters(current => ({ ...current, sort: event.target.value }))}>
            <option value="created_at">Newest</option>
            <option value="full_name">Name</option>
            <option value="status">Status</option>
            <option value="last_login_at">Last login</option>
          </select>
          <button type="button" className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm" onClick={() => clients.refetch()} disabled={clients.isFetching}>
            <RefreshCw className={clsx('h-4 w-4', clients.isFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm" onClick={() => { setFormClient(null); setFormOpen(true); }}>
          <Plus className="h-4 w-4" />
          Create Client
        </button>
      </div>

      {clients.isLoading ? (
        <Skeleton className="h-72" />
      ) : clients.isError ? (
        <EmptyState title="Could not load clients" action={<button className="btn-outline rounded-lg px-3 py-2 text-sm" onClick={() => clients.refetch()}>Retry</button>} />
      ) : rows.length === 0 ? (
        <EmptyState title="No clients found" description="Create a client to give business-only access." />
      ) : (
        <div className="card-padded overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-3">Client</th>
                <th className="py-2 pr-3">User ID</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Meta Assets</th>
                <th className="py-2 pr-3">Leads</th>
                <th className="py-2 pr-3">Support</th>
                <th className="py-2 pr-3">Last Login</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(client => (
                <tr key={client.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetailId(client.id)}>
                  <td className="py-3 pr-3">
                    <div className="font-medium text-slate-950">{client.full_name}</div>
                    <div className="text-xs text-slate-500">{client.email} - {client.phone || 'No phone'}</div>
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs text-slate-600">{client.user_id}</td>
                  <td className="py-3 pr-3"><ClientStatusChip status={client.status} /></td>
                  <td className="py-3 pr-3 text-xs text-slate-600">{client.pages_count} pages - {client.ad_accounts_count} accounts - {client.campaigns_count} campaigns</td>
                  <td className="py-3 pr-3 tabular-nums">{client.leads_count}</td>
                  <td className="py-3 pr-3 tabular-nums">{client.open_support_tickets} open</td>
                  <td className="py-3 pr-3 text-xs text-slate-500">{client.last_login_at ? formatISTCompact(client.last_login_at) : 'Never'}</td>
                  <td className="py-3 text-right" onClick={event => event.stopPropagation()}>
                    <div className="flex flex-wrap justify-end gap-1">
                      <button className="btn-outline rounded-lg px-2.5 py-1.5 text-xs" onClick={() => setDetailId(client.id)}><Eye className="mr-1 inline h-3.5 w-3.5" />View</button>
                      <button className="btn-outline rounded-lg px-2.5 py-1.5 text-xs" onClick={() => { setFormClient(client); setFormOpen(true); }}>Edit</button>
                      <button className="btn-outline rounded-lg px-2.5 py-1.5 text-xs" onClick={() => statusAction.mutate({ clientId: client.id, active: client.status !== 'active' }, { onSuccess: () => toast.success(client.status === 'active' ? 'Client deactivated' : 'Client activated'), onError: errorToast })}>
                        {client.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className="btn-outline rounded-lg px-2.5 py-1.5 text-xs" onClick={() => resetPassword.mutate(client.id, { onSuccess: () => toast.success('Reset link sent'), onError: errorToast })}>Reset</button>
                      <button className="btn-outline rounded-lg px-2.5 py-1.5 text-xs text-rose-600" onClick={() => setDeleteClient(client)}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{pagination.total} clients</span>
        <div className="flex gap-2">
          <button className="btn-outline rounded-lg px-3 py-1.5 text-xs" disabled={filters.page <= 1} onClick={() => setFilters(current => ({ ...current, page: current.page - 1 }))}>Previous</button>
          <span className="px-2 py-1.5 text-xs">Page {filters.page} of {pages}</span>
          <button className="btn-outline rounded-lg px-3 py-1.5 text-xs" disabled={filters.page >= pages} onClick={() => setFilters(current => ({ ...current, page: current.page + 1 }))}>Next</button>
        </div>
      </div>

      <ClientFormModal open={formOpen} client={formClient} onClose={() => setFormOpen(false)} />
      <ClientDetailModal clientId={detailId} onClose={() => setDetailId(null)} />
      <Modal open={Boolean(deleteClient)} onClose={() => setDeleteClient(null)} title="Delete client?" size="sm">
        <p className="text-sm text-slate-600">This soft-deletes the client login. Owned data remains stored for audit.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost rounded-lg px-4 py-2 text-sm" onClick={() => setDeleteClient(null)}>Cancel</button>
          <button
            className="btn-primary rounded-lg bg-rose-600 px-4 py-2 text-sm hover:bg-rose-700"
            disabled={deleteMutation.isPending}
            onClick={() => deleteClient && deleteMutation.mutate(deleteClient.id, { onSuccess: () => { toast.success('Client deleted'); setDeleteClient(null); }, onError: errorToast })}
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}

function ClientFormModal({ open, client, onClose }: { open: boolean; client: ClientAccount | null; onClose: () => void }) {
  const create = useCreateClient();
  const update = useUpdateClient();
  const [form, setForm] = useState<ClientInput>({});

  useEffect(() => {
    setForm(client ? {
      full_name: client.full_name,
      email: client.email,
      phone: client.phone || '',
      user_id: client.user_id,
      active: client.status === 'active',
    } : { full_name: '', email: '', phone: '', active: true });
  }, [client, open]);

  function submit() {
    const payload = { ...form, name: form.full_name };
    if (client) {
      update.mutate({ ...payload, clientId: client.id }, {
        onSuccess: () => { toast.success('Client updated'); onClose(); },
        onError: errorToast,
      });
      return;
    }
    create.mutate(payload, {
      onSuccess: (created) => {
        toast.success(created.email_warning || 'Client created. Onboarding reset link sent.');
        onClose();
      },
      onError: errorToast,
    });
  }

  const pending = create.isPending || update.isPending;
  return (
    <Modal open={open} onClose={onClose} title={client ? 'Edit Client' : 'Create Client'} description="Clients use the existing login page. User ID is generated automatically and a password setup link is emailed." size="lg">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" value={form.full_name || ''} onChange={value => setForm(current => ({ ...current, full_name: value }))} />
        <Field label="Email" type="email" value={form.email || ''} onChange={value => setForm(current => ({ ...current, email: value }))} />
        <Field label="Phone" value={form.phone || ''} onChange={value => setForm(current => ({ ...current, phone: value }))} />
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <input type="checkbox" checked={form.active !== false} onChange={event => setForm(current => ({ ...current, active: event.target.checked }))} />
          Active
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost rounded-lg px-4 py-2 text-sm" onClick={onClose}>Cancel</button>
        <button className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm" disabled={pending} onClick={submit}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save Client
        </button>
      </div>
    </Modal>
  );
}

function ClientDetailModal({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const detail = useClientDetail(clientId);
  const data = detail.data;
  return (
    <Modal open={Boolean(clientId)} onClose={onClose} title="Client Profile" size="xl">
      {detail.isLoading ? <Skeleton className="h-80" /> : !data ? <EmptyState title="Client not found" /> : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Info label="Name" value={data.client.full_name} />
            <Info label="Email" value={data.client.email} />
            <Info label="User ID" value={data.client.user_id} />
            <Info label="Status" value={humanize(data.client.status)} />
          </div>
          <Section title="Meta Configuration">
            <SummaryLine label="Pages" value={data.meta.pages.length} />
            <SummaryLine label="Ad accounts" value={data.meta.ad_accounts.length} />
            <SummaryLine label="Campaigns" value={data.meta.campaigns.length} />
          </Section>
          <Section title="Campaigns">
            <CompactList rows={data.meta.campaigns.slice(0, 8)} primary="campaign_name" secondary="effective_status" empty="No campaigns mapped to this client." />
          </Section>
          <Section title="Leads Summary">
            <CompactList rows={data.leads_summary.recent} primary="full_name" secondary="campaign_name" empty="No client leads yet." />
          </Section>
          <Section title="Support History">
            <CompactList rows={data.support_history} primary="ticket_no" secondary="status" empty="No support tickets yet." />
          </Section>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="space-y-1.5 text-sm"><span className="label">{label}</span><input className="input" type={type} value={value} onChange={event => onChange(event.target.value)} /></label>;
}

function Info({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 truncate text-sm font-semibold text-slate-900">{value || 'Not available'}</div></div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-xl border border-slate-200 p-4"><h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>{children}</section>;
}

function SummaryLine({ label, value }: { label: string; value: number }) {
  return <div className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span>{label}</span><strong>{value}</strong></div>;
}

function CompactList({ rows, primary, secondary, empty }: { rows: Array<Record<string, unknown>>; primary: string; secondary: string; empty: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return <div className="divide-y divide-slate-100">{rows.map((row, index) => <div key={`${primary}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="truncate font-medium text-slate-800">{String(row[primary] || 'Not named')}</span><span className="chip-slate shrink-0">{humanize(String(row[secondary] || 'unknown'))}</span></div>)}</div>;
}

function ClientStatusChip({ status }: { status: string }) {
  return <span className={status === 'active' ? 'chip-green' : status === 'blocked' ? 'chip-red' : 'chip-amber'}>{humanize(status || 'unknown')}</span>;
}

function errorToast(error: unknown) {
  const message = (error as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response?.data?.error?.message
    || (error as { response?: { data?: { message?: string } } })?.response?.data?.message
    || 'Action failed';
  toast.error(message);
}
