'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Users, UserCheck, UserX, RefreshCw,
  Pencil, ShieldBan, ShieldCheck, Award, Phone, Mail, UserRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { Modal, PageLoader } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useUsers, useUpdateLeadAvailability, useUpdateUser } from '@/hooks/useUsers';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { clsx, initials, humanize, fmtPhone } from '@/lib/format';
import type { User, MemberType } from '@/types';

/* ---------- types ---------- */
interface TeamLeadCount { user_id: string; category: string; count: string }

interface RMCard {
  rm: User;
  members: User[];
  freshers: number;
  veterans: number;
  partnerLeads: number;
  traderLeads: number;
  totalLeads: number;
}

/* ---------- page ---------- */
export default function RMTeamsPage() {
  const { user } = useAuth();
  const { data: users, isLoading: usersLoading, isFetching: usersFetching, refetch: refetchUsers } = useUsers();
  const { data: teamLeads, isLoading: leadsLoading, isFetching: leadsFetching, refetch: refetchLeads } = useQuery({
    queryKey: ['team-leads'],
    queryFn: () => apiGet<TeamLeadCount[]>('/reports/team-leads'),
    enabled: user?.role === 'super_admin',
  });

  const loading = usersLoading || (user?.role === 'super_admin' && leadsLoading);
  const [selectedTeam, setSelectedTeam] = useState<RMCard | null>(null);

  const rmCards = useMemo(() => {
    if (!users) return [];
    const rms = users.filter(u => u.role === 'rm');
    const leadMap = new Map<string, { partner: number; trader: number }>();

    for (const tl of teamLeads || []) {
      const existing = leadMap.get(tl.user_id) || { partner: 0, trader: 0 };
      if (tl.category === 'partner') existing.partner = parseInt(tl.count, 10);
      else if (tl.category === 'trader') existing.trader = parseInt(tl.count, 10);
      leadMap.set(tl.user_id, existing);
    }

    return rms.map(rm => {
      const members = users.filter(u => u.report_to_id === rm.id && u.role === 'member');
      const freshers = members.filter(m => m.member_type === 'fresher').length;
      const veterans = members.filter(m => m.member_type === 'veteran').length;

      // Sum leads for RM + all team members
      let partnerLeads = 0, traderLeads = 0;
      const teamIds = [rm.id, ...members.map(m => m.id)];
      for (const uid of teamIds) {
        const lc = leadMap.get(uid);
        if (lc) { partnerLeads += lc.partner; traderLeads += lc.trader; }
      }

      return {
        rm,
        members,
        freshers,
        veterans,
        partnerLeads,
        traderLeads,
        totalLeads: partnerLeads + traderLeads,
      } satisfies RMCard;
    }).sort((a, b) => b.members.length - a.members.length);
  }, [users, teamLeads]);

  return (
    <AppShell title="RM Teams" subtitle="View and manage RM teams" roles={['super_admin', 'rm']}>
      {loading ? <PageLoader /> : <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-lg font-semibold text-slate-950">Teams</h1><p className="text-sm text-slate-500">Select a team to view members and availability.</p></div><button onClick={() => { refetchUsers(); if (user?.role === 'super_admin') refetchLeads(); }} disabled={usersFetching || leadsFetching} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm"><RefreshCw className={clsx('h-4 w-4', (usersFetching || leadsFetching) && 'animate-spin')} />Refresh</button></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rmCards.map(card => (
            <RMCardWidget key={card.rm.id} card={card} onOpen={() => setSelectedTeam(card)} />
          ))}
        </div>
        {!rmCards.length && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No RM teams found.</div>}
        <TeamDetailModal card={selectedTeam} onClose={() => setSelectedTeam(null)} />
      </div>}
    </AppShell>
  );
}

/* ---------- RM Card ---------- */
function RMCardWidget({ card, onOpen }: { card: RMCard; onOpen: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      {/* Header */}
      <button
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-glow">
          {initials(card.rm.full_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-slate-900">{card.rm.full_name}</span>
            <span className="chip-blue text-[10px]">RM</span>
          </div>
          <div className="mt-0.5 text-xs text-slate-500">{card.rm.team_name || 'No team name'}</div>
        </div>
        <span className="text-xs font-medium text-brand-600">View team</span>
      </button>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-px border-t border-slate-100 bg-slate-100">
        <Stat label="Members" value={card.members.length} icon={<Users className="h-3.5 w-3.5" />} />
        <Stat label="Freshers" value={card.freshers} icon={<UserCheck className="h-3.5 w-3.5" />} />
        <Stat label="Veterans" value={card.veterans} icon={<Award className="h-3.5 w-3.5" />} />
      </div>
      <div className="grid grid-cols-3 gap-px border-t border-slate-100 bg-slate-100">
        <Stat label="Partners" value={card.partnerLeads} color="text-blue-600" />
        <Stat label="Traders" value={card.traderLeads} color="text-amber-600" />
        <Stat label="Total Leads" value={card.totalLeads} color="text-brand-600" />
      </div>

    </div>
  );
}

function TeamDetailModal({ card, onClose }: { card: RMCard | null; onClose: () => void }) {
  return <Modal open={!!card} onClose={onClose} title={card?.rm.team_name || 'Team Details'} description={card ? `Relationship Manager: ${card.rm.full_name}` : undefined} size="xl">{card && <div className="space-y-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Members" value={card.members.length} /><Stat label="Partner Leads" value={card.partnerLeads} /><Stat label="Trader Leads" value={card.traderLeads} /><Stat label="Total Leads" value={card.totalLeads} /></div><div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Members and availability</h3>{card.members.length ? <div className="space-y-2">{card.members.map(member => <MemberRow key={member.id} member={member} />)}</div> : <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">No members assigned to this team.</p>}</div></div>}</Modal>;
}

/* ---------- Stat mini cell ---------- */
function Stat({ label, value, icon, color }: { label: string; value: number; icon?: React.ReactNode; color?: string }) {
  return (
    <div className="flex flex-col items-center bg-white px-3 py-2.5">
      <div className={clsx('text-lg font-bold tabular-nums', color || 'text-slate-900')}>{value}</div>
      <div className="mt-0.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {icon}{label}
      </div>
    </div>
  );
}

/* ---------- Member Row ---------- */
function MemberRow({ member }: { member: User }) {
  const [editOpen, setEditOpen] = useState(false);
  const updateAvailability = useUpdateLeadAvailability();

  const isBlocked = member.is_active === false;
  const leadStatus = member.lead_assignment_status || (member.is_available === false ? 'unavailable' : isBlocked ? 'blocked' : 'available');

  const handleBlock = () => {
    if (confirm(`Block "${member.full_name}" from lead distribution?`)) {
      updateAvailability.mutate({ userId: member.id, status: 'blocked', reason: 'Blocked from RM team page' }, {
        onSuccess: () => toast.success('Lead availability updated'),
      });
    }
  };

  const handleActivate = () => {
    updateAvailability.mutate({ userId: member.id, status: 'available', reason: '' }, {
      onSuccess: () => toast.success('Lead availability updated'),
    });
  };

  return (
    <>
      <div className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition hover:bg-slate-50">
        {/* Avatar */}
        <div className={clsx(
          'grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold',
          isBlocked ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600',
        )}>
          {initials(member.full_name)}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-slate-800">{member.full_name}</span>
            {member.member_type && (
              <span className={member.member_type === 'fresher' ? 'chip-amber' : 'chip-blue'}>
                {humanize(member.member_type)}
              </span>
            )}
            {isBlocked && <span className="chip-red">Blocked</span>}
            <span className={leadStatus === 'available' ? 'chip-green' : leadStatus === 'unavailable' ? 'chip-amber' : 'chip-red'}>
              {humanize(leadStatus)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
            {member.phone && (
              <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" />{fmtPhone(member.phone)}</span>
            )}
            {member.email && (
              <span className="flex items-center gap-0.5"><Mail className="h-3 w-3" />{member.email}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
          {leadStatus !== 'available' && (
            <button
              onClick={handleActivate}
              className="rounded-md p-1.5 text-green-500 hover:bg-green-50 hover:text-green-700"
              title="Mark available"
              disabled={updateAvailability.isPending}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
            </button>
          )}
          {leadStatus === 'available' && (
            <button
              onClick={() => updateAvailability.mutate({ userId: member.id, status: 'unavailable', reason: 'Marked unavailable from RM team page' }, {
                onSuccess: () => toast.success('Lead availability updated'),
              })}
              className="rounded-md p-1.5 text-amber-500 hover:bg-amber-50 hover:text-amber-700"
              title="Mark unavailable"
              disabled={updateAvailability.isPending}
            >
              <UserX className="h-3.5 w-3.5" />
            </button>
          )}
          <Link
            href={`/dashboard/admin/users/${member.id}`}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
            title="Open profile"
          >
            <UserRound className="h-3.5 w-3.5" />
          </Link>
          <button
            onClick={() => setEditOpen(true)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {leadStatus !== 'blocked' && (
            <button
              onClick={handleBlock}
              className="rounded-md p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"
              title="Block"
              disabled={updateAvailability.isPending}
            >
              <ShieldBan className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {editOpen && (
        <EditMemberModal member={member} open={editOpen} onClose={() => setEditOpen(false)} />
      )}
    </>
  );
}

/* ---------- Edit Modal ---------- */
function EditMemberModal({ member, open, onClose }: { member: User; open: boolean; onClose: () => void }) {
  const updateUser = useUpdateUser();
  const [form, setForm] = useState({
    full_name: member.full_name,
    phone: member.phone || '',
    email: member.email || '',
    member_type: (member.member_type || '') as string,
    daily_lead_cap: member.daily_lead_cap?.toString() || '',
    is_available: member.is_available !== false,
  });

  const set = (key: string, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSave = () => {
    updateUser.mutate(
      {
        id: member.id,
        full_name: form.full_name,
        phone: form.phone || undefined,
        email: form.email || undefined,
        member_type: (form.member_type || null) as MemberType | null,
        daily_lead_cap: form.daily_lead_cap ? parseInt(form.daily_lead_cap, 10) : null,
        is_available: form.is_available,
      } as any,
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit — ${member.full_name}`}
      description="Update member details"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={updateUser.isPending} onClick={handleSave}>Save</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="Full Name" value={form.full_name} onChange={e => set('full_name', e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Phone" value={form.phone} onChange={e => set('phone', e.target.value)} />
          <Input label="Email" value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Member Type"
            value={form.member_type}
            onChange={e => set('member_type', e.target.value)}
            options={[
              { value: 'fresher', label: 'Fresher' },
              { value: 'veteran', label: 'Veteran' },
            ]}
            placeholder="Select type"
          />
          <Input
            label="Daily Lead Cap"
            type="number"
            value={form.daily_lead_cap}
            onChange={e => set('daily_lead_cap', e.target.value)}
            placeholder="No limit"
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={form.is_available}
            onChange={e => set('is_available', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm text-slate-700">Available for lead distribution</span>
        </label>
      </div>
    </Modal>
  );
}
