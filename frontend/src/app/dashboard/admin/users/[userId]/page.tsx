'use client';
import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowRightLeft, Briefcase, CalendarClock, CheckCircle2, Clock,
  Edit3, History, Loader2, Mail, Phone, Search, Shield, UserRound, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar,
} from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, Modal, Skeleton, StatusChip } from '@/components/ui/Modal';
import { useAuth } from '@/lib/auth';
import { clsx, fmtDate, fmtPhone, fmtRelative, humanize, initials } from '@/lib/format';
import { useActiveMembers, useBulkReassignLeads } from '@/hooks/useAdmin';
import { useUsers } from '@/hooks/useUsers';
import {
  ActivityRow,
  AssignmentHistoryRow,
  ProfileLead,
  ProfileRequest,
  UserProfileResponse,
  useAdminUserActivity,
  useAdminUserAssignmentHistory,
  useAdminUserLeads,
  useAdminUserPerformance,
  useAdminUserProfile,
  useAdminUserRequests,
  useUpdateAdminUserProfile,
} from '@/hooks/useUserProfile';

type TabKey = 'leads' | 'requests' | 'history' | 'activity';
type ApiErrorLike = { response?: { data?: { code?: string; message?: string; error?: { code?: string; message?: string } } } };
type AssignResult = { assigned?: number };

function apiErrorMessage(error: unknown, fallback: string) {
  const data = (error as ApiErrorLike)?.response?.data;
  const code = data?.code || data?.error?.code;
  if (code === 'INVALID_LEAD_ASSIGNEE_ROLE') {
    return 'Lead assignment is allowed only for Members and Partners. RM users can manage teams but cannot receive direct leads.';
  }
  return data?.message || data?.error?.message || fallback;
}

export default function AdminUserProfilePage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;

  return (
    <AppShell title="User Profile" subtitle="Performance, assignments, requests, and activity" roles={['super_admin', 'admin', 'rm']}>
      <UserProfileInner userId={userId} />
    </AppShell>
  );
}

function UserProfileInner({ userId }: { userId: string }) {
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const [range, setRange] = useState('30d');
  const [tab, setTab] = useState<TabKey>('leads');
  const profile = useAdminUserProfile(userId);
  const performance = useAdminUserPerformance(userId, range);
  const canEdit = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  if (profile.isLoading) {
    return <ProfileSkeleton />;
  }

  if (profile.isError || !profile.data) {
    return (
      <EmptyState
        title="Profile unavailable"
        description="The user may not exist, or your account does not have permission to view this profile."
        icon={<UserRound className="h-6 w-6" />}
        action={<button onClick={() => router.back()} className="btn-outline rounded-lg px-3 py-2 text-sm">Go back</button>}
      />
    );
  }

  const { user, counts, reportees } = profile.data;
  const perf = performance.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => router.back()} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="chip-slate">Admin profile</span>
        <span className="text-xs text-slate-400">Updated {fmtRelative(user.updated_at)}</span>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-xl font-semibold text-white">
              {initials(user.full_name)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold text-slate-950">{user.full_name}</h1>
                <span className="chip-blue">{humanize(user.role)}</span>
                <span className={user.status === 'active' ? 'chip-green' : 'chip-red'}>{humanize(user.status)}</span>
                {user.distribution_blocked && <span className="chip-red">Distribution blocked</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4 text-slate-400" />{user.email || '-'}</span>
                <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4 text-slate-400" />{fmtPhone(user.phone)}</span>
                <span className="inline-flex items-center gap-1.5"><Shield className="h-4 w-4 text-slate-400" />CP ID: {user.cp_id || '-'}</span>
                <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-slate-400" />RM: {user.rm_name || '-'}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-lg bg-slate-100 px-2.5 py-1">Team: {user.team_name || '-'}</span>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1">Availability: {user.is_available ? 'Available' : 'Unavailable'}</span>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1">Joined: {fmtDate(user.created_at, 'dd MMM yyyy')}</span>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1">Last login: {fmtDate(user.last_login_at)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/dashboard/admin/leads-manager?assigned_to=${user.id}`} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
              <Briefcase className="h-4 w-4" /> Leads
            </Link>
            {canEdit && <EditProfileButton profile={profile.data} userId={userId} />}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Assigned leads" value={counts.total_assigned_leads} icon={<Briefcase className="h-5 w-5" />} />
        <MetricCard label="Pending leads" value={counts.pending_leads} icon={<Clock className="h-5 w-5" />} tone="amber" />
        <MetricCard label="Worked leads" value={counts.worked_leads} icon={<CheckCircle2 className="h-5 w-5" />} tone="blue" />
        <MetricCard label="Converted" value={counts.converted_leads} suffix={`${Number(perf?.summary?.conversion_rate || 0).toFixed(1)}%`} icon={<Shield className="h-5 w-5" />} tone="green" />
        <MetricCard label="Follow-ups due" value={counts.followups_due} icon={<CalendarClock className="h-5 w-5" />} tone="red" />
        <MetricCard label="Assigned today" value={counts.assigned_today} icon={<Briefcase className="h-5 w-5" />} />
        <MetricCard label="This week" value={counts.assigned_this_week} icon={<Briefcase className="h-5 w-5" />} />
        <MetricCard label="Reassigned in/out" value={`${counts.reassigned_in_count}/${counts.reassigned_out_count}`} icon={<ArrowRightLeft className="h-5 w-5" />} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Performance trend</h2>
            <select className="input w-28" value={range} onChange={e => setRange(e.target.value)}>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
            </select>
          </div>
          {performance.isLoading ? <Skeleton className="h-72" /> : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={perf?.dailyTrend || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="assigned_count" name="Assigned" stroke="#2563eb" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="worked_count" name="Worked" stroke="#0f766e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="converted_count" name="Converted" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Call status breakdown</h2>
          {performance.isLoading ? <Skeleton className="h-72" /> : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(perf?.callStatusBreakdown || []).map(r => ({ ...r, status: humanize(r.status) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="status" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Lead source/form mix</h2>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={(perf?.sourceBreakdown || []).map(r => ({ name: r.form_name || r.source || r.meta_form_id || 'Unknown', count: r.count }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#0f766e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Performance signals</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <InfoRow label="Rank" value={perf?.ranking?.rank_position ? `#${perf.ranking.rank_position}` : 'Not available'} />
            <InfoRow label="Score" value={perf?.ranking?.score ?? 'Not available'} />
            <InfoRow label="Current pending" value={perf?.workload?.currently_pending ?? 0} />
            <InfoRow label="Inactive assigned" value={perf?.workload?.inactive_assigned_leads ?? 0} />
            <InfoRow label="Avg response time" value={perf?.summary?.average_response_time ?? 'Not available'} />
            <InfoRow label="Follow-up rate" value={perf?.summary?.follow_up_completion_rate ?? 'Not available'} />
          </dl>
          {reportees.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Direct reportees</h3>
              <div className="mt-2 space-y-2">
                {reportees.slice(0, 5).map(r => (
                  <Link key={r.id} href={`/dashboard/admin/users/${r.id}`} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50">
                    <span className="truncate font-medium text-slate-800">{r.full_name}</span>
                    <span className="text-xs text-slate-500">{humanize(r.role)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 pt-4">
          {(['leads', 'requests', 'history', 'activity'] as TabKey[]).map(key => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={clsx(
                'rounded-t-lg px-3 py-2 text-sm font-medium',
                tab === key ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
              )}
            >
              {key === 'history' ? 'Assignment history' : humanize(key)}
            </button>
          ))}
        </div>
        <div className="p-4">
          {tab === 'leads' && <AssignedLeadsTab userId={userId} canReassign={canEdit} />}
          {tab === 'requests' && <RequestsTab userId={userId} />}
          {tab === 'history' && <HistoryTab userId={userId} />}
          {tab === 'activity' && <ActivityTab userId={userId} />}
        </div>
      </section>
    </div>
  );
}

function EditProfileButton({ profile, userId }: { profile: UserProfileResponse; userId: string }) {
  const [open, setOpen] = useState(false);
  const { data: users } = useUsers();
  const updateProfile = useUpdateAdminUserProfile(userId);
  const [form, setForm] = useState({
    full_name: profile.user.full_name || '',
    email: profile.user.email || '',
    phone: profile.user.phone || '',
    cp_id: profile.user.cp_id || '',
    role: profile.user.role || 'member',
    status: profile.user.status || 'active',
    report_to_id: profile.user.report_to_id || '',
    team_name: profile.user.team_name || '',
    is_available: Boolean(profile.user.is_available),
  });
  const rms = (users || []).filter(u => u.role === 'rm');

  function submit() {
    if (!form.full_name.trim()) {
      toast.error('Full name is required');
      return;
    }
    updateProfile.mutate({
      ...form,
      report_to_id: form.report_to_id || null,
      team_name: form.team_name || null,
      cp_id: form.cp_id || null,
    }, {
      onSuccess: () => {
        toast.success('Profile updated');
        setOpen(false);
      },
      onError: (error: unknown) => toast.error(apiErrorMessage(error, 'Update failed')),
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
        <Edit3 className="h-4 w-4" /> Edit profile
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit Profile"
        description="Update safe user profile fields. Passwords and tokens are not editable here."
        size="lg"
        footer={(
          <>
            <button onClick={() => setOpen(false)} className="btn-outline rounded-lg px-4 py-2 text-sm">Cancel</button>
            <button onClick={submit} disabled={updateProfile.isPending} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
              {updateProfile.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
            </button>
          </>
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" value={form.full_name} onChange={v => setForm(f => ({ ...f, full_name: v }))} />
          <Field label="Email" type="email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} />
          <Field label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} />
          <Field label="CP ID" value={form.cp_id} onChange={v => setForm(f => ({ ...f, cp_id: v }))} />
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Role</span>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="super_admin">Super Admin</option>
              <option value="rm">RM</option>
              <option value="member">Member</option>
              <option value="partner">Partner</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Status</span>
            <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Reporting RM</span>
            <select className="input" value={form.report_to_id} onChange={e => setForm(f => ({ ...f, report_to_id: e.target.value }))}>
              <option value="">No RM</option>
              {rms.map(rm => <option key={rm.id} value={rm.id}>{rm.full_name}</option>)}
            </select>
          </label>
          <Field label="Team name" value={form.team_name} onChange={v => setForm(f => ({ ...f, team_name: v }))} />
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <input type="checkbox" checked={form.is_available} onChange={e => setForm(f => ({ ...f, is_available: e.target.checked }))} />
            <span className="font-medium text-slate-700">Available for lead distribution</span>
          </label>
        </div>
      </Modal>
    </>
  );
}

function AssignedLeadsTab({ userId, canReassign }: { userId: string; canReassign: boolean }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [callStatus, setCallStatus] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [targetUser, setTargetUser] = useState('');
  const [reason, setReason] = useState('');
  const leads = useAdminUserLeads(userId, { page, page_size: 20, search: search || undefined, call_status: callStatus || undefined });
  const members = useActiveMembers();
  const reassign = useBulkReassignLeads();
  const rows = leads.data?.rows || [];
  const total = leads.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));
  const assignableUsers = (members.data || []).filter(m => m.role === 'member' || m.role === 'partner');

  function toggle(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function submitReassign() {
    if (!targetUser || selected.length === 0) return;
    reassign.mutate({ lead_ids: selected, user_id: targetUser, reason: reason || undefined }, {
      onSuccess: (d: AssignResult) => {
        toast.success(`${d.assigned ?? selected.length} lead(s) reassigned`);
        setSelected([]);
        setTargetUser('');
        setReason('');
        setModalOpen(false);
        leads.refetch();
      },
      onError: (error: unknown) => toast.error(apiErrorMessage(error, 'Reassignment failed')),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-10" placeholder="Search assigned leads..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className="input w-44" value={callStatus} onChange={e => { setCallStatus(e.target.value); setPage(1); }}>
          <option value="">All call statuses</option>
          <option value="not_called">Not Called</option>
          <option value="interested">Interested</option>
          <option value="follow_up">Follow-up</option>
          <option value="converted">Converted</option>
          <option value="not_interested">Not Interested</option>
        </select>
        {canReassign && selected.length > 0 && (
          <button onClick={() => setModalOpen(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
            <ArrowRightLeft className="h-4 w-4" /> Reassign {selected.length}
          </button>
        )}
      </div>

      {leads.isLoading ? <Skeleton className="h-64" /> : rows.length === 0 ? (
        <EmptyState title="No assigned leads" description="No leads match the current filters." icon={<Briefcase className="h-6 w-6" />} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                {canReassign && <th className="w-10 px-3 py-3" />}
                <th className="px-3 py-3">Lead</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Assigned</th>
                <th className="px-3 py-3">Last activity</th>
                <th className="px-3 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((lead: ProfileLead) => (
                <tr key={lead.id} className="hover:bg-slate-50">
                  {canReassign && (
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selected.includes(lead.id)} onChange={() => toggle(lead.id)} />
                    </td>
                  )}
                  <td className="px-3 py-3">
                    <div className="font-medium text-slate-900">{lead.full_name || 'Unknown'}</div>
                    <div className="text-xs text-slate-500">{fmtPhone(lead.phone)}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{lead.form_name || lead.source || '-'}</td>
                  <td className="px-3 py-3"><StatusChip status={lead.call_status} /></td>
                  <td className="px-3 py-3 text-slate-600">{fmtDate(lead.assigned_at)}</td>
                  <td className="px-3 py-3 text-slate-600">{fmtRelative(lead.last_activity_at)}</td>
                  <td className="px-3 py-3 text-right">
                    <Link href={`/leads/${lead.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{total.toLocaleString()} lead(s)</span>
        <div className="flex items-center gap-2">
          <button className="btn-outline rounded-lg px-3 py-1.5 text-xs" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
          <span>Page {page} / {totalPages}</span>
          <button className="btn-outline rounded-lg px-3 py-1.5 text-xs" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Reassign Selected Leads"
        description={`${selected.length} lead(s) will move from this user to the selected member.`}
        footer={(
          <>
            <button onClick={() => setModalOpen(false)} className="btn-outline rounded-lg px-4 py-2 text-sm">Cancel</button>
            <button onClick={submitReassign} disabled={!targetUser || reassign.isPending} className="btn-primary rounded-lg px-4 py-2 text-sm inline-flex items-center gap-2">
              {reassign.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Reassign
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">New assignee</span>
            <select className="input" value={targetUser} onChange={e => setTargetUser(e.target.value)}>
              <option value="">Select member or partner</option>
              {assignableUsers.map(m => <option key={m.id} value={m.id}>{m.full_name} - {humanize(m.role)} - {m.team_name || 'No team'}</option>)}
            </select>
            {!members.isLoading && assignableUsers.length === 0 && (
              <span className="text-xs text-amber-600">No eligible active members or partners are available.</span>
            )}
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Reason</span>
            <textarea className="input min-h-24" value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional reassignment reason" />
          </label>
        </div>
      </Modal>
    </div>
  );
}

function RequestsTab({ userId }: { userId: string }) {
  const requests = useAdminUserRequests(userId);
  if (requests.isLoading) return <Skeleton className="h-48" />;
  const rows = requests.data || [];
  if (!rows.length) return <EmptyState title="No lead requests" description="This user has no request history." icon={<Clock className="h-6 w-6" />} />;
  return <div className="space-y-3">{rows.map(row => <RequestRow key={`${row.request_type}-${row.id}`} row={row} />)}</div>;
}

function RequestRow({ row }: { row: ProfileRequest }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900">{humanize(row.request_type)} request</span>
            <span className="chip-slate">{humanize(row.status)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Requested {fmtDate(row.requested_at)}</p>
        </div>
        <div className="grid grid-cols-4 gap-3 text-center text-xs">
          <MiniStat label="Requested" value={row.requested_quantity} />
          <MiniStat label="Approved" value={row.approved_quantity ?? '-'} />
          <MiniStat label="Fulfilled" value={row.fulfilled_quantity} />
          <MiniStat label="Remaining" value={row.remaining_quantity} />
        </div>
      </div>
      {(row.note || row.admin_notes) && <p className="mt-3 text-sm text-slate-600">{row.admin_notes || row.note}</p>}
    </div>
  );
}

function HistoryTab({ userId }: { userId: string }) {
  const history = useAdminUserAssignmentHistory(userId);
  if (history.isLoading) return <Skeleton className="h-48" />;
  const rows = history.data || [];
  if (!rows.length) return <EmptyState title="No assignment history" description="No assignment or reassignment records are available." icon={<History className="h-6 w-6" />} />;
  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row: AssignmentHistoryRow) => (
        <div key={row.id} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium text-slate-900">{row.lead_name || 'Lead'} <span className="text-slate-400">-</span> {humanize(row.assignment_type)}</div>
              <div className="text-xs text-slate-500">From {row.previous_user || '-'} to {row.assigned_to || '-'} by {row.assigned_by || 'System'}</div>
            </div>
            <span className="text-xs text-slate-500">{fmtDate(row.created_at)}</span>
          </div>
          {row.reason && <p className="mt-1 text-sm text-slate-600">{row.reason}</p>}
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ userId }: { userId: string }) {
  const activity = useAdminUserActivity(userId);
  if (activity.isLoading) return <Skeleton className="h-48" />;
  const rows = activity.data || [];
  if (!rows.length) return <EmptyState title="No activity found" description="No remarks, chat messages, or audit activity are available for this user." icon={<Clock className="h-6 w-6" />} />;
  return (
    <div className="divide-y divide-slate-100">
      {rows.map((row: ActivityRow, index) => (
        <div key={`${row.source}-${row.entity_id}-${row.created_at}-${index}`} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-medium text-slate-900">{humanize(row.action)} <span className="text-xs text-slate-500">from {humanize(row.source)}</span></div>
            <span className="text-xs text-slate-500">{fmtDate(row.created_at)}</span>
          </div>
          {row.metadata && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{metadataPreview(row.metadata)}</p>}
        </div>
      ))}
    </div>
  );
}

function MetricCard({ label, value, suffix, icon, tone = 'slate' }: { label: string; value: number | string; suffix?: string; icon: ReactNode; tone?: 'slate' | 'blue' | 'green' | 'amber' | 'red' }) {
  const toneClass = {
    slate: 'bg-slate-100 text-slate-700',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className={clsx('rounded-xl p-2', toneClass)}>{icon}</div>
        {suffix && <span className="text-xs font-medium text-slate-500">{suffix}</span>}
      </div>
      <div className="mt-4 text-2xl font-semibold text-slate-950">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="font-semibold text-slate-900">{value}</div>
      <div className="text-slate-500">{label}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value ?? 'Not available'}</dd>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input className="input" type={type} value={value} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

function metadataPreview(metadata: Record<string, unknown>) {
  const value = metadata.remark || metadata.body || metadata.message || metadata.reason || JSON.stringify(metadata);
  return String(value);
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-36" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
