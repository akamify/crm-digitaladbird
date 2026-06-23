'use client';
import { useState, ReactNode } from 'react';
import {
  Download, FileSpreadsheet, UserPlus, ArrowRightLeft, Megaphone,
  ShieldBan, ShieldCheck, KeyRound, Bell, Filter, Network, Zap,
  ScrollText, BarChart4, Loader2, X, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, Users, Send, Trash2, Eye,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import {
  useAdminLiveStats, useActivityLogs, useAdminNotifications,
  useMarkAllNotificationsRead, useSendBroadcast, useBroadcastMessages,
  useResetPassword, useBlockUser, useUnblockUser, useForceAssign,
  useUnassignedLeads, useActiveMembers, useReassignMember,
  useBulkLeadAction, exportLeadsCsv, exportReportsCsv,
} from '@/hooks/useAdmin';
import { useUsers, useCreateUser } from '@/hooks/useUsers';
import { clsx, humanize, fmtDate } from '@/lib/format';
import type { Role } from '@/types';

// ─── Main Panel ────────────────────────────────────────────────────
export function AdminToolsPanel() {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="card-padded">
      <button onClick={() => setExpanded(v => !v)} className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-semibold text-slate-900">Admin Command Center</h2>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-5">
          {/* Live Stats Row */}
          <LiveStatsRow />

          {/* Tool Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <ExportLeadsTool />
            <ExportReportsTool />
            <AddUserTool />
            <ForceAssignTool />
            <BlockUserTool />
            <ResetPasswordTool />
            <HierarchyTool />
            <ActivityLogsTool />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Live Stats Ribbon ──────────────────────────────────────────────
function LiveStatsRow() {
  const { data: s, isLoading } = useAdminLiveStats();
  if (isLoading || !s) return <div className="h-12 animate-pulse rounded-lg bg-slate-100" />;

  const stats = [
    { label: 'Users', value: s.active_users, color: 'text-brand-700' },
    { label: 'RMs', value: s.total_rms, color: 'text-violet-700' },
    { label: 'Members', value: s.total_members, color: 'text-sky-700' },
    { label: 'Blocked', value: s.blocked_users, color: s.blocked_users > 0 ? 'text-red-700' : 'text-slate-500' },
    { label: 'Leads', value: s.total_leads, color: 'text-slate-900' },
    { label: 'Unassigned', value: s.unassigned_leads, color: s.unassigned_leads > 0 ? 'text-amber-700' : 'text-slate-500' },
    { label: 'Pending', value: s.pending_leads, color: 'text-amber-700' },
    { label: 'Converted', value: s.converted_leads, color: 'text-emerald-700' },
    { label: 'Today New', value: s.today_leads, color: 'text-brand-700' },
    { label: 'Today Conv', value: s.today_conversions, color: 'text-emerald-700' },
    { label: 'Overdue F/U', value: s.overdue_followups, color: s.overdue_followups > 0 ? 'text-red-700' : 'text-slate-500' },
    { label: 'Active Today', value: s.today_active_users, color: 'text-brand-700' },
  ];

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
      {stats.map(({ label, value, color }) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <span className={clsx('text-base font-bold tabular-nums', color)}>{value}</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Tool Card (reusable button) ────────────────────────────────────
function ToolCard({ icon, label, color, onClick }: { icon: ReactNode; label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-center transition hover:shadow-md hover:border-slate-300 active:scale-[0.98]',
        color,
      )}
    >
      {icon}
      <span className="text-xs font-medium text-slate-700">{label}</span>
    </button>
  );
}

// ─── 1. Export Leads ────────────────────────────────────────────────
function ExportLeadsTool() {
  const [busy, setBusy] = useState(false);
  return (
    <ToolCard
      icon={<Download className={clsx('h-5 w-5', busy ? 'animate-spin text-slate-400' : 'text-brand-600')} />}
      label="Export Leads"
      color=""
      onClick={async () => {
        setBusy(true);
        try { await exportLeadsCsv(); toast.success('Leads CSV downloaded'); }
        catch { toast.error('Export failed'); }
        finally { setBusy(false); }
      }}
    />
  );
}

// ─── 2. Export Reports ──────────────────────────────────────────────
function ExportReportsTool() {
  const [busy, setBusy] = useState(false);
  return (
    <ToolCard
      icon={<FileSpreadsheet className={clsx('h-5 w-5', busy ? 'animate-spin text-slate-400' : 'text-emerald-600')} />}
      label="Export Reports"
      color=""
      onClick={async () => {
        setBusy(true);
        try { await exportReportsCsv(); toast.success('Report CSV downloaded'); }
        catch { toast.error('Export failed'); }
        finally { setBusy(false); }
      }}
    />
  );
}

// ─── 3. Add User (RM or Member) ─────────────────────────────────────
function AddUserTool() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', role: 'member' as Role, team_name: '', report_to_id: '', sendWelcomeEmail: true });
  const create = useCreateUser();
  const { data: users } = useUsers();
  const rms = (users || []).filter(u => u.role === 'rm');
  const selectedRm = rms.find(r => r.id === form.report_to_id);

  return (
    <>
      <ToolCard icon={<UserPlus className="h-5 w-5 text-violet-600" />} label="Add RM / Member" color="" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title="Add New User" size="md">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Full Name *</label>
              <input className="input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Role *</label>
              <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}>
                <option value="member">Member</option>
                <option value="rm">RM</option>
              </select>
            </div>
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">CP ID will be generated automatically by the backend.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Email *</label>
              <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="label">Phone *</label>
              <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          {form.role === 'member' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Reports To (RM)</label>
                <select className="input" value={form.report_to_id} onChange={e => setForm(f => ({ ...f, report_to_id: e.target.value }))}>
                  <option value="">— None —</option>
                  {rms.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Team Name</label>
                <input className="input" value={selectedRm?.team_name || form.team_name || 'Derived from RM'} disabled />
              </div>
            </div>
          )}
          {form.role === 'rm' && (
            <div>
              <label className="label">Team Name *</label>
              <input className="input" value={form.team_name} onChange={e => setForm(f => ({ ...f, team_name: e.target.value }))} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.sendWelcomeEmail} onChange={e => setForm(f => ({ ...f, sendWelcomeEmail: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />Send onboarding email with password setup link</label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button
            disabled={create.isPending || !form.full_name || !form.email || !form.phone || (form.role === 'member' && !form.report_to_id) || (form.role === 'rm' && !form.team_name.trim())}
            onClick={() => {
              create.mutate(
                {
                  full_name: form.full_name.trim(),
                  email: form.email.trim(),
                  phone: form.phone.trim(),
                  role: form.role,
                  report_to_id: form.role === 'member' ? form.report_to_id : null,
                  team_name: form.role === 'rm' ? form.team_name.trim() : null,
                  sendWelcomeEmail: form.sendWelcomeEmail,
                },
                {
                  onSuccess: (created) => { toast.success(`User created${created.cp_id ? ` (${created.cp_id})` : ''}`); if (created.emailWarning) toast.error(created.emailWarning); setOpen(false); setForm({ full_name: '', email: '', phone: '', role: 'member', team_name: '', report_to_id: '', sendWelcomeEmail: true }); },
                  onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Failed'),
                }
              );
            }}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2"
          >
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create User
          </button>
        </div>
      </Modal>
    </>
  );
}

// ─── 4. Force Assign ────────────────────────────────────────────────
function ForceAssignTool() {
  const [open, setOpen] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [targetUser, setTargetUser] = useState('');
  const [reason, setReason] = useState('');
  const unassigned = useUnassignedLeads();
  const members = useActiveMembers();
  const assign = useForceAssign();

  const toggleLead = (id: string) =>
    setSelectedLeads(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <>
      <ToolCard icon={<ArrowRightLeft className="h-5 w-5 text-amber-600" />} label="Force Assign" color="" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title="Force Assign Leads" size="lg">
        <div className="space-y-4">
          <div>
            <label className="label">Assign To *</label>
            <select className="input" value={targetUser} onChange={e => setTargetUser(e.target.value)}>
              <option value="">— Select member —</option>
              {members.data?.map(m => (
                <option key={m.id} value={m.id}>
                  {m.full_name} ({m.role}) — {m.lead_count} leads, {m.pending_count} pending
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Reason</label>
            <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional reason" />
          </div>
          <div>
            <label className="label">Unassigned Leads ({unassigned.data?.total ?? 0} total) — select to assign</label>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {unassigned.data?.rows.map(l => (
                <label key={l.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedLeads.includes(l.id)}
                    onChange={() => toggleLead(l.id)}
                    className="rounded border-slate-300"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900 truncate">{l.full_name || 'Unnamed'}</div>
                    <div className="text-xs text-slate-500">{l.phone || '—'} · {l.category} · {l.source || 'manual'}</div>
                  </div>
                </label>
              )) || <div className="px-3 py-4 text-sm text-slate-500 text-center">No unassigned leads</div>}
            </div>
            {selectedLeads.length > 0 && (
              <div className="mt-1 text-xs text-brand-600 font-medium">{selectedLeads.length} lead(s) selected</div>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button
            disabled={assign.isPending || selectedLeads.length === 0 || !targetUser}
            onClick={() => {
              assign.mutate(
                { lead_ids: selectedLeads, user_id: targetUser, reason },
                {
                  onSuccess: (d: any) => { toast.success(`${d.assigned} lead(s) assigned to ${d.target}`); setOpen(false); setSelectedLeads([]); },
                  onError: () => toast.error('Force assign failed'),
                }
              );
            }}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2"
          >
            {assign.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Assign {selectedLeads.length} Lead(s)
          </button>
        </div>
      </Modal>
    </>
  );
}

// ─── 5. Broadcast ───────────────────────────────────────────────────
function BroadcastTool() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', priority: 'normal', target_role: 'all' });
  const send = useSendBroadcast();
  const messages = useBroadcastMessages(10);

  return (
    <>
      <ToolCard icon={<Megaphone className="h-5 w-5 text-rose-600" />} label="Broadcast" color="" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title="Broadcast Message" size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Priority</label>
              <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="label">Target Audience</label>
              <select className="input" value={form.target_role} onChange={e => setForm(f => ({ ...f, target_role: e.target.value }))}>
                <option value="all">Everyone</option>
                <option value="rm">RMs Only</option>
                <option value="member">Members Only</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Title *</label>
            <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Message title" />
          </div>
          <div>
            <label className="label">Message *</label>
            <textarea className="input min-h-[80px]" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Write your message..." />
          </div>
        </div>

        {/* Recent broadcasts */}
        {messages.data && messages.data.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="text-xs font-medium text-slate-500 uppercase mb-2">Recent Broadcasts</div>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {messages.data.slice(0, 5).map(m => (
                <div key={m.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-900">{m.title}</span>
                    <span className={clsx('text-[10px] rounded-full px-1.5 py-0.5', m.priority === 'urgent' ? 'bg-red-100 text-red-700' : m.priority === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600')}>
                      {m.priority}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{fmtDate(m.created_at)} · {m.target_role}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button
            disabled={send.isPending || !form.title || !form.body}
            onClick={() => {
              send.mutate(form, {
                onSuccess: () => { toast.success('Broadcast sent!'); setForm({ title: '', body: '', priority: 'normal', target_role: 'all' }); },
                onError: () => toast.error('Failed to send'),
              });
            }}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2"
          >
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send Broadcast
          </button>
        </div>
      </Modal>
    </>
  );
}

// ─── 6. Block / Unblock User ────────────────────────────────────────
function BlockUserTool() {
  const [open, setOpen] = useState(false);
  const { data: users, isLoading } = useUsers();
  const block = useBlockUser();
  const unblock = useUnblockUser();

  const activeUsers = (users || []).filter(u => u.role !== 'super_admin');

  return (
    <>
      <ToolCard icon={<ShieldBan className="h-5 w-5 text-red-600" />} label="Block / Unblock" color="" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title="Block / Unblock Users" size="lg">
        {isLoading ? (
          <div className="h-32 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {activeUsers.map(u => {
              const isBlocked = u.status === 'blocked';
              return (
                <div key={u.id} className="flex items-center justify-between py-2.5 px-1">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{u.full_name}</div>
                    <div className="text-xs text-slate-500">{u.email} · {humanize(u.role)}{u.team_name ? ` · ${u.team_name}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={clsx('text-[10px] rounded-full px-2 py-0.5 font-medium', isBlocked ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
                      {isBlocked ? 'Blocked' : 'Active'}
                    </span>
                    {isBlocked ? (
                      <button
                        onClick={() => unblock.mutate(u.id, { onSuccess: () => toast.success(`${u.full_name} unblocked`), onError: () => toast.error('Failed') })}
                        disabled={unblock.isPending}
                        className="rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition"
                      >
                        <ShieldCheck className="h-3.5 w-3.5 inline mr-1" />Unblock
                      </button>
                    ) : (
                      <button
                        onClick={() => { if (confirm(`Block ${u.full_name}?`)) block.mutate({ userId: u.id }, { onSuccess: () => toast.success(`${u.full_name} blocked`), onError: () => toast.error('Failed') }); }}
                        disabled={block.isPending}
                        className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition"
                      >
                        <ShieldBan className="h-3.5 w-3.5 inline mr-1" />Block
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </>
  );
}

// ─── 7. Reset Password ──────────────────────────────────────────────
function ResetPasswordTool() {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const { data: users } = useUsers();
  const reset = useResetPassword();

  const allUsers = (users || []).filter(u => u.role !== 'super_admin');

  return (
    <>
      <ToolCard icon={<KeyRound className="h-5 w-5 text-orange-600" />} label="Reset Password" color="" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title="Reset User Password" size="sm">
        <div className="space-y-3">
          <div>
            <label className="label">User *</label>
            <select className="input" value={userId} onChange={e => setUserId(e.target.value)}>
              <option value="">— Select user —</option>
              {allUsers.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
            </select>
          </div>
          <div>
            <label className="label">New Password *</label>
            <input className="input" type="text" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Min 6 characters" />
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
            This will immediately revoke all active sessions for the user.
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button
            disabled={reset.isPending || !userId || newPwd.length < 6}
            onClick={() => {
              reset.mutate(
                { userId, new_password: newPwd },
                {
                  onSuccess: (d: any) => { toast.success(d.message || 'Password reset'); setOpen(false); setNewPwd(''); setUserId(''); },
                  onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Failed'),
                }
              );
            }}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2"
          >
            {reset.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Reset Password
          </button>
        </div>
      </Modal>
    </>
  );
}

// ─── 8. Notifications ───────────────────────────────────────────────
function NotificationsTool() {
  const [open, setOpen] = useState(false);
  const notifs = useAdminNotifications();
  const markAll = useMarkAllNotificationsRead();
  const count = notifs.data?.unread_count ?? 0;

  return (
    <>
      <ToolCard
        icon={
          <div className="relative">
            <Bell className="h-5 w-5 text-brand-600" />
            {count > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </div>
        }
        label="Notifications"
        color=""
        onClick={() => setOpen(true)}
      />
      <Modal open={open} onClose={() => setOpen(false)} title={`Notifications (${count} unread)`} size="md">
        {count > 0 && (
          <button onClick={() => markAll.mutate()} className="mb-3 text-xs text-brand-600 hover:text-brand-700 font-medium">
            Mark all as read
          </button>
        )}
        <div className="max-h-80 overflow-y-auto space-y-2">
          {notifs.data?.rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">No notifications yet</div>
          ) : (
            notifs.data?.rows.map(n => (
              <div key={n.id} className={clsx('rounded-lg border px-3 py-2.5', n.is_read ? 'border-slate-100 bg-white' : 'border-brand-200 bg-brand-50')}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{n.title}</span>
                  <span className="chip-slate">{n.type}</span>
                </div>
                {n.body && <div className="text-xs text-slate-600 mt-0.5">{n.body}</div>}
                <div className="text-[10px] text-slate-400 mt-1">{fmtDate(n.created_at)}</div>
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}

// ─── 9. Team Hierarchy ──────────────────────────────────────────────
function HierarchyTool() {
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [newRmId, setNewRmId] = useState('');
  const { data: users } = useUsers();
  const reassign = useReassignMember();

  const rms = (users || []).filter(u => u.role === 'rm');
  const members = (users || []).filter(u => u.role === 'member');
  const selectedRm = rms.find(r => r.id === newRmId);

  return (
    <>
      <ToolCard icon={<Network className="h-5 w-5 text-indigo-600" />} label="Hierarchy" color="" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title="Team Hierarchy Controls" size="md">
        <div className="space-y-3">
          <div>
            <label className="label">Member to Reassign *</label>
            <select className="input" value={memberId} onChange={e => setMemberId(e.target.value)}>
              <option value="">— Select member —</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.full_name} {m.team_name ? `(${m.team_name})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">New RM</label>
            <select className="input" value={newRmId} onChange={e => setNewRmId(e.target.value)}>
              <option value="">— Select RM —</option>
              {rms.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Team Name</label>
            <input className="input" value={selectedRm?.team_name || 'Select RM to derive team'} disabled />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button
            disabled={reassign.isPending || !memberId || !newRmId}
            onClick={() => {
              reassign.mutate(
                { member_id: memberId, new_rm_id: newRmId },
                {
                  onSuccess: (d: any) => { toast.success(`${d.member} reassigned`); setOpen(false); },
                  onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Failed'),
                }
              );
            }}
            className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2"
          >
            {reassign.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Reassign Member
          </button>
        </div>
      </Modal>
    </>
  );
}

// ─── 10. Activity Logs ──────────────────────────────────────────────
function ActivityLogsTool() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState('');
  const logs = useActivityLogs({ page, page_size: 15, entity: entityFilter || undefined });

  return (
    <>
      <ToolCard icon={<ScrollText className="h-5 w-5 text-slate-600" />} label="Activity Logs" color="" onClick={() => setOpen(true)} />
      <Modal open={open} onClose={() => setOpen(false)} title="Activity Logs" size="xl">
        <div className="flex items-center gap-2 mb-3">
          <select className="input w-36" value={entityFilter} onChange={e => { setEntityFilter(e.target.value); setPage(1); }}>
            <option value="">All entities</option>
            <option value="user">User</option>
            <option value="lead">Lead</option>
            <option value="broadcast">Broadcast</option>
            <option value="auth">Auth</option>
          </select>
          <span className="text-xs text-slate-500 ml-auto">{logs.data?.total ?? 0} total entries</span>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-2 font-medium">Time</th>
                <th className="py-2 pr-2 font-medium">User</th>
                <th className="py-2 pr-2 font-medium">Action</th>
                <th className="py-2 pr-2 font-medium">Entity</th>
                <th className="py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {logs.data?.rows.map(log => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="py-2 pr-2 text-slate-500 whitespace-nowrap">{fmtDate(log.created_at, 'dd MMM HH:mm')}</td>
                  <td className="py-2 pr-2">
                    <div className="font-medium text-slate-800">{log.user_name || '—'}</div>
                    <div className="text-slate-400">{log.user_role}</div>
                  </td>
                  <td className="py-2 pr-2">
                    <span className="chip-blue">{log.action}</span>
                  </td>
                  <td className="py-2 pr-2 text-slate-600">{log.entity}</td>
                  <td className="py-2 text-slate-500 max-w-[200px] truncate">
                    {log.metadata ? JSON.stringify(log.metadata).slice(0, 80) : '—'}
                  </td>
                </tr>
              ))}
              {logs.data?.rows.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-slate-500">No activity logs found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {(logs.data?.total ?? 0) > 15 && (
          <div className="mt-3 flex items-center justify-between">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn-ghost rounded px-3 py-1 text-xs disabled:opacity-40">Previous</button>
            <span className="text-xs text-slate-500">Page {page} of {Math.ceil((logs.data?.total ?? 0) / 15)}</span>
            <button disabled={page >= Math.ceil((logs.data?.total ?? 0) / 15)} onClick={() => setPage(p => p + 1)} className="btn-ghost rounded px-3 py-1 text-xs disabled:opacity-40">Next</button>
          </div>
        )}
      </Modal>
    </>
  );
}
