'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Pencil, Plus, Power, RefreshCw, Search, Trash2 } from 'lucide-react';
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
  const router = useRouter();
  const [filters, setFilters] = useState({ search: '', status: 'all', sort: 'created_at', order: 'desc', page: 1, page_size: 20 });
  const [formClient, setFormClient] = useState<ClientAccount | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const clients = useClients(filters);

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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(client => (
                <tr key={client.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/dashboard/admin/clients/${client.id}`)}>
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
  const statusAction = useClientStatusAction();
  const resetPassword = useResetClientPassword();
  const deleteMutation = useDeleteClient();
  const data = detail.data;
  const [editOpen, setEditOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'reset' | 'status' | 'delete' | null>(null);

  const client = data?.client || null;
  const nextActiveState = client?.status !== 'active';
  const actionPending = statusAction.isPending || resetPassword.isPending || deleteMutation.isPending;

  function closeConfirm() {
    if (!actionPending) setConfirmAction(null);
  }

  function runConfirmedAction() {
    if (!client || !confirmAction) return;
    if (confirmAction === 'reset') {
      resetPassword.mutate(client.id, {
        onSuccess: () => {
          toast.success('Password reset email sent');
          setConfirmAction(null);
        },
        onError: errorToast,
      });
      return;
    }
    if (confirmAction === 'status') {
      statusAction.mutate({ clientId: client.id, active: nextActiveState }, {
        onSuccess: () => {
          toast.success(nextActiveState ? 'Client activated' : 'Client deactivated');
          setConfirmAction(null);
        },
        onError: errorToast,
      });
      return;
    }
    deleteMutation.mutate(client.id, {
      onSuccess: () => {
        toast.success('Client deleted');
        setConfirmAction(null);
        onClose();
      },
      onError: errorToast,
    });
  }

  return (
    <>
    <Modal open={Boolean(clientId)} onClose={onClose} title="Client Profile" description="Manage client login, Meta assets, lead analytics, and support context." size="xl">
      {detail.isLoading ? <Skeleton className="h-80" /> : !data || !client ? <EmptyState title="Client not found" /> : (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-semibold text-slate-950">{client.full_name}</h2>
                  <ClientStatusChip status={client.status} />
                </div>
                <p className="mt-1 truncate text-sm text-slate-600">{client.email} - {client.phone || 'No phone'}</p>
                <p className="mt-1 font-mono text-xs text-slate-500">User ID: {client.user_id}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button type="button" className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs" onClick={() => setConfirmAction('reset')}>
                  <KeyRound className="h-3.5 w-3.5" />
                  Send Reset Link
                </button>
                <button type="button" className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs" onClick={() => setConfirmAction('status')}>
                  <Power className="h-3.5 w-3.5" />
                  {client.status === 'active' ? 'Deactivate' : 'Activate'}
                </button>
                <button type="button" className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-rose-600" onClick={() => setConfirmAction('delete')}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <Info label="Created" value={client.created_at ? formatISTCompact(client.created_at) : null} />
              <Info label="Updated" value={client.updated_at ? formatISTCompact(client.updated_at) : null} />
              <Info label="Last login" value={client.last_login_at ? formatISTCompact(client.last_login_at) : 'Never'} />
              <Info label="Role" value="Client" />
            </div>
          </div>

          <Section title="Dashboard Summary">
            <div className="grid gap-2 sm:grid-cols-4">
              <SummaryLine label="Pages" value={data.meta.pages.length} />
              <SummaryLine label="Ad accounts" value={data.meta.ad_accounts.length} />
              <SummaryLine label="Campaigns" value={data.meta.campaigns.length} />
              <SummaryLine label="Leads" value={client.leads_count || 0} />
              <SummaryLine label="Open tickets" value={client.open_support_tickets || 0} />
            </div>
          </Section>

          <Section title="Meta Credentials & Assets">
            <div className="grid gap-4 lg:grid-cols-2">
              <AssetList title="Pages" rows={data.meta.pages} primaryKeys={['page_name', 'name', 'meta_page_name']} secondaryKeys={['page_id', 'meta_page_id', 'id']} empty="No Meta pages mapped." />
              <AssetList title="Ad Accounts" rows={data.meta.ad_accounts} primaryKeys={['account_name', 'name', 'ad_account_name']} secondaryKeys={['account_id', 'ad_account_id', 'id']} empty="No ad accounts mapped." />
            </div>
          </Section>

          <Section title="Campaigns">
            <CompactList rows={data.meta.campaigns.slice(0, 12)} primary="campaign_name" secondary="effective_status" empty="No campaigns mapped to this client." />
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

    <ClientFormModal open={editOpen} client={client} onClose={() => setEditOpen(false)} />
    <Modal open={Boolean(confirmAction)} onClose={closeConfirm} title={confirmTitle(confirmAction, client)} size="sm">
      <p className="text-sm text-slate-600">{confirmDescription(confirmAction, client)}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost rounded-lg px-4 py-2 text-sm" disabled={actionPending} onClick={closeConfirm}>Cancel</button>
        <button
          type="button"
          className={clsx('btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm', confirmAction === 'delete' && 'bg-rose-600 hover:bg-rose-700')}
          disabled={actionPending}
          onClick={runConfirmedAction}
        >
          {actionPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirm
        </button>
      </div>
    </Modal>
    </>
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
  return <div className="inline-flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span>{label}</span><strong>{value}</strong></div>;
}

function CompactList({ rows, primary, secondary, empty }: { rows: Array<Record<string, unknown>>; primary: string; secondary: string; empty: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return <div className="divide-y divide-slate-100">{rows.map((row, index) => <div key={`${primary}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="truncate font-medium text-slate-800">{String(row[primary] || 'Not named')}</span><span className="chip-slate shrink-0">{humanize(String(row[secondary] || 'unknown'))}</span></div>)}</div>;
}

function AssetList({
  title,
  rows,
  primaryKeys,
  secondaryKeys,
  empty,
}: {
  title: string;
  rows: Array<Record<string, unknown>>;
  primaryKeys: string[];
  secondaryKeys: string[];
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h4>
        <span className="chip-slate">{rows.length}</span>
      </div>
      {!rows.length ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
          {rows.slice(0, 12).map((row, index) => {
            const primary = firstValue(row, primaryKeys) || 'Not named';
            const secondary = firstValue(row, secondaryKeys) || 'No ID';
            return (
              <div key={`${title}-${index}`} className="min-w-0 py-2">
                <div className="truncate text-sm font-medium text-slate-800" title={primary}>{primary}</div>
                <div className="truncate font-mono text-xs text-slate-500" title={secondary}>{secondary}</div>
              </div>
            );
          })}
          {rows.length > 12 && <div className="pt-2 text-xs text-slate-500">+{rows.length - 12} more</div>}
        </div>
      )}
    </div>
  );
}

function firstValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return '';
}

function confirmTitle(action: 'reset' | 'status' | 'delete' | null, client: ClientAccount | null) {
  if (action === 'reset') return 'Send password reset link?';
  if (action === 'delete') return 'Delete client?';
  if (action === 'status') return client?.status === 'active' ? 'Deactivate client?' : 'Activate client?';
  return 'Confirm action';
}

function confirmDescription(action: 'reset' | 'status' | 'delete' | null, client: ClientAccount | null) {
  const name = client?.full_name || 'this client';
  if (action === 'reset') return `A password reset email will be sent to ${client?.email || 'the client email'}.`;
  if (action === 'delete') return `This soft-deletes ${name}'s login. Owned Meta, leads, and support data remains stored for audit.`;
  if (action === 'status') {
    return client?.status === 'active'
      ? `${name} will no longer be able to log in until reactivated.`
      : `${name} will be able to log in again after activation.`;
  }
  return 'Please confirm this action.';
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
