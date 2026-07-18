'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, KeyRound, Loader2, Pencil, Power, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import {
  useClientDetail,
  useClientStatusAction,
  useDeleteClient,
  useResetClientPassword,
  useUpdateClient,
  type ClientAccount,
  type ClientInput,
} from '@/hooks/useClients';
import { clsx, humanize } from '@/lib/format';
import { formatISTCompact } from '@/lib/date';

export default function AdminClientProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const clientId = params?.id;
  const detail = useClientDetail(clientId);
  const statusAction = useClientStatusAction();
  const resetPassword = useResetClientPassword();
  const deleteMutation = useDeleteClient();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'reset' | 'status' | 'delete' | null>(null);
  const data = detail.data;
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
        router.push('/dashboard/admin/clients');
      },
      onError: errorToast,
    });
  }

  return (
    <AppShell title="Client Profile" subtitle="Manage client login, Meta assets, lead analytics, and support context" roles={['super_admin', 'admin']}>
      <div className="space-y-5">
        <button type="button" className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm" onClick={() => router.push('/dashboard/admin/clients')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Clients
        </button>

        {detail.isLoading ? (
          <Skeleton className="h-96" />
        ) : detail.isError ? (
          <EmptyState title="Could not load client profile" action={<button className="btn-outline rounded-lg px-3 py-2 text-sm" onClick={() => detail.refetch()}>Retry</button>} />
        ) : !data || !client ? (
          <EmptyState title="Client not found" />
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-2xl font-semibold text-slate-950">{client.full_name}</h1>
                    <ClientStatusChip status={client.status} />
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-600">{client.email} - {client.phone || 'No phone'}</p>
                  <p className="mt-1 font-mono text-xs text-slate-500">User ID: {client.user_id}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm" onClick={() => setEditOpen(true)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </button>
                  <button type="button" className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm" onClick={() => setConfirmAction('reset')}>
                    <KeyRound className="h-4 w-4" />
                    Send Reset Link
                  </button>
                  <button type="button" className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm" onClick={() => setConfirmAction('status')}>
                    <Power className="h-4 w-4" />
                    {client.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                  <button type="button" className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-600" onClick={() => setConfirmAction('delete')}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-4">
                <Info label="Created" value={client.created_at ? formatISTCompact(client.created_at) : null} />
                <Info label="Updated" value={client.updated_at ? formatISTCompact(client.updated_at) : null} />
                <Info label="Last Login" value={client.last_login_at ? formatISTCompact(client.last_login_at) : 'Never'} />
                <Info label="Role" value="Client" />
              </div>
            </section>

            <Section title="Dashboard Summary">
              <div className="grid gap-2 sm:grid-cols-5">
                <Summary label="Pages" value={data.meta.pages.length} />
                <Summary label="Ad Accounts" value={data.meta.ad_accounts.length} />
                <Summary label="Campaigns" value={data.meta.campaigns.length} />
                <Summary label="Leads" value={client.leads_count || 0} />
                <Summary label="Open Tickets" value={client.open_support_tickets || 0} />
              </div>
            </Section>

            <Section title="Meta Credentials & Assets">
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Meta credentials are admin-managed. Map this client to Meta pages/ad accounts from the existing Meta setup flow; clients only get read-only access.
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <AssetList title="Pages" rows={data.meta.pages} primaryKeys={['page_name', 'name', 'meta_page_name']} secondaryKeys={['page_id', 'meta_page_id', 'id']} empty="No Meta pages mapped to this client." />
                <AssetList title="Ad Accounts" rows={data.meta.ad_accounts} primaryKeys={['account_name', 'name', 'ad_account_name']} secondaryKeys={['account_id', 'ad_account_id', 'id']} empty="No ad accounts mapped to this client." />
              </div>
            </Section>

            <Section title="Campaigns">
              <CompactList rows={data.meta.campaigns} primary="campaign_name" secondary="effective_status" empty="No campaigns mapped to this client." />
            </Section>

            <div className="grid gap-5 xl:grid-cols-2">
              <Section title="Recent Leads">
                <CompactList rows={data.leads_summary.recent} primary="full_name" secondary="campaign_name" empty="No client leads yet." />
              </Section>
              <Section title="Support History">
                <CompactList rows={data.support_history} primary="ticket_no" secondary="status" empty="No support tickets yet." />
              </Section>
            </div>
          </>
        )}
      </div>

      <ClientEditModal open={editOpen} client={client} onClose={() => setEditOpen(false)} />
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
    </AppShell>
  );
}

function ClientEditModal({ open, client, onClose }: { open: boolean; client: ClientAccount | null; onClose: () => void }) {
  const update = useUpdateClient();
  const [form, setForm] = useState<ClientInput>({});

  useEffect(() => {
    setForm(client ? {
      full_name: client.full_name,
      email: client.email,
      phone: client.phone || '',
      user_id: client.user_id,
      active: client.status === 'active',
    } : {});
  }, [client, open]);

  function submit() {
    if (!client) return;
    update.mutate({ ...form, name: form.full_name, clientId: client.id }, {
      onSuccess: () => {
        toast.success('Client updated');
        onClose();
      },
      onError: errorToast,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit Client" size="lg">
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
        <button className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm" disabled={update.isPending} onClick={submit}>
          {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save Client
        </button>
      </div>
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
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-3 text-sm font-semibold text-slate-900">{title}</h2>{children}</section>;
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-slate-50 px-3 py-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-xl font-semibold text-slate-950">{value}</div></div>;
}

function CompactList({ rows, primary, secondary, empty }: { rows: Array<Record<string, unknown>>; primary: string; secondary: string; empty: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return <div className="divide-y divide-slate-100">{rows.slice(0, 20).map((row, index) => <div key={`${primary}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="truncate font-medium text-slate-800">{String(row[primary] || 'Not named')}</span><span className="chip-slate shrink-0">{humanize(String(row[secondary] || 'unknown'))}</span></div>)}</div>;
}

function AssetList({ title, rows, primaryKeys, secondaryKeys, empty }: { title: string; rows: Array<Record<string, unknown>>; primaryKeys: string[]; secondaryKeys: string[]; empty: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
        <span className="chip-slate">{rows.length}</span>
      </div>
      {!rows.length ? <p className="text-sm text-slate-500">{empty}</p> : (
        <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {rows.slice(0, 20).map((row, index) => {
            const primary = firstValue(row, primaryKeys) || 'Not named';
            const secondary = firstValue(row, secondaryKeys) || 'No ID';
            return <div key={`${title}-${index}`} className="min-w-0 py-2"><div className="truncate text-sm font-medium text-slate-800" title={primary}>{primary}</div><div className="truncate font-mono text-xs text-slate-500" title={secondary}>{secondary}</div></div>;
          })}
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

function ClientStatusChip({ status }: { status: string }) {
  return <span className={status === 'active' ? 'chip-green' : status === 'blocked' ? 'chip-red' : 'chip-amber'}>{humanize(status || 'unknown')}</span>;
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
  if (action === 'status') return client?.status === 'active' ? `${name} will no longer be able to log in until reactivated.` : `${name} will be able to log in again after activation.`;
  return 'Please confirm this action.';
}

function errorToast(error: unknown) {
  const message = (error as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response?.data?.error?.message
    || (error as { response?: { data?: { message?: string } } })?.response?.data?.message
    || 'Action failed';
  toast.error(message);
}
