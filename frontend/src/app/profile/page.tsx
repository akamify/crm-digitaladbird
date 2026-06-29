'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Clock,
  Edit3,
  LifeBuoy,
  Mail,
  Phone,
  UserCircle,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState, Modal, Skeleton } from '@/components/ui/Modal';
import { roleLabel } from '@/lib/auth';
import { clsx, initials } from '@/lib/format';
import { formatISTCompact } from '@/lib/date';
import {
  useMyProfile,
  useUpdateMyProfile,
  type MyProfile,
  type MyProfileStats,
} from '@/hooks/useMyProfile';

export default function MyProfilePage() {
  return (
    <AppShell
      title="My Profile"
      subtitle="Your CRM account, work details, and performance summary"
      roles={['rm', 'member', 'partner']}
    >
      <MyProfileInner />
    </AppShell>
  );
}

function MyProfileInner() {
  const profileQuery = useMyProfile();
  const [editOpen, setEditOpen] = useState(false);

  const profile = profileQuery.data?.profile;
  const stats = profileQuery.data?.stats || {};

  useEffect(() => {
    if (profileQuery.error) {
      console.error('GET /api/users/me/profile failed', profileQuery.error);
    }
  }, [profileQuery.error]);

  if (profileQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-48 rounded-3xl" />

        <div className="grid min-w-0 gap-5 xl:grid-cols-3">
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-64 rounded-3xl" />
          <Skeleton className="h-64 rounded-3xl" />
        </div>

        <Skeleton className="h-72 rounded-3xl" />
      </div>
    );
  }

  if (profileQuery.isError || !profile) {
    return (
      <EmptyState
        title="Profile could not be loaded"
        description="Please retry. If this continues, admin can check PM2 logs for the exact backend error."
        icon={<UserCircle className="h-6 w-6" />}
        action={
          <Button variant="outline" onClick={() => profileQuery.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <HeaderCard profile={profile} onEdit={() => setEditOpen(true)} />

      <div className="grid min-w-0 gap-5 xl:grid-cols-3">
        <InfoCard
          title="Personal Information"
          rows={[
            ['Name', profile.full_name || profile.name],
            ['Email', profile.email],
            ['Phone', profile.phone || 'Not provided'],
            ['CP ID', profile.cp_id || 'Not provided'],
            ['Role', roleLabel(profile.role)],
          ]}
        />

        <InfoCard
          title="Work Information"
          rows={[
            ['Account Status', profile.account_status || profile.status],
            ['Lead Availability', profile.availability_status || profile.lead_assignment_status || 'Not provided'],
            [
              'Reporting Manager',
              profile.reporting_manager?.name || (profile.role === 'rm' ? 'Not applicable' : 'Not assigned'),
            ],
            ['Team', profile.team_name || 'Not provided'],
            ['Last Login', profile.last_login_at ? formatISTCompact(profile.last_login_at) : 'Not available'],
          ]}
        />

        <SupportCard stats={stats} />
      </div>

      <PerformanceSummary profile={profile} stats={stats} />

      <EditProfileModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        profile={profile}
      />
    </div>
  );
}

function HeaderCard({
  profile,
  onEdit,
}: {
  profile: MyProfile;
  onEdit: () => void;
}) {
  const displayName = profile.full_name || profile.name || 'User';

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
      <div className="bg-gradient-to-br from-slate-50 via-white to-brand-50/40 px-5 py-5 sm:px-6">
        <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-100 text-xl font-bold text-brand-700 ring-1 ring-brand-200/70 sm:h-18 sm:w-18">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                initials(displayName)
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="min-w-0 max-w-full break-words text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
                  {displayName}
                </h2>

                <span className="chip-blue shrink-0">{roleLabel(profile.role)}</span>
                <StatusBadge value={profile.account_status || profile.status} />
                <AvailabilityBadge value={profile.availability_status || profile.lead_assignment_status} />
              </div>

              <div className="mt-3 grid min-w-0 gap-2 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-3">
                <HeaderMetaItem
                  icon={<Mail className="h-4 w-4" />}
                  value={profile.email || 'Email not provided'}
                  breakAll
                />
                <HeaderMetaItem
                  icon={<Phone className="h-4 w-4" />}
                  value={profile.phone || 'Phone not provided'}
                />
                <HeaderMetaItem
                  icon={<UserCircle className="h-4 w-4" />}
                  value={profile.cp_id || 'CP ID not provided'}
                />
              </div>

              <p className="mt-3 text-xs font-medium text-slate-500">
                Joined {profile.created_at ? formatISTCompact(profile.created_at) : 'Not available'}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 justify-start lg:justify-end">
            <Button
              variant="outline"
              leftIcon={<Edit3 className="h-4 w-4" />}
              onClick={onEdit}
            >
              Edit Profile
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeaderMetaItem({
  icon,
  value,
  breakAll = false,
}: {
  icon: ReactNode;
  value: string;
  breakAll?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2">
      <span className="shrink-0 text-slate-400">{icon}</span>
      <span
        className={clsx(
          'min-w-0 text-sm leading-5 text-slate-700',
          breakAll ? 'break-all' : 'truncate',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function CardShell({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={clsx(
        'min-w-0 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6',
        className,
      )}
    >
      <h3 className="mb-5 text-base font-semibold tracking-tight text-slate-950">
        {title}
      </h3>

      {children}
    </section>
  );
}

function InfoCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string | null | undefined]>;
}) {
  return (
    <CardShell title={title} className="h-full">
      <div className="min-w-0 divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <InfoRow key={label} label={label} value={value || 'Not provided'} />
        ))}
      </div>
    </CardShell>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const isLongValue = label.toLowerCase().includes('email');

  return (
    <div className="grid min-w-0 grid-cols-[minmax(6.25rem,0.45fr)_minmax(0,1fr)] items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="min-w-0 text-sm font-medium leading-6 text-slate-500">
        {label}
      </span>

      <span
        className={clsx(
          'min-w-0 text-right text-sm font-semibold leading-6 text-slate-950',
          isLongValue ? 'break-all' : 'break-words',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function SupportCard({ stats }: { stats: MyProfileStats }) {
  return (
    <CardShell title="Support Summary" className="h-full">
      <div className="flex h-[calc(100%-2rem)] min-h-[170px] flex-col justify-between rounded-2xl border border-slate-100 bg-slate-50/80 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700 ring-1 ring-amber-200/70">
            <LifeBuoy className="h-6 w-6" />
          </div>

          <div className="min-w-0">
            <p className="text-3xl font-bold tracking-tight text-slate-950">
              {Number(stats.open_support_tickets || 0).toLocaleString()}
            </p>
            <p className="mt-0.5 text-sm font-medium text-slate-500">
              Open tickets
            </p>
          </div>
        </div>

        <a
          href="/support"
          className="mt-5 inline-flex w-fit items-center rounded-xl px-0 text-sm font-semibold text-brand-700 transition hover:text-brand-800"
        >
          View latest tickets
        </a>
      </div>
    </CardShell>
  );
}

function PerformanceSummary({
  profile,
  stats,
}: {
  profile: MyProfile;
  stats: MyProfileStats;
}) {
  const isRm = profile.role === 'rm';

  const cards = isRm
    ? [
        { label: 'Team Members', value: stats.total_team_members, Icon: Users, accent: 'blue' },
        { label: 'Available Members', value: stats.available_team_members, Icon: CheckCircle2, accent: 'green' },
        { label: 'Team Leads', value: stats.total_team_assigned_leads, Icon: Briefcase, accent: 'slate' },
        { label: 'Today Assigned', value: stats.today_team_assigned_leads, Icon: CalendarDays, accent: 'amber' },
        { label: 'Converted', value: stats.team_converted_leads, Icon: CheckCircle2, accent: 'green' },
        { label: 'Pending Requests', value: stats.pending_lead_requests, Icon: Clock, accent: 'pink' },
      ]
    : [
        { label: 'Assigned Leads', value: stats.total_assigned_leads, Icon: Briefcase, accent: 'blue' },
        { label: 'Today Leads', value: stats.today_assigned_leads, Icon: CalendarDays, accent: 'amber' },
        { label: 'Contacted', value: stats.contacted_leads, Icon: Phone, accent: 'green' },
        { label: 'Pending Calls', value: stats.pending_not_called_leads, Icon: Clock, accent: 'pink' },
        { label: 'Converted', value: stats.converted_leads, Icon: CheckCircle2, accent: 'green' },
        { label: 'Follow-ups', value: stats.followups_today ?? stats.followups_due, Icon: Clock, accent: 'slate' },
      ];

  return (
    <CardShell title="Performance Summary">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ label, value, Icon, accent }) => (
          <StatCard
            key={label}
            label={label}
            value={Number(value || 0)}
            icon={<Icon className="h-5 w-5" />}
            accent={accent}
          />
        ))}
      </div>
    </CardShell>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  accent: string;
}) {
  const accentClass =
    accent === 'green'
      ? 'bg-emerald-100 text-emerald-700 ring-emerald-200/70'
      : accent === 'amber'
        ? 'bg-amber-100 text-amber-700 ring-amber-200/70'
        : accent === 'pink'
          ? 'bg-rose-100 text-rose-700 ring-rose-200/70'
          : accent === 'blue'
            ? 'bg-blue-100 text-blue-700 ring-blue-200/70'
            : 'bg-slate-100 text-slate-700 ring-slate-200/70';

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={clsx(
            'grid h-11 w-11 shrink-0 place-items-center rounded-2xl ring-1',
            accentClass,
          )}
        >
          {icon}
        </div>

        <div className="min-w-0">
          <p className="truncate text-2xl font-bold tracking-tight text-slate-950">
            {value.toLocaleString()}
          </p>
          <p className="mt-0.5 truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </p>
        </div>
      </div>
    </div>
  );
}

function EditProfileModal({
  open,
  onClose,
  profile,
}: {
  open: boolean;
  onClose: () => void;
  profile: MyProfile;
}) {
  const update = useUpdateMyProfile();
  const [name, setName] = useState(profile.full_name || profile.name || '');
  const [phone, setPhone] = useState(profile.phone || '');

  useEffect(() => {
    if (!open) return;

    setName(profile.full_name || profile.name || '');
    setPhone(profile.phone || '');
  }, [open, profile]);

  function save() {
    update.mutate(
      { full_name: name, phone },
      {
        onSuccess: () => {
          toast.success('Profile updated');
          onClose();
        },
        onError: (error: any) => {
          toast.error(error?.response?.data?.error?.message || 'Could not update profile');
        },
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Profile"
      description="You can update your display name and phone number."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={update.isPending} onClick={save}>
            Save Profile
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <label className="block space-y-1.5 text-sm">
          <span className="font-semibold text-slate-700">Name</span>
          <input
            className="input w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="block space-y-1.5 text-sm">
          <span className="font-semibold text-slate-700">Phone</span>
          <input
            className="input w-full"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
          Email, role, and CP ID are managed by admin and cannot be changed here.
        </div>
      </div>
    </Modal>
  );
}

function StatusBadge({ value }: { value?: string | null }) {
  const active = value === 'active';

  return (
    <span className={active ? 'chip-green shrink-0' : 'chip-slate shrink-0'}>
      {value || 'Unknown'}
    </span>
  );
}

function AvailabilityBadge({ value }: { value?: string | null }) {
  const available = value === 'available';

  return (
    <span className={available ? 'chip-green shrink-0' : 'chip-amber shrink-0'}>
      {value || 'Not provided'}
    </span>
  );
}