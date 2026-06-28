'use client';
import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowRightLeft, Briefcase, CalendarClock, CheckCircle2, Clock,
  Edit3, History, KeyRound, Loader2, Mail, Phone, Search, Shield, ShieldBan, ShieldCheck, Trash2, UserRound, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar,
} from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { AdminUserGoogleSheets, MyGoogleSheetProfileCard } from '@/components/googleSheets/AdminUserGoogleSheets';
import { EmptyState, Modal, Skeleton, StatusChip } from '@/components/ui/Modal';
import { useAuth } from '@/lib/auth';
import { clsx, fmtDate, fmtPhone, fmtRelative, humanize, initials } from '@/lib/format';
import { useActiveMembers, useBlockUser, useBulkReassignLeads, useUnblockUser } from '@/hooks/useAdmin';
import { useDeleteUser, useSendPasswordResetLink, useUpdateLeadAvailability, useUsers } from '@/hooks/useUsers';
import { validateEmail, validatePhone } from '@/lib/uiData';
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
  useForceLogoutUser,
  useUpdateAdminUserProfile,
} from '@/hooks/useUserProfile';

type TabKey =
  | 'overview'
  | 'security'
  | 'admin_actions'
  | 'email_history'
  | 'team_members'
  | 'team_leads'
  | 'team_performance'
  | 'settings'
  | 'leads'
  | 'requests'
  | 'assignment_history'
  | 'notifications'
  | 'activity';
type ApiErrorLike = { response?: { data?: { code?: string; message?: string; error?: { code?: string; message?: string } } } };
type AssignResult = { assigned?: number };

function apiErrorMessage(error: unknown, fallback: string) {
  const data = (error as ApiErrorLike)?.response?.data;
  const code = data?.code || data?.error?.code;
  if (code === 'INVALID_LEAD_ASSIGNEE_ROLE') {
    return 'Lead assignment is allowed only for Members and Partners. RM users can manage teams but cannot receive direct leads.';
  }
  if (code === 'EMAIL_PROVIDER_NOT_CONFIGURED') return 'Email provider is not configured.';
  if (code === 'USER_EMAIL_MISSING') return 'User has no registered email.';
  return data?.message || data?.error?.message || fallback;
}

export default function AdminUserProfilePage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;

  return (
    <AppShell title="User Profile" subtitle="Role-specific access, activity, and lifecycle details" roles={['super_admin', 'admin', 'rm', 'member']}>
      <UserProfileInner userId={userId} />
    </AppShell>
  );
}

function UserProfileInner({ userId }: { userId: string }) {
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const [range, setRange] = useState('30d');
  const [tab, setTab] = useState<TabKey>('overview');
  const profile = useAdminUserProfile(userId);
  const performance = useAdminUserPerformance(userId, range, profile.data?.profileType === 'member');
  const canEdit = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
  const blockUser = useBlockUser();
  const unblockUser = useUnblockUser();
  const deleteUser = useDeleteUser();
  const sendResetLink = useSendPasswordResetLink();
  const forceLogout = useForceLogoutUser(userId);

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

  const { user, counts = {}, reportees = [], profileType = 'member', metrics = {}, security, emailHistory = [], tabs = [] } = profile.data;
  const perf = performance.data;
  const isMemberProfile = profileType === 'member';
  const isRmProfile = profileType === 'rm';
  const isAdminProfile = profileType === 'admin';
  const availableTabs = (tabs.length ? tabs : ['leads', 'requests', 'assignment_history', 'activity'])
    .filter(tabKey => !(isAdminProfile && tabKey === 'permissions')) as TabKey[];
  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0];
  const isReadOnlyProfile = profileType === 'deleted' || user.status === 'deleted';
  const canManageLeadAvailability = !isReadOnlyProfile
    && ['rm', 'member', 'partner'].includes(user.role)
    && (canEdit
      || (currentUser?.role === 'rm' && (user.id === currentUser.id || user.report_to_id === currentUser.id)));

  function handleBlock() {
    if (!confirm('Block this user? This user will no longer be able to login using email, phone, or CP ID. They will not receive new leads.')) return;
    blockUser.mutate({ userId, reason: 'Blocked from user profile' }, {
      onSuccess: () => { toast.success('User blocked'); profile.refetch(); },
      onError: (error: unknown) => toast.error(apiErrorMessage(error, 'Block failed')),
    });
  }

  function handleUnblock() {
    if (!confirm('Unblock this user? This user will be able to login again if their role and credentials are valid.')) return;
    unblockUser.mutate(userId, {
      onSuccess: () => { toast.success('User unblocked'); profile.refetch(); },
      onError: (error: unknown) => toast.error(apiErrorMessage(error, 'Unblock failed')),
    });
  }

  function handleDelete() {
    const reason = prompt('Disable this user profile? Historical data will be retained. Enter a reason:');
    if (reason === null) return;
    deleteUser.mutate({ id: userId, reason: reason.trim() || 'Disabled from user profile' }, {
      onSuccess: () => { toast.success('User disabled'); profile.refetch(); },
      onError: (error: unknown) => toast.error(apiErrorMessage(error, 'Disable failed')),
    });
  }

  function handleSendResetLink() {
    if (!confirm("Send password reset link? A secure password reset link will be sent to this user's registered email.")) return;
    sendResetLink.mutate(userId, {
      onSuccess: () => toast.success('Password reset link sent.'),
      onError: (error: unknown) => toast.error(apiErrorMessage(error, 'Password reset link could not be sent')),
    });
  }

  function handleForceLogout() {
    if (!confirm("Force logout this user's sessions? They will need to login again on every device.")) return;
    forceLogout.mutate(undefined, {
      onSuccess: data => toast.success(`${data.revoked_sessions} active session(s) revoked.`),
      onError: (error: unknown) => toast.error(apiErrorMessage(error, 'Could not revoke sessions')),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => router.back()} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="chip-slate">Users</span>
        <span className="text-xs text-slate-400">/</span>
        <span className="chip-blue">{humanize(profileType)} profile</span>
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
                {(isRmProfile || isMemberProfile) && user.team_name && <span className="rounded-lg bg-slate-100 px-2.5 py-1">Team: {user.team_name}</span>}
                {(isRmProfile || isMemberProfile) && <span className="rounded-lg bg-slate-100 px-2.5 py-1">Availability: {user.is_available ? 'Available' : 'Unavailable'}</span>}
                <span className="rounded-lg bg-slate-100 px-2.5 py-1">Joined: {fmtDate(user.created_at, 'dd MMM yyyy')}</span>
                <span className="rounded-lg bg-slate-100 px-2.5 py-1">Last login: {fmtDate(user.last_login_at)}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && !isReadOnlyProfile && (
              <button onClick={handleSendResetLink} disabled={sendResetLink.isPending} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                {sendResetLink.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Send reset link
              </button>
            )}
            {canEdit && !isReadOnlyProfile && <EditProfileButton profile={profile.data} userId={userId} />}
            {canEdit && isAdminProfile && !isReadOnlyProfile && (
              <button onClick={handleForceLogout} disabled={forceLogout.isPending} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                {forceLogout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
                Force logout
              </button>
            )}
            {canEdit && user.role !== 'super_admin' && user.status === 'blocked' && !isReadOnlyProfile && (
              <button onClick={handleUnblock} disabled={unblockUser.isPending} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
                <ShieldCheck className="h-4 w-4" /> Unblock
              </button>
            )}
            {canEdit && user.role !== 'super_admin' && user.status !== 'blocked' && !isReadOnlyProfile && (
              <button onClick={handleBlock} disabled={blockUser.isPending} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-600">
                <ShieldBan className="h-4 w-4" /> Block
              </button>
            )}
            {canEdit && user.role !== 'super_admin' && !isReadOnlyProfile && (
              <button onClick={handleDelete} disabled={deleteUser.isPending} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-700">
                <Trash2 className="h-4 w-4" /> Disable
              </button>
            )}
          </div>
        </div>
      </section>

      {isReadOnlyProfile && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This profile is read-only. Historical users remain visible for audit, but login, lead assignment, and lifecycle actions are disabled.
        </div>
      )}

      {['rm', 'member', 'partner'].includes(user.role) && (
        <LeadAvailabilityPanel
          user={user}
          canManage={canManageLeadAvailability}
          onUpdated={() => profile.refetch()}
        />
      )}

      {canEdit && ['rm', 'member', 'partner'].includes(user.role) && <AdminUserGoogleSheets userId={user.id} />}
      {!canEdit && currentUser?.id === user.id && ['rm', 'member', 'partner'].includes(user.role) && <MyGoogleSheetProfileCard />}

      {isAdminProfile && <AdminProfileCards metrics={metrics} security={security} emailHistory={emailHistory} />}
      {isRmProfile && <RmProfileCards metrics={metrics} reportees={reportees} />}
      {isMemberProfile && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Assigned leads" value={counts.total_assigned_leads ?? 0} icon={<Briefcase className="h-5 w-5" />} />
          <MetricCard label="Pending leads" value={counts.pending_leads ?? 0} icon={<Clock className="h-5 w-5" />} tone="amber" />
          <MetricCard label="Worked leads" value={counts.worked_leads ?? 0} icon={<CheckCircle2 className="h-5 w-5" />} tone="blue" />
          <MetricCard label="Converted" value={counts.converted_leads ?? 0} suffix={`${Number(perf?.summary?.conversion_rate || 0).toFixed(1)}%`} icon={<Shield className="h-5 w-5" />} tone="green" />
          <MetricCard label="Follow-ups due" value={counts.followups_due ?? 0} icon={<CalendarClock className="h-5 w-5" />} tone="red" />
          <MetricCard label="Assigned today" value={counts.assigned_today ?? 0} icon={<Briefcase className="h-5 w-5" />} />
          <MetricCard label="This week" value={counts.assigned_this_week ?? 0} icon={<Briefcase className="h-5 w-5" />} />
          <MetricCard label="Reassigned in/out" value={`${counts.reassigned_in_count ?? 0}/${counts.reassigned_out_count ?? 0}`} icon={<ArrowRightLeft className="h-5 w-5" />} />
        </section>
      )}

      {isMemberProfile && <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
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
      </section>}

      {isMemberProfile && <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
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
            <InfoRow
              label="Leaderboard rank"
              value={perf?.ranking?.rank_position
                ? `#${perf.ranking.rank_position} of ${perf.ranking.total_ranked_users || 1}`
                : 'Not ranked'}
            />
            <InfoRow label="Performance score" value={Number(perf?.ranking?.score || 0).toLocaleString('en-IN')} />
            <InfoRow label="Total leads" value={perf?.ranking?.leads_total ?? perf?.summary?.assigned ?? 0} />
            <InfoRow label="Converted leads" value={perf?.ranking?.leads_converted ?? perf?.summary?.converted ?? 0} />
            <InfoRow label="Conversion rate" value={`${Number(perf?.ranking?.conv_rate ?? perf?.summary?.conversion_rate ?? 0).toFixed(1)}%`} />
            <InfoRow label="Contacted leads" value={perf?.ranking?.contacted_leads ?? perf?.summary?.worked ?? 0} />
            <InfoRow label="Completed leads" value={perf?.ranking?.completed_leads ?? 0} />
            <InfoRow label="Follow-ups" value={perf?.ranking?.followups_done ?? 0} />
            <InfoRow label="Calls logged" value={perf?.ranking?.calls_made ?? 0} />
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
      </section>}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 pt-4">
          {availableTabs.map(key => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={clsx(
                'rounded-t-lg px-3 py-2 text-sm font-medium',
                activeTab === key ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
              )}
            >
              {humanize(key)}
            </button>
          ))}
        </div>
        <div className="p-4">
          {activeTab === 'overview' && <OverviewTab profile={profile.data} />}
          {activeTab === 'security' && <SecurityTab security={security} />}
          {activeTab === 'admin_actions' && <ActivityTab userId={userId} label="Admin actions" />}
          {activeTab === 'email_history' && <EmailHistoryTab rows={emailHistory} />}
          {activeTab === 'team_members' && <TeamMembersTab reportees={reportees} />}
          {activeTab === 'team_leads' && <AssignedLeadsTab userId={userId} canReassign={false} />}
          {activeTab === 'team_performance' && <RmTeamPerformanceTab metrics={metrics} />}
          {activeTab === 'settings' && <SettingsTab profile={profile.data} />}
          {activeTab === 'leads' && <AssignedLeadsTab userId={userId} canReassign={canEdit && isMemberProfile} />}
          {activeTab === 'requests' && <RequestsTab userId={userId} />}
          {activeTab === 'assignment_history' && <HistoryTab userId={userId} profileType={profileType} />}
          {activeTab === 'notifications' && <EmptyState title="Notifications history" description="User notification history is visible from the notification audit endpoints when available." icon={<Mail className="h-6 w-6" />} />}
          {activeTab === 'activity' && <ActivityTab userId={userId} />}
        </div>
      </section>
    </div>
  );
}

function LeadAvailabilityPanel({
  user,
  canManage,
  onUpdated,
}: {
  user: UserProfileResponse['user'];
  canManage: boolean;
  onUpdated: () => void;
}) {
  const updateAvailability = useUpdateLeadAvailability();
  const isAvailable = Boolean(user.is_available);
  const accountRestricted = ['blocked', 'disabled', 'inactive', 'deleted'].includes(user.status) || Boolean(user.distribution_blocked);

  function toggleAvailability() {
    const status = isAvailable ? 'unavailable' : 'available';
    updateAvailability.mutate({ userId: user.id, status, reason: '' }, {
      onSuccess: () => {
        toast.success(`Lead assignment marked ${status}.`);
        onUpdated();
      },
      onError: (error) => toast.error(apiErrorMessage(error, 'Availability update failed')),
    });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Lead Assignment Availability</h2>
          {accountRestricted && <p className="mt-1 text-sm text-rose-600">Account status prevents new lead assignment.</p>}
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('rounded-lg px-3 py-2 text-sm font-semibold', isAvailable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800')}>
              Currently {isAvailable ? 'Available' : 'Unavailable'}
            </span>
            <button
              type="button"
              onClick={toggleAvailability}
              disabled={updateAvailability.isPending || accountRestricted}
              className={clsx(
                'min-w-40 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                isAvailable ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-emerald-600 text-white hover:bg-emerald-700',
              )}
              title={isAvailable ? 'Click to stop future lead assignment' : 'Click to allow future lead assignment'}
            >
              {updateAvailability.isPending ? 'Updating...' : isAvailable ? 'Mark Unavailable' : 'Mark Available'}
            </button>
          </div>
        ) : (
          <span className={clsx('rounded-lg px-4 py-2 text-sm font-semibold', isAvailable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800')}>
            {isAvailable ? 'Available' : 'Unavailable'}
          </span>
        )}
      </div>
    </section>
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
    role: profile.user.role === 'partner' ? 'member' : (profile.user.role || 'member'),
    report_to_id: profile.user.report_to_id || '',
    team_name: profile.user.team_name || '',
    is_available: Boolean(profile.user.is_available),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const rms = (users || []).filter(u => u.role === 'rm');
  const selectedRm = rms.find(rm => rm.id === form.report_to_id);

  function submit() {
    const nextErrors: Record<string, string> = {};
    if (!form.full_name.trim()) nextErrors.full_name = 'Full name is required.';
    if (!validateEmail(form.email)) nextErrors.email = 'Enter a valid email address.';
    if (!validatePhone(form.phone)) nextErrors.phone = 'Enter a valid Indian mobile number.';
    if (form.role === 'member' && !form.report_to_id) nextErrors.report_to_id = 'Select a reporting RM.';
    if (form.role === 'rm' && !form.team_name.trim()) nextErrors.team_name = 'Team name is required for RM.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    updateProfile.mutate({
      ...form,
      report_to_id: form.role === 'member' ? (form.report_to_id || null) : null,
      team_name: form.role === 'rm' ? (form.team_name || null) : form.role === 'member' ? (selectedRm?.team_name || null) : null,
      is_available: ['rm', 'member', 'partner'].includes(form.role) ? form.is_available : false,
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
          <Field label="Full name" value={form.full_name} error={errors.full_name} onChange={v => setForm(f => ({ ...f, full_name: v }))} />
          <Field label="Email" type="email" value={form.email} error={errors.email} onChange={v => setForm(f => ({ ...f, email: v }))} />
          <Field label="Phone" type="tel" value={form.phone} error={errors.phone} onChange={v => setForm(f => ({ ...f, phone: v.replace(/[^+\d\s()-]/g, '') }))} />
          <Field label="CP ID" value={profile.user.cp_id || 'System generated'} disabled />
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Role</span>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="super_admin">Super Admin</option>
              <option value="admin">Admin</option>
              <option value="rm">RM</option>
              <option value="member">Member</option>
            </select>
          </label>
          {form.role === 'member' && <label className="space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Reporting RM</span>
            <select className={errors.report_to_id ? 'input border-red-500' : 'input'} value={form.report_to_id} onChange={e => {
              const rm = rms.find(item => item.id === e.target.value);
              setForm(f => ({ ...f, report_to_id: e.target.value, team_name: rm?.team_name || '' }));
            }}>
              <option value="">No RM</option>
              {rms.map(rm => <option key={rm.id} value={rm.id}>{rm.full_name}</option>)}
            </select>
            {errors.report_to_id && <span className="text-xs text-red-500">{errors.report_to_id}</span>}
          </label>}
          {form.role === 'rm' && <Field
            label="Team name"
            value={form.team_name}
            error={errors.team_name}
            onChange={v => setForm(f => ({ ...f, team_name: v }))}
          />}
          {['rm', 'member', 'partner'].includes(form.role) && <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <input type="checkbox" checked={form.is_available} onChange={e => setForm(f => ({ ...f, is_available: e.target.checked }))} />
            <span className="font-medium text-slate-700">Available for lead distribution</span>
          </label>}
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
  const assignableUsers = (members.data || []).filter(m => m.role === 'member');

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
              <option value="">Select member</option>
              {assignableUsers.map(m => <option key={m.id} value={m.id}>{m.full_name} - Member - {m.team_name || 'No team'}</option>)}
            </select>
            {!members.isLoading && assignableUsers.length === 0 && (
              <span className="text-xs text-amber-600">No eligible active members are available.</span>
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

function HistoryTab({ userId, profileType }: { userId: string; profileType: UserProfileResponse['profileType'] }) {
  const [direction, setDirection] = useState('all');
  const [assignmentType, setAssignmentType] = useState('all');
  const [search, setSearch] = useState('');
  const history = useAdminUserAssignmentHistory(userId, {
    direction: direction === 'all' ? undefined : direction,
    type: assignmentType === 'all' ? undefined : assignmentType,
    search: search || undefined,
    page_size: 50,
  });
  if (history.isLoading) return <Skeleton className="h-48" />;
  const rows = history.data || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-10" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search lead or campaign..." />
        </div>
        {profileType === 'member' && (
          <select className="input w-48" value={direction} onChange={event => setDirection(event.target.value)}>
            <option value="all">All involving user</option>
            <option value="in">Assigned to user</option>
            <option value="out">Reassigned away</option>
          </select>
        )}
        <select className="input w-48" value={assignmentType} onChange={event => setAssignmentType(event.target.value)}>
          <option value="all">All assignment types</option>
          <option value="manual">Manual</option>
          <option value="manual_reassign">Manual reassign</option>
          <option value="auto">Auto</option>
          <option value="auto_reassign">Auto reassign</option>
          <option value="request_fulfillment">Request fulfillment</option>
        </select>
      </div>
      {!rows.length ? (
        <EmptyState title="No assignment history" description="No scoped assignment or reassignment records match these filters." icon={<History className="h-6 w-6" />} />
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map((row: AssignmentHistoryRow) => (
            <div key={row.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-slate-900">{row.lead_name || 'Lead'} <span className="text-slate-400">-</span> {humanize(row.assignment_type)}</div>
                  <div className="text-xs text-slate-500">From {row.previous_user || '-'} to {row.assigned_to || '-'} by {row.assigned_by || 'System'}</div>
                  <div className="mt-1 text-xs text-slate-500">{row.campaign_name || row.form_name || row.source || 'Source unavailable'}</div>
                </div>
                <span className="text-xs text-slate-500">{fmtDate(row.created_at)}</span>
              </div>
              {row.reason && <p className="mt-1 text-sm text-slate-600">{row.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityTab({ userId, label = 'Activity' }: { userId: string; label?: string }) {
  const activity = useAdminUserActivity(userId);
  if (activity.isLoading) return <Skeleton className="h-48" />;
  const rows = activity.data || [];
  if (!rows.length) return <EmptyState title={`No ${label.toLowerCase()} found`} description="No scoped activity is available for this user." icon={<Clock className="h-6 w-6" />} />;
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

function AdminProfileCards({ metrics, security, emailHistory }: { metrics: Record<string, string | number | null | undefined>; security?: UserProfileResponse['security']; emailHistory: UserProfileResponse['emailHistory'] }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Active sessions" value={security?.summary?.active_sessions ?? metrics.active_sessions ?? 0} icon={<ShieldCheck className="h-5 w-5" />} tone="green" />
      <MetricCard label="Total sessions" value={security?.summary?.total_sessions ?? metrics.total_sessions ?? 0} icon={<Shield className="h-5 w-5" />} />
      <MetricCard label="Admin actions" value={metrics.total_admin_actions ?? 0} icon={<History className="h-5 w-5" />} tone="blue" />
      <MetricCard label="Actions last 7 days" value={metrics.actions_last_7_days ?? 0} icon={<Clock className="h-5 w-5" />} />
      <MetricCard label="User actions" value={metrics.user_management_actions ?? 0} icon={<Users className="h-5 w-5" />} />
      <MetricCard label="Meta/integration actions" value={metrics.integration_actions ?? 0} icon={<Briefcase className="h-5 w-5" />} tone="amber" />
      <MetricCard label="Password reset emails" value={metrics.password_reset_emails ?? 0} icon={<KeyRound className="h-5 w-5" />} />
      <MetricCard label="Recent emails" value={emailHistory?.length ?? 0} icon={<Mail className="h-5 w-5" />} />
    </section>
  );
}

function RmProfileCards({ metrics, reportees }: { metrics: Record<string, string | number | null | undefined>; reportees: UserProfileResponse['reportees'] }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Team members" value={metrics.team_members_count ?? reportees.length} icon={<Users className="h-5 w-5" />} />
      <MetricCard label="Active members" value={metrics.active_members ?? reportees.filter(r => r.status === 'active').length} icon={<ShieldCheck className="h-5 w-5" />} tone="green" />
      <MetricCard label="Team assigned leads" value={metrics.team_assigned_leads ?? 0} icon={<Briefcase className="h-5 w-5" />} />
      <MetricCard label="Team pending leads" value={metrics.team_pending_leads ?? 0} icon={<Clock className="h-5 w-5" />} tone="amber" />
      <MetricCard label="Team worked leads" value={metrics.team_worked_leads ?? 0} icon={<CheckCircle2 className="h-5 w-5" />} tone="blue" />
      <MetricCard label="Team conversions" value={metrics.team_conversions ?? 0} icon={<Shield className="h-5 w-5" />} tone="green" />
      <MetricCard label="Overdue follow-ups" value={metrics.overdue_followups ?? 0} icon={<CalendarClock className="h-5 w-5" />} tone="red" />
      <MetricCard label="Pending requests" value={metrics.requests_pending ?? 0} icon={<Mail className="h-5 w-5" />} />
    </section>
  );
}

function OverviewTab({ profile }: { profile: UserProfileResponse }) {
  const { user, profileType, security, emailHistory, reportees, metrics = {} } = profile;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Profile summary</h3>
        <dl className="mt-4 space-y-3 text-sm">
          <InfoRow label="Profile type" value={humanize(profileType || user.role)} />
          <InfoRow label="Role" value={humanize(user.role)} />
          <InfoRow label="Status" value={humanize(user.status)} />
          <InfoRow label="CP ID" value={user.cp_id || '-'} />
          {profileType === 'member' && user.rm_name ? <InfoRow label="Reporting RM" value={user.rm_name} /> : null}
          {profileType !== 'admin' && user.team_name ? <InfoRow label="Team" value={user.team_name} /> : null}
        </dl>
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">{profileType === 'rm' ? 'Team snapshot' : profileType === 'admin' ? 'Security snapshot' : 'Lifecycle snapshot'}</h3>
        <dl className="mt-4 space-y-3 text-sm">
          {profileType === 'rm' ? (
            <>
              <InfoRow label="Team members" value={reportees.length} />
              <InfoRow label="Team assigned leads" value={metrics.team_assigned_leads ?? 0} />
              <InfoRow label="Pending team requests" value={metrics.requests_pending ?? 0} />
            </>
          ) : (
            <>
              <InfoRow label="Active sessions" value={security?.summary?.active_sessions ?? 0} />
              <InfoRow label="Last activity" value={fmtDate(security?.summary?.last_activity_at)} />
              <InfoRow label="Recent email events" value={emailHistory?.length ?? 0} />
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

function SecurityTab({ security }: { security?: UserProfileResponse['security'] }) {
  const sessions = security?.sessions || [];
  if (!sessions.length) return <EmptyState title="No sessions found" description="No auth session history is available for this user." icon={<Shield className="h-6 w-6" />} />;
  return (
    <div className="divide-y divide-slate-100">
      {sessions.map(session => (
        <div key={session.id} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium text-slate-900">{session.revoked_at ? 'Revoked session' : 'Session'}</div>
              <div className="text-xs text-slate-500">{session.ip_address || '-'} · {session.user_agent || 'Unknown device'}</div>
            </div>
            <span className="text-xs text-slate-500">{fmtDate(session.last_activity_at || session.created_at)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmailHistoryTab({ rows }: { rows?: UserProfileResponse['emailHistory'] }) {
  const data = rows || [];
  if (!data.length) return <EmptyState title="No email history" description="Password reset and onboarding email logs will appear here." icon={<Mail className="h-6 w-6" />} />;
  return (
    <div className="divide-y divide-slate-100">
      {data.map(row => (
        <div key={row.id} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium text-slate-900">{humanize(row.email_type)}</div>
              <div className="text-xs text-slate-500">{row.email_to} · {humanize(row.status)}</div>
            </div>
            <span className="text-xs text-slate-500">{fmtDate(row.sent_at || row.created_at)}</span>
          </div>
          {row.error_message && <p className="mt-1 text-sm text-rose-600">{row.error_message}</p>}
        </div>
      ))}
    </div>
  );
}


function TeamMembersTab({ reportees }: { reportees: UserProfileResponse['reportees'] }) {
  if (!reportees.length) return <EmptyState title="No team members" description="This RM does not currently have active members reporting to them." icon={<Users className="h-6 w-6" />} />;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {reportees.map(member => {
        const leadAvailable = Boolean(member.is_available) && member.status === 'active';
        return (
          <Link key={member.id} href={`/dashboard/admin/users/${member.id}`} className="rounded-xl border border-slate-200 p-4 hover:bg-slate-50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-900">{member.full_name}</div>
                <div className="truncate text-xs text-slate-500">{member.email || member.phone || '-'}</div>
              </div>
              <span className="chip-slate">{humanize(member.role)}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className={member.status === 'active' ? 'chip-green' : 'chip-red'}>Account: {humanize(member.status || 'unknown')}</span>
              <span className={leadAvailable ? 'chip-green' : 'chip-amber'}>Lead Availability: {leadAvailable ? 'Available' : 'Unavailable'}</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">Team: {member.team_name || '-'}</div>
          </Link>
        );
      })}
    </div>
  );
}

function RmTeamPerformanceTab({ metrics }: { metrics: Record<string, string | number | null | undefined> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <MetricCard label="Team assigned leads" value={metrics.team_assigned_leads ?? 0} icon={<Briefcase className="h-5 w-5" />} />
      <MetricCard label="Team worked leads" value={metrics.team_worked_leads ?? 0} icon={<CheckCircle2 className="h-5 w-5" />} tone="blue" />
      <MetricCard label="Team conversions" value={metrics.team_conversions ?? 0} icon={<Shield className="h-5 w-5" />} tone="green" />
      <MetricCard label="Team pending leads" value={metrics.team_pending_leads ?? 0} icon={<Clock className="h-5 w-5" />} tone="amber" />
      <MetricCard label="Overdue follow-ups" value={metrics.overdue_followups ?? 0} icon={<CalendarClock className="h-5 w-5" />} tone="red" />
      <MetricCard label="Approved requests" value={metrics.requests_approved ?? 0} icon={<Mail className="h-5 w-5" />} />
    </div>
  );
}

function SettingsTab({ profile }: { profile: UserProfileResponse }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">Profile settings</h3>
        <p className="mt-1 text-sm text-slate-500">
          Use Edit profile from the header for safe profile changes. CP ID is system generated and read-only.
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <InfoRow label="Daily lead cap" value={profile.user.role === 'member' ? profile.user.daily_lead_cap ?? 'Not set' : 'Not applicable'} />
          <InfoRow label="Distribution weight" value={profile.user.role === 'member' ? profile.user.distribution_weight ?? 'Not set' : 'Not applicable'} />
          <InfoRow label="Team name" value={profile.user.team_name || '-'} />
          <InfoRow label="Availability" value={profile.user.is_available ? 'Available' : 'Unavailable'} />
        </dl>
      </div>
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

function Field({ label, value, onChange, type = 'text', disabled = false, error }: { label: string; value: string; onChange?: (value: string) => void; type?: string; disabled?: boolean; error?: string }) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input className={error ? 'input border-red-500' : 'input'} type={type} value={value} disabled={disabled} onChange={e => onChange?.(e.target.value)} />
      {error && <span className="text-xs text-red-500">{error}</span>}
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
