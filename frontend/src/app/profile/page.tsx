'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Briefcase, CalendarDays, CheckCircle2, Clock, Edit3, LifeBuoy, Phone, UserCircle, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { roleLabel } from '@/lib/auth';
import { clsx, initials } from '@/lib/format';
import { formatISTCompact } from '@/lib/date';
import { useMyProfile, useUpdateMyProfile, type MyProfile, type MyProfileStats } from '@/hooks/useMyProfile';

export default function MyProfilePage() {
  return (
    <AppShell title="My Profile" subtitle="Your CRM account, work details, and performance summary" roles={['super_admin', 'admin', 'rm', 'member', 'partner']}>
      <MyProfileInner />
    </AppShell>
  );
}

function MyProfileInner() {
  const profileQuery = useMyProfile();
  const [editOpen, setEditOpen] = useState(false);
  const profile = profileQuery.data?.profile;
  const stats = profileQuery.data?.stats || {};

  if (profileQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-48" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return <EmptyState title="Profile not found" description="Refresh the page or sign in again." icon={<UserCircle className="h-6 w-6" />} />;
  }

  return (
    <div className="space-y-6">
      <HeaderCard profile={profile} onEdit={() => setEditOpen(true)} />

      <div className="grid gap-4 lg:grid-cols-3">
        <InfoCard title="Personal Information" rows={[
          ['Name', profile.full_name || profile.name],
          ['Email', profile.email],
          ['Phone', profile.phone || 'Not provided'],
          ['CP ID', profile.cp_id || 'Not provided'],
          ['Role', roleLabel(profile.role)],
        ]} />
        <InfoCard title="Work Information" rows={[
          ['Account Status', profile.account_status || profile.status],
          ['Lead Availability', profile.availability_status || profile.lead_assignment_status || 'Not provided'],
          ['Reporting Manager', profile.reporting_manager?.name || (profile.role === 'rm' ? 'Not applicable' : 'Not assigned')],
          ['Team', profile.team_name || 'Not provided'],
          ['Last Login', profile.last_login_at ? formatISTCompact(profile.last_login_at) : 'Not available'],
        ]} />
        <SupportCard stats={stats} />
      </div>

      <PerformanceSummary profile={profile} stats={stats} />
      <EditProfileModal open={editOpen} onClose={() => setEditOpen(false)} profile={profile} />
    </div>
  );
}

function HeaderCard({ profile, onEdit }: { profile: MyProfile; onEdit: () => void }) {
  return (
    <div className="card p-5">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand-100 text-xl font-bold text-brand-700">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" className="h-full w-full rounded-2xl object-cover" />
            ) : initials(profile.full_name || profile.name)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold text-slate-900">{profile.full_name || profile.name}</h2>
              <span className="chip-blue">{roleLabel(profile.role)}</span>
              <StatusBadge value={profile.account_status || profile.status} />
              <AvailabilityBadge value={profile.availability_status || profile.lead_assignment_status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
              <span>{profile.email}</span>
              <span>{profile.phone || 'Phone not provided'}</span>
              <span>{profile.cp_id || 'CP ID not provided'}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Joined {profile.created_at ? formatISTCompact(profile.created_at) : 'Not available'}</p>
          </div>
        </div>
        <Button variant="outline" leftIcon={<Edit3 className="h-4 w-4" />} onClick={onEdit}>Edit Profile</Button>
      </div>
    </div>
  );
}

function InfoCard({ title, rows }: { title: string; rows: Array<[string, string | null | undefined]> }) {
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-900">{title}</h3>
      <div className="space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
            <span className="text-sm text-slate-500">{label}</span>
            <span className="max-w-[60%] text-right text-sm font-medium text-slate-900">{value || 'Not provided'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SupportCard({ stats }: { stats: MyProfileStats }) {
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-900">Support Summary</h3>
      <div className="rounded-xl bg-slate-50 p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-amber-100 text-amber-700">
            <LifeBuoy className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{Number(stats.open_support_tickets || 0)}</p>
            <p className="text-xs text-slate-500">Open tickets</p>
          </div>
        </div>
        <a href="/support" className="mt-4 inline-flex text-sm font-medium text-brand-700 hover:text-brand-800">View latest tickets</a>
      </div>
    </div>
  );
}

function PerformanceSummary({ profile, stats }: { profile: MyProfile; stats: MyProfileStats }) {
  const isRm = profile.role === 'rm';
  const cards = isRm ? [
    { label: 'Team Members', value: stats.total_team_members, Icon: Users, accent: 'blue' },
    { label: 'Available Members', value: stats.available_team_members, Icon: CheckCircle2, accent: 'green' },
    { label: 'Team Leads', value: stats.total_team_assigned_leads, Icon: Briefcase, accent: 'slate' },
    { label: 'Today Assigned', value: stats.today_team_assigned_leads, Icon: CalendarDays, accent: 'amber' },
    { label: 'Converted', value: stats.team_converted_leads, Icon: CheckCircle2, accent: 'green' },
    { label: 'Pending Requests', value: stats.pending_lead_requests, Icon: Clock, accent: 'pink' },
  ] : [
    { label: 'Assigned Leads', value: stats.total_assigned_leads, Icon: Briefcase, accent: 'blue' },
    { label: 'Today Leads', value: stats.today_assigned_leads, Icon: CalendarDays, accent: 'amber' },
    { label: 'Contacted', value: stats.contacted_leads, Icon: Phone, accent: 'green' },
    { label: 'Pending Calls', value: stats.pending_not_called_leads, Icon: Clock, accent: 'pink' },
    { label: 'Converted', value: stats.converted_leads, Icon: CheckCircle2, accent: 'green' },
    { label: 'Follow-ups', value: stats.followups_today ?? stats.followups_due, Icon: Clock, accent: 'slate' },
  ];

  return (
    <div className="card p-5">
      <h3 className="mb-4 text-sm font-semibold text-slate-900">Performance Summary</h3>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ label, value, Icon, accent }) => (
          <StatCard key={label} label={label} value={Number(value || 0)} icon={<Icon className="h-5 w-5" />} accent={accent} />
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, accent }: { label: string; value: number; icon: ReactNode; accent: string }) {
  const accentClass = accent === 'green' ? 'bg-emerald-100 text-emerald-700' : accent === 'amber' ? 'bg-amber-100 text-amber-700' : accent === 'pink' ? 'bg-rose-100 text-rose-700' : accent === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className={clsx('grid h-10 w-10 place-items-center rounded-lg', accentClass)}>{icon}</div>
        <div>
          <p className="text-2xl font-bold text-slate-900">{value.toLocaleString()}</p>
          <p className="text-xs font-medium text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

function EditProfileModal({ open, onClose, profile }: { open: boolean; onClose: () => void; profile: MyProfile }) {
  const update = useUpdateMyProfile();
  const [name, setName] = useState(profile.full_name || profile.name || '');
  const [phone, setPhone] = useState(profile.phone || '');

  useEffect(() => {
    if (!open) return;
    setName(profile.full_name || profile.name || '');
    setPhone(profile.phone || '');
  }, [open, profile]);

  function save() {
    update.mutate({ full_name: name, phone }, {
      onSuccess: () => {
        toast.success('Profile updated');
        onClose();
      },
      onError: (error: any) => toast.error(error?.response?.data?.error?.message || 'Could not update profile'),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Profile"
      description="You can update your display name and phone number."
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={update.isPending} onClick={save}>Save Profile</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Name</span>
          <input className="input w-full" value={name} onChange={event => setName(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Phone</span>
          <input className="input w-full" value={phone} onChange={event => setPhone(event.target.value)} />
        </label>
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          Email, role, and CP ID are managed by admin and cannot be changed here.
        </div>
      </div>
    </Modal>
  );
}

function StatusBadge({ value }: { value?: string | null }) {
  const active = value === 'active';
  return <span className={active ? 'chip-green' : 'chip-slate'}>{value || 'Unknown'}</span>;
}

function AvailabilityBadge({ value }: { value?: string | null }) {
  const available = value === 'available';
  return <span className={available ? 'chip-green' : 'chip-amber'}>{value || 'Not provided'}</span>;
}
