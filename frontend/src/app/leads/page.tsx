'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Eye, Inbox, Lock, Mail, MessageCircle, MessageSquarePlus, MoreVertical, Phone, Plus, ScrollText, Tag, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { AppShell } from '@/components/layout/AppShell';
import { LeadCategoryBadge } from '@/components/leads/LeadCategoryBadge';
import { LeadCommunicationPanel } from '@/components/leads/LeadCommunicationPanel';
import { LeadFilters } from '@/components/leads/LeadFilters';
import { RemarkModal } from '@/components/leads/RemarkModal';
import { LeadLabelPickerModal } from '@/components/leads/LeadLabelPickerModal';
import { AddLeadModal } from '@/components/leads/AddLeadModal';
import { EmptyState, Modal, Skeleton, StatusChip } from '@/components/ui/Modal';
import { useDeleteAllLeads } from '@/hooks/useAdmin';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useBulkAddRemark, useDeleteLead, useLeadList } from '@/hooks/useLeads';
import { formatISTCompact, formatISTTooltip, formatStageUpdatedAt } from '@/lib/date';
import { clsx, fmtPhone, humanize, isDueToday, isOverdue, stageChip } from '@/lib/format';
import { triggerPhoneCall } from '@/lib/phone';
import { useAuth } from '@/lib/auth';
import { LEAD_REMARK_GROUPS } from '@/constants/leadRemarkOptions';
import type {
  CallStatus,
  Lead,
  LeadAllTimeMetric,
  LeadDailyMetric,
  LeadFilters as LeadFilterType,
  LeadViewMode,
} from '@/types';

type CommunicationTab = 'chat' | 'calls';

const DAILY_METRIC_OPTIONS: Array<{ key: LeadDailyMetric; label: string; hint: string }> = [
  { key: 'received', label: 'Leads Received', hint: 'Leads created on the selected date.' },
  { key: 'worked', label: 'Worked', hint: 'Selected-date received leads with CRM activity on that date.' },
  { key: 'pending', label: 'Pending', hint: 'Selected-date received leads that still needed action on that date.' },
  { key: 'personal_meeting', label: 'Meeting Attended', hint: 'Selected-date received leads with a Personal Meeting recorded that date.' },
  { key: 'session_9pm', label: '9:00 PM Session', hint: 'Selected-date received leads marked 9:00 Session Attend that date.' },
  { key: 'call_issues', label: 'Call Issues', hint: 'Selected-date received leads with a current unresolved retryable call issue.' },
];

const ALL_TIME_METRIC_OPTIONS: Array<{ key: LeadAllTimeMetric; label: string; hint: string }> = [
  { key: 'all', label: 'All Leads', hint: 'All active leads matching the current filters.' },
  { key: 'worked', label: 'Worked', hint: 'Leads with any saved call, remark, or workflow activity.' },
  { key: 'pending', label: 'Pending', hint: 'Currently assigned leads with an overdue actionable obligation.' },
  { key: 'personal_meeting', label: 'Meeting Attended', hint: 'Leads with a Personal Meeting recorded at any time.' },
  { key: 'session_9pm', label: '9:00 PM Session', hint: 'Leads ever marked 9:00 Session Attend.' },
  { key: 'call_issues', label: 'Call Issues', hint: 'Currently assigned leads with an unresolved retryable call issue.' },
];

const SUPER_ADMIN_REMOVED_FILTERS = new Set([
  'from',
  'to',
  'created_preset',
  'pending',
  'unworked',
  'assigned_today',
  'no_remark',
  'note_type',
  'note_category',
  'priority',
  'has_rm_update',
  'updated_by_rm',
  'session_attendance',
]);

function businessToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftBusinessDate(date: string, offset: number) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function displayBusinessDate(date: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function leadDailyMetric(value: string | null): LeadDailyMetric {
  return DAILY_METRIC_OPTIONS.some(option => option.key === value) ? value as LeadDailyMetric : 'received';
}

function leadAllTimeMetric(value: string | null): LeadAllTimeMetric {
  return ALL_TIME_METRIC_OPTIONS.some(option => option.key === value) ? value as LeadAllTimeMetric : 'all';
}

function leadViewMode(value: string | null, hasSelectedDate: boolean): LeadViewMode {
  if (value === 'daily' || value === 'all_time') return value;
  return hasSelectedDate ? 'daily' : 'all_time';
}

function leadDailyDate(value: string | null) {
  const candidate = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate) || candidate > businessToday()) return businessToday();
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate ? candidate : businessToday();
}
type DeleteAllLeadScope =
  | 'all'
  | 'unworked'
  | 'worked'
  | 'unassigned'
  | 'assigned'
  | 'pending'
  | 'today_assigned'
  | 'today_created'
  | 'yesterday_created'
  | 'day_before_created';

const DELETE_ALL_SCOPE_OPTIONS: Array<{ value: DeleteAllLeadScope; label: string; hint: string }> = [
  { value: 'all', label: 'All Leads', hint: 'Delete every active lead in CRM.' },
  { value: 'unworked', label: 'Unworked Leads', hint: 'Delete leads with no remark or workflow action yet.' },
  { value: 'worked', label: 'Worked Leads', hint: 'Delete leads that already have call activity, remark, or workflow work.' },
  { value: 'unassigned', label: 'Unassigned Leads', hint: 'Delete only leads that are not assigned to any user.' },
  { value: 'assigned', label: 'Assigned Leads', hint: 'Delete only leads that are already assigned to a user.' },
  { value: 'pending', label: 'Pending Work', hint: 'Delete leads still counted in pending-work queues.' },
  { value: 'today_assigned', label: 'Today Assigned', hint: 'Delete leads assigned today in IST.' },
  { value: 'today_created', label: 'Today Leads', hint: 'Delete leads created today in IST.' },
  { value: 'yesterday_created', label: 'Yesterday Leads', hint: 'Delete leads created yesterday in IST.' },
  { value: 'day_before_created', label: 'Day Before Leads', hint: 'Delete leads created two days ago in IST.' },
];

function followupChipClass(state?: Lead['followup_state']) {
  if (state === 'overdue') return 'chip-red';
  if (state === 'today') return 'chip-amber';
  if (state === 'upcoming') return 'chip-blue';
  return 'chip-slate';
}

function workflowLabel(lead: Lead) {
  if (lead.workflow_is_step_1_completed) return lead.workflow_unlocked_step && lead.workflow_unlocked_step >= 2 ? 'Step 2 Unlocked' : 'Step 1 Completed';
  return lead.workflow_step_1_status ? 'Step 1 Pending' : 'No workflow';
}

function latestStatus(lead: Lead) {
  return lead.latest_remark_status || lead.latest_remark_call_status || lead.call_status || lead.stage || '';
}

function latestStatusList(lead: Lead) {
  const values = Array.isArray(lead.latest_remark_statuses) && lead.latest_remark_statuses.length
    ? lead.latest_remark_statuses
    : latestStatus(lead) ? [latestStatus(lead)] : [];
  return [...new Set(values.filter(Boolean))].slice(0, 4);
}

function displayLeadName(lead: Pick<Lead, 'full_name' | 'email' | 'phone'>) {
  const fullName = String(lead.full_name || '').trim();
  if (fullName) return fullName;

  const email = String(lead.email || '').trim();
  if (email.includes('@')) {
    const localPart = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
    if (localPart) {
      return localPart.replace(/\b\w/g, char => char.toUpperCase());
    }
  }

  const digits = String(lead.phone || '').replace(/\D/g, '');
  if (digits) return `Lead ${digits.slice(-4)}`;
  return 'No name';
}

function inferDeleteScopeFromFilters(filters: LeadFilterType, isAdminLeadsView: boolean): DeleteAllLeadScope {
  if (!isAdminLeadsView) return 'all';
  if (filters.pending === 'true') return 'pending';
  if (filters.unworked === 'true') return 'unworked';
  if (filters.assigned_today === 'true') return 'today_assigned';
  if (filters.created_preset === 'today') return 'today_created';
  if (filters.created_preset === 'yesterday') return 'yesterday_created';
  if (filters.created_preset === 'day_before') return 'day_before_created';
  if (filters.assignment === 'unassigned') return 'unassigned';
  if (filters.assignment === 'assigned') return 'assigned';
  return 'all';
}

function LeadRowActionsMenu({
  phone,
  isRmUser,
  onCall,
  onChat,
  onCreateNotes,
  onAddPersonalMeeting,
  onAddRemark,
  onDelete,
}: {
  phone?: string | null;
  isRmUser: boolean;
  onCall: () => void;
  onChat: () => void;
  onCreateNotes: () => void;
  onAddPersonalMeeting: () => void;
  onAddRemark: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hasPhone = Boolean(String(phone || '').trim());

  useEffect(() => {
    if (!open) return undefined;

    function handlePointer(event: MouseEvent | TouchEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  function runAndClose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div
      ref={menuRef}
      className="relative inline-flex"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Open lead actions"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
      >
        <MoreVertical className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-52 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-200/80">
          <button
            type="button"
            disabled={!hasPhone}
            onClick={() => runAndClose(onCall)}
            className={clsx(
              'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition',
              hasPhone ? 'text-slate-700 hover:bg-blue-50 hover:text-blue-700' : 'cursor-not-allowed text-slate-300'
            )}
          >
            <Phone className="h-4 w-4" />
            <span>Call now</span>
          </button>
          <button
            type="button"
            onClick={() => runAndClose(onAddPersonalMeeting)}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
          >
            <CalendarDays className="h-4 w-4" />
            <span>Add Personal Meeting</span>
          </button>
          <button
            type="button"
            onClick={() => runAndClose(onChat)}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
          >
            <MessageCircle className="h-4 w-4" />
            <span>Chat here</span>
          </button>
          <button
            type="button"
            onClick={() => runAndClose(onCreateNotes)}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-amber-50 hover:text-amber-700"
          >
            <ScrollText className="h-4 w-4" />
            <span>Create notes</span>
          </button>
          <button
            type="button"
            onClick={() => runAndClose(onAddRemark)}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-violet-50 hover:text-violet-700"
          >
            <MessageSquarePlus className="h-4 w-4" />
            <span>{isRmUser ? 'Add RM update' : 'Add remark'}</span>
          </button>
          {onDelete && (
            <>
              <div className="my-1 h-px bg-slate-100" />
              <button
                type="button"
                onClick={() => runAndClose(onDelete)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50"
              >
                <Trash2 className="h-4 w-4" />
                <span>Delete lead</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LeadMetricFilterRow({
  viewMode,
  selectedDate,
  selectedMetric,
  options,
  loading,
  onViewChange,
  onDateChange,
  onMetricChange,
}: {
  viewMode: LeadViewMode;
  selectedDate: string;
  selectedMetric: string;
  options: Array<{ key: string; label: string; hint: string; value?: number }>;
  loading: boolean;
  onViewChange: (mode: LeadViewMode) => void;
  onDateChange: (date: string) => void;
  onMetricChange: (metric: string) => void;
}) {
  const today = businessToday();

  return (
    <section className="overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 via-white to-amber-50 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-100 bg-white/80 p-1">
          {([
            ['all_time', 'All Time Leads'],
            ['daily', 'Daily Lead View'],
          ] as Array<[LeadViewMode, string]>).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onViewChange(mode)}
              className={clsx(
                'rounded-lg px-3 py-2 text-xs font-semibold transition',
                viewMode === mode ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-blue-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {viewMode === 'daily' ? (
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => onDateChange(shiftBusinessDate(selectedDate, -1))}
              className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100"
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-36 px-2 text-center text-sm font-semibold text-slate-800">{displayBusinessDate(selectedDate)}</div>
            <button
              type="button"
              disabled={selectedDate >= today}
              onClick={() => onDateChange(shiftBusinessDate(selectedDate, 1))}
              className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onDateChange(today)}
              className={clsx(
                'ml-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                selectedDate === today ? 'bg-brand-600 text-white' : 'text-brand-700 hover:bg-brand-50',
              )}
            >
              Today
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-500 shadow-sm">
            Complete CRM history
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 xl:grid-cols-6">
        {options.map(option => {
          const active = selectedMetric === option.key;
          return (
            <button
              key={option.key}
              type="button"
              title={option.hint}
              onClick={() => onMetricChange(option.key)}
              className={clsx(
                'min-h-[78px] rounded-xl border px-3 py-2.5 text-left transition',
                active
                  ? 'border-brand-500 bg-brand-600 text-white shadow-md shadow-blue-200'
                  : 'border-white bg-white/90 text-slate-800 shadow-sm hover:border-brand-200 hover:bg-white',
              )}
            >
              <div className={clsx('text-[10px] font-semibold uppercase tracking-wide', active ? 'text-blue-100' : 'text-slate-500')}>{option.label}</div>
              <div className="mt-1.5 text-xl font-bold tabular-nums">{loading || option.value === undefined ? '...' : Number(option.value).toLocaleString()}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function LeadsPage() {
  return (
    <AppShell title="Leads" subtitle="Browse, filter, and action your assigned leads">
      <LeadsInner />
    </AppShell>
  );
}

function LeadsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user } = useAuth();
  const isSuperAdminLeadsView = user?.role === 'super_admin';
  const initial = useMemo<LeadFilterType>(() => ({
    q: sp.get('q') || '',
    category: (sp.get('category') as LeadFilterType['category']) || '',
    stage: (sp.get('stage') as LeadFilterType['stage']) || '',
    call_status: (sp.get('call_status') as LeadFilterType['call_status']) || '',
    followup: (sp.get('followup') as LeadFilterType['followup']) || '',
    reassignment: (sp.get('reassignment') as LeadFilterType['reassignment']) || '',
    assignment: (sp.get('assignment') as LeadFilterType['assignment']) || '',
    assigned_today: (sp.get('assigned_today') as LeadFilterType['assigned_today']) || '',
    pending: (sp.get('pending') as LeadFilterType['pending']) || '',
    unworked: (sp.get('unworked') as LeadFilterType['unworked']) || '',
    created_preset: (sp.get('created_preset') as LeadFilterType['created_preset']) || '',
    label_id: sp.get('label_id') || '',
    remark_status: (sp.get('remark_status') as LeadFilterType['remark_status']) || '',
    note_type: (sp.get('note_type') as LeadFilterType['note_type']) || '',
    note_category: (sp.get('note_category') as LeadFilterType['note_category']) || '',
    priority: (sp.get('priority') as LeadFilterType['priority']) || '',
    customer_interest: (sp.get('customer_interest') as LeadFilterType['customer_interest']) || '',
    has_rm_update: (sp.get('has_rm_update') as LeadFilterType['has_rm_update']) || '',
    updated_by_rm: sp.get('updated_by_rm') || '',
    session_attendance: (sp.get('session_attendance') as LeadFilterType['session_attendance']) || '',
    workflow_status: (sp.get('workflow_status') as LeadFilterType['workflow_status']) || '',
    latest_activity: (sp.get('latest_activity') as LeadFilterType['latest_activity']) || '',
    no_remark: (sp.get('no_remark') as LeadFilterType['no_remark']) || '',
    source: sp.get('source') || '',
    from: sp.get('from') || '',
    to: sp.get('to') || '',
    selected_date: leadDailyDate(sp.get('selected_date')),
    daily_metric: leadDailyMetric(sp.get('daily_metric')),
    lead_view: leadViewMode(sp.get('lead_view'), sp.has('selected_date')),
    all_time_metric: leadAllTimeMetric(sp.get('all_time_metric')),
    page: Number(sp.get('page') || '1'),
    page_size: Number(sp.get('page_size') || '25'),
    sort: 'created_at',
    order: 'desc',
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const [filters, setFilters] = useState<LeadFilterType>(initial);
  const [communicationLead, setCommunicationLead] = useState<Lead | null>(null);
  const [communicationTab, setCommunicationTab] = useState<CommunicationTab>('chat');
  const [remarkLeadId, setRemarkLeadId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkRemarkOpen, setBulkRemarkOpen] = useState(false);
  const [bulkLabelOpen, setBulkLabelOpen] = useState(false);
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [deleteLeadItem, setDeleteLeadItem] = useState<Lead | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllConfirmation, setDeleteAllConfirmation] = useState('');
  const [deleteAllScope, setDeleteAllScope] = useState<DeleteAllLeadScope>('all');
  const [bulkRemark, setBulkRemark] = useState('');
  const [bulkStatuses, setBulkStatuses] = useState<CallStatus[]>([]);
  const debouncedSearch = useDebouncedValue(filters.q || '');
  const effectiveFilters = useMemo(() => {
    const next: LeadFilterType = { ...filters, q: debouncedSearch || undefined };
    if (isSuperAdminLeadsView) {
      delete next.from;
      delete next.to;
      delete next.created_preset;
      delete next.pending;
      delete next.unworked;
      delete next.assigned_today;
      delete next.no_remark;
      delete next.note_type;
      delete next.note_category;
      delete next.priority;
      delete next.has_rm_update;
      delete next.updated_by_rm;
      delete next.session_attendance;
      if (next.lead_view === 'daily') {
        next.selected_date = next.selected_date || businessToday();
        next.daily_metric = next.daily_metric || 'received';
        delete next.all_time_metric;
      } else {
        delete next.selected_date;
        delete next.daily_metric;
        next.all_time_metric = next.all_time_metric || 'all';
      }
      delete next.lead_view;
    } else {
      delete next.selected_date;
      delete next.daily_metric;
      delete next.lead_view;
      delete next.all_time_metric;
    }
    if (next.assignment === 'assigned') next.assigned_to = '__assigned';
    if (next.assignment === 'unassigned') next.assigned_to = '__unassigned';
    delete next.assignment;
    return next;
  }, [filters, debouncedSearch, isSuperAdminLeadsView]);
  const { data, isLoading } = useLeadList(effectiveFilters);
  const bulkAddRemark = useBulkAddRemark();
  const deleteLead = useDeleteLead();
  const deleteAllLeads = useDeleteAllLeads();
  const isAdminLeadsView = user?.role === 'super_admin' || user?.role === 'admin';
  const isMemberLeadsView = user?.role === 'member';
  const canAddManualLead = user?.role === 'super_admin' || user?.role === 'admin' || user?.role === 'rm';
  const canDeleteLead = user?.role === 'super_admin';
  const isRmUser = user?.role === 'rm';

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const page = filters.page || 1;
  const size = filters.page_size || 25;
  const pages = Math.max(1, Math.ceil(total / size));
  const selectablePageIds = rows.filter(lead => !lead.read_only_access).map(lead => lead.id);
  const allCurrentPageSelected = selectablePageIds.length > 0 && selectablePageIds.every(id => selectedIds.includes(id));
  const selectedDeleteScope = DELETE_ALL_SCOPE_OPTIONS.find(option => option.value === deleteAllScope) || DELETE_ALL_SCOPE_OPTIONS[0];
  const selectedLeadView = filters.lead_view || 'all_time';
  const selectedDailyDate = filters.selected_date || businessToday();
  const dailySummary = data?.daily_summary?.selected_date === selectedDailyDate ? data.daily_summary : undefined;
  const allTimeSummary = data?.all_time_summary;

  useEffect(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (isSuperAdminLeadsView && SUPER_ADMIN_REMOVED_FILTERS.has(key)) return;
      if (isSuperAdminLeadsView && selectedLeadView === 'all_time' && (key === 'selected_date' || key === 'daily_metric')) return;
      if (isSuperAdminLeadsView && selectedLeadView === 'daily' && key === 'all_time_metric') return;
      if (!isSuperAdminLeadsView && ['selected_date', 'daily_metric', 'lead_view', 'all_time_metric'].includes(key)) return;
      if (value !== undefined && value !== null && value !== '' && key !== 'sort' && key !== 'order') {
        params.set(key, String(value));
      }
    });
    router.replace(`/leads${params.toString() ? `?${params.toString()}` : ''}`);
  }, [filters, isSuperAdminLeadsView, router, selectedLeadView]);

  function setLeadView(mode: LeadViewMode) {
    setSelectedIds([]);
    setFilters(current => current.lead_view === mode ? current : {
      ...current,
      lead_view: mode,
      selected_date: current.selected_date || businessToday(),
      daily_metric: current.daily_metric || 'received',
      all_time_metric: current.all_time_metric || 'all',
      page: 1,
    });
  }

  function setDailyDate(date: string) {
    if (date > businessToday()) return;
    setSelectedIds([]);
    setFilters(current => current.lead_view === 'daily' && current.selected_date === date ? current : ({
      ...current,
      lead_view: 'daily',
      selected_date: date,
      daily_metric: current.daily_metric || 'received',
      page: 1,
    }));
  }

  function setDailyMetric(metric: LeadDailyMetric) {
    setSelectedIds([]);
    setFilters(current => current.lead_view === 'daily' && current.daily_metric === metric ? current : ({
      ...current,
      lead_view: 'daily',
      selected_date: current.selected_date || businessToday(),
      daily_metric: metric,
      page: 1,
    }));
  }

  function setAllTimeMetric(metric: LeadAllTimeMetric) {
    setSelectedIds([]);
    setFilters(current => current.lead_view === 'all_time' && current.all_time_metric === metric ? current : ({
      ...current,
      lead_view: 'all_time',
      all_time_metric: metric,
      page: 1,
    }));
  }

  function openCommunication(lead: Lead, tab: CommunicationTab) {
    if (tab === 'chat') {
      router.push(`/chat?leadId=${lead.id}`);
      return;
    }
    setCommunicationLead(lead);
    setCommunicationTab(tab);
  }

  function openLeadFromRow(event: React.MouseEvent<HTMLTableRowElement>, leadId: string) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('a,button,input,select,textarea,[role="button"]')) return;
    router.push(`/leads/${leadId}`);
  }

  function toggleLeadSelection(leadId: string, checked: boolean) {
    setSelectedIds(ids => checked ? [...new Set([...ids, leadId])] : ids.filter(id => id !== leadId));
  }

  function toggleCurrentPage(checked: boolean) {
    setSelectedIds(ids => checked
      ? [...new Set([...ids, ...selectablePageIds])]
      : ids.filter(id => !selectablePageIds.includes(id)));
  }

  function submitBulkRemark() {
    if (!bulkRemark.trim() && bulkStatuses.length === 0) {
      toast.error('Select at least one status or write a remark');
      return;
    }
    bulkAddRemark.mutate({
      leadIds: selectedIds,
      remark: bulkRemark.trim(),
      ...(isRmUser ? { note_type: 'rm_update' as const } : {}),
      ...(bulkStatuses.length ? { call_status: bulkStatuses[0], call_statuses: bulkStatuses } : {}),
    }, {
      onSuccess: (summary) => {
        toast.success(`Remark added to ${summary.updated} lead${summary.updated === 1 ? '' : 's'}`);
        if (summary.skipped) toast.error(`${summary.skipped} lead${summary.skipped === 1 ? '' : 's'} skipped`);
        setSelectedIds([]);
        setBulkRemark('');
        setBulkStatuses([]);
        setBulkRemarkOpen(false);
      },
      onError: (e: any) => toast.error(e?.response?.data?.error?.message || e?.response?.data?.message || 'Could not add remarks'),
    });
  }

  function toggleBulkStatus(status: CallStatus) {
    setBulkStatuses(values => values.includes(status) ? values.filter(value => value !== status) : [...values, status]);
  }

  async function confirmDeleteLead() {
    if (!deleteLeadItem) return;
    try {
      await deleteLead.mutateAsync({ id: deleteLeadItem.id });
      setSelectedIds(ids => ids.filter(id => id !== deleteLeadItem.id));
      toast.success('Lead deleted permanently.');
      setDeleteLeadItem(null);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || error?.response?.data?.message || 'Could not delete lead');
    }
  }

  async function confirmDeleteAllLeads() {
    try {
      const response = await deleteAllLeads.mutateAsync({
        confirmation: deleteAllConfirmation.trim(),
        scope: deleteAllScope,
      });
      const scopeLabel = response.scope_label || selectedDeleteScope.label;
      toast.success(`${response.deleted_count} ${scopeLabel.toLowerCase()} deleted permanently.`);
      setSelectedIds([]);
      setDeleteAllConfirmation('');
      setDeleteAllScope('all');
      setDeleteAllOpen(false);
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || error?.response?.data?.message || 'Could not delete all leads');
    }
  }

  return (
    <div className="space-y-4">
      {(canAddManualLead || user?.role === 'member' || user?.role === 'partner') && (
        <div className="flex justify-end gap-2">
          {canDeleteLead && (
            <button
              type="button"
              onClick={() => {
                setDeleteAllScope(inferDeleteScopeFromFilters(filters, isAdminLeadsView));
                setDeleteAllOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
            >
              <Trash2 className="h-4 w-4" /> Delete All Leads
            </button>
          )}
          <Link
            href="/notes"
            className="btn-outline inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          >
            <ScrollText className="h-4 w-4" /> Latest Notes
          </Link>
          <Link
            href="/personal-meetings"
            className="btn-outline inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
          >
            <CalendarDays className="h-4 w-4" /> Personal Meeting
          </Link>
          {canAddManualLead && (
            <button
              type="button"
              onClick={() => setAddLeadOpen(true)}
              className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm"
            >
              <Plus className="h-4 w-4" /> Add Lead
            </button>
          )}
        </div>
      )}

      {isSuperAdminLeadsView ? (
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
          {[
            { key: 'all', label: 'Leads', assignment: '' },
            { key: 'unassigned', label: 'Unassigned Leads', assignment: 'unassigned' },
            { key: 'assigned', label: 'Assigned Leads', assignment: 'assigned' },
          ].map(tab => {
            const active = (filters.assignment || '') === tab.assignment;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setSelectedIds([]);
                  setFilters(current => ({
                    ...current,
                    assignment: tab.assignment as LeadFilterType['assignment'],
                    page: 1,
                  }));
                }}
                className={clsx(
                  'rounded-lg px-3 py-2 text-sm font-medium transition',
                  active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : isAdminLeadsView ? (
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
          {[
            { key: 'all', label: 'Leads', assignment: '' },
            { key: 'unassigned', label: 'Unassigned Leads', assignment: 'unassigned' },
            { key: 'assigned', label: 'Assigned Leads', assignment: 'assigned' },
            { key: 'pending', label: 'Pending Work', assignment: '', pending: 'true' },
            { key: 'today_assigned', label: 'Today Assigned', assignment: '', assigned_today: 'true' },
            { key: 'today_created', label: 'Today Leads', created_preset: 'today' },
            { key: 'yesterday_created', label: 'Yesterday Leads', created_preset: 'yesterday' },
            { key: 'day_before_created', label: 'Day Before Leads', created_preset: 'day_before' },
          ].map(tab => {
            const active = tab.key === 'pending'
              ? filters.pending === 'true'
              : tab.key === 'today_assigned'
              ? filters.assigned_today === 'true'
              : tab.created_preset
                ? filters.created_preset === tab.created_preset
                : (filters.assignment || '') === tab.assignment
                  && !filters.reassignment
                  && filters.pending !== 'true'
                  && filters.unworked !== 'true'
                  && filters.assigned_today !== 'true'
                  && !filters.created_preset;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilters(f => ({
                  ...f,
                  assignment: (tab.assignment || '') as LeadFilterType['assignment'],
                  assigned_today: (tab.assigned_today || '') as LeadFilterType['assigned_today'],
                  pending: (tab.pending || '') as LeadFilterType['pending'],
                  created_preset: (tab.created_preset || '') as LeadFilterType['created_preset'],
                  from: tab.created_preset ? '' : f.from,
                  to: tab.created_preset ? '' : f.to,
                  reassignment: '',
                  unworked: '',
                  page: 1,
                }))}
                className={clsx(
                  'rounded-lg px-3 py-2 text-sm font-medium transition',
                  active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
          {[
            { key: 'current', label: 'Current Leads', next: { reassignment: '', unworked: '', pending: '' } },
            { key: 'pending', label: 'Pending Work', next: { reassignment: '', unworked: '', pending: 'true' } },
            { key: 'to_me', label: 'Reassigned To Me', next: { reassignment: 'to_me', unworked: '', pending: '' } },
            ...(!isMemberLeadsView ? [{ key: 'to_others', label: 'Reassigned To Others', next: { reassignment: 'to_others', unworked: '', pending: '' } }] : []),
            { key: 'unworked', label: 'Unworked Leads', next: { reassignment: '', unworked: 'true', pending: '' } },
            { key: 'today', label: 'Today Assigned', next: { reassignment: '', unworked: '', assigned_today: 'true', pending: '' } },
          ].map(tab => {
            const active = tab.key === 'pending'
              ? filters.pending === 'true'
              : tab.key === 'unworked'
              ? filters.unworked === 'true'
              : tab.key === 'today'
                ? filters.assigned_today === 'true'
                : (filters.reassignment || '') === tab.next.reassignment && filters.pending !== 'true' && filters.unworked !== 'true' && filters.assigned_today !== 'true';
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilters(f => ({
                  ...f,
                  reassignment: tab.next.reassignment as LeadFilterType['reassignment'],
                  unworked: tab.next.unworked as LeadFilterType['unworked'],
                  pending: (tab.next.pending || '') as LeadFilterType['pending'],
                  assigned_today: (tab.next.assigned_today || '') as LeadFilterType['assigned_today'],
                  assignment: '',
                  page: 1,
                }))}
                className={clsx(
                  'rounded-lg px-3 py-2 text-sm font-medium transition',
                  active ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {isSuperAdminLeadsView && (
        <LeadMetricFilterRow
          viewMode={selectedLeadView}
          selectedDate={selectedDailyDate}
          selectedMetric={selectedLeadView === 'daily' ? filters.daily_metric || 'received' : filters.all_time_metric || 'all'}
          options={(selectedLeadView === 'daily' ? DAILY_METRIC_OPTIONS : ALL_TIME_METRIC_OPTIONS).map(option => ({
            ...option,
            value: selectedLeadView === 'daily'
              ? dailySummary?.[option.key as LeadDailyMetric]
              : allTimeSummary?.[option.key as LeadAllTimeMetric],
          }))}
          loading={isLoading}
          onViewChange={setLeadView}
          onDateChange={setDailyDate}
          onMetricChange={metric => {
            if (selectedLeadView === 'daily') setDailyMetric(metric as LeadDailyMetric);
            else setAllTimeMetric(metric as LeadAllTimeMetric);
          }}
        />
      )}

      {!isSuperAdminLeadsView && filters.reassignment === 'to_others' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          These leads were reassigned away from you or your team. You can open the profile for reference, but editing actions are disabled.
        </div>
      )}
      {!isSuperAdminLeadsView && filters.unworked === 'true' && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Unworked leads are leads with no call log or remark saved yet.
        </div>
      )}
      {!isSuperAdminLeadsView && filters.pending === 'true' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Pending work shows leads that still need active work follow-up from you based on CRM workflow metrics.
        </div>
      )}

      <LeadFilters value={filters} onChange={setFilters} simplifiedAdmin={isSuperAdminLeadsView} />

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
          <div className="font-medium text-blue-950">{selectedIds.length} lead{selectedIds.length === 1 ? '' : 's'} selected</div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button onClick={() => setBulkRemarkOpen(true)} className="btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
              <MessageSquarePlus className="h-4 w-4" /> {isRmUser ? 'Add RM Update' : 'Add Remark'}
            </button>
            <button onClick={() => setBulkLabelOpen(true)} className="btn-outline inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
              <Tag className="h-4 w-4" /> Add Labels
            </button>
            <button onClick={() => setSelectedIds([])} className="btn-ghost rounded-lg px-3 py-2 text-xs">Clear Selection</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <span className="font-semibold text-slate-900">{total.toLocaleString()}</span>
            <span className="ml-1 text-slate-500">leads</span>
          </div>
          <div className="text-xs text-slate-500">Page {page} / {pages}</div>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No leads match current filters"
            description="Try changing filters or expanding the date range."
            icon={<Inbox className="h-6 w-6" />}
          />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[1640px] table-fixed text-sm">
              <colgroup>
                <col className="w-10" />
                <col className="w-[220px]" />
                <col className="w-[190px]" />
                <col className="w-[150px]" />
                <col className="w-[160px]" />
                <col className="w-[190px]" />
                <col className="w-[140px]" />
                <col className="w-[130px]" />
                <col className="w-[270px]" />
                <col className="w-[135px]" />
                <col className="w-[120px]" />
                <col className="w-[150px]" />
                <col className="w-[115px]" />
                <col className="w-[145px]" />
                <col className="w-[115px]" />
                <col className="w-[125px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="w-10 px-4 py-2.5 font-medium">
                    <input
                      type="checkbox"
                      checked={allCurrentPageSelected}
                      onChange={event => toggleCurrentPage(event.target.checked)}
                      aria-label="Select all leads on current page"
                    />
                  </th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Lead</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Contact</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Source</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Category</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Campaign</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Stage</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Call status</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Latest interaction</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Workflow</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Session</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Assigned</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Reassigned</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Follow-up</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Created</th>
                  <th className="px-4 py-2.5 font-medium whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((lead) => {
                  const locked = Boolean(lead.locked_until && new Date(lead.locked_until) > new Date());
                  return (
                    <tr
                      key={lead.id}
                      className="table-row cursor-pointer"
                      onClick={event => openLeadFromRow(event, lead.id)}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          disabled={lead.read_only_access}
                          checked={selectedIds.includes(lead.id)}
                          onChange={event => toggleLeadSelection(lead.id, event.target.checked)}
                          aria-label={`Select ${displayLeadName(lead)}`}
                          title={lead.read_only_access ? 'Read-only reassigned lead' : undefined}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/leads/${lead.id}`} className="block">
                          <div className="flex min-w-0 items-center gap-2 font-medium text-slate-900 hover:text-brand-700">
                            <span className="truncate">{displayLeadName(lead)}</span>
                            {locked && <Lock className="h-3 w-3 text-amber-500" aria-label="Locked" />}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {[lead.city, lead.state].filter(Boolean).join(', ') || 'Not available'}
                          </div>
                          {!!lead.labels?.length && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {lead.labels.slice(0, 3).map(label => (
                                <span key={label.id} className="max-w-[90px] truncate rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: label.color }} title={label.name}>
                                  {label.name}
                                </span>
                              ))}
                              {lead.labels.length > 3 && <span className="chip-slate">+{lead.labels.length - 3}</span>}
                            </div>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Phone className="h-3 w-3 text-slate-400" />
                          <span className="tabular-nums">{fmtPhone(lead.phone)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                          <Mail className="h-3 w-3 text-slate-400" />
                          <span className="truncate" title={lead.email || undefined}>{lead.email || 'Not available'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={lead.source === 'manual' ? 'chip-blue' : 'chip-slate'}>{lead.source_label || humanize(lead.source)}</span>
                        </div>
                        {lead.source === 'manual' ? (
                          <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                            <div className="truncate" title={lead.manual_added_by_name || lead.created_by_name || undefined}>
                              Added by {lead.manual_added_by_name || lead.created_by_name || 'Not available'}
                            </div>
                            <div title={formatISTTooltip(lead.manual_added_at || lead.created_at)}>
                              {formatISTCompact(lead.manual_added_at || lead.created_at)}
                            </div>
                          </div>
                        ) : (
                          <div className="truncate text-xs text-slate-500" title={lead.campaign_label || undefined}>
                            {lead.campaign_label || 'Not available'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <LeadCategoryBadge category={lead.category} />
                          <div className="truncate text-[11px] text-slate-500">
                            {lead.category_source ? humanize(lead.category_source) : 'No category rule'}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="truncate text-sm" title={lead.campaign_name || lead.ad_name || lead.meta_form_id || 'No campaign'}>
                          {lead.campaign_name || lead.ad_name || lead.meta_form_id || 'No campaign'}
                        </div>
                        <div className="truncate text-xs text-slate-500" title={lead.adset_name || undefined}>
                          {lead.adset_name || 'Not available'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <span className={stageChip[lead.stage] || 'chip-slate'} title={formatISTTooltip(lead.stage_updated_at || lead.updated_at)}>{humanize(lead.stage)}</span>
                          <div className="truncate text-[11px] text-slate-500" title={formatISTTooltip(lead.stage_updated_at || lead.updated_at)}>
                            {formatStageUpdatedAt(lead.stage_updated_at || lead.updated_at || lead.created_at)}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusChip status={lead.call_status} /></td>
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          {latestStatus(lead) ? <StatusChip status={latestStatus(lead)} /> : <span className="chip-slate">No remark yet</span>}
                          {lead.latest_remark_source && <span className="text-[10px] text-slate-400">{humanize(lead.latest_remark_source)}</span>}
                        </div>
                        {latestStatusList(lead).length > 1 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {latestStatusList(lead).map(status => <StatusChip key={status} status={status} />)}
                          </div>
                        )}
                        <div
                          className="mt-1 line-clamp-2 text-xs text-slate-600"
                          title={lead.latest_remark_note || undefined}
                        >
                          {lead.latest_remark_note || 'No remark yet'}
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-slate-400">
                          <span className="truncate">{lead.latest_remark_by_name || 'No user'}</span>
                          <span>·</span>
                          <span title={lead.latest_remark_at ? formatISTTooltip(lead.latest_remark_at) : undefined}>
                            {lead.latest_remark_at ? formatISTCompact(lead.latest_remark_at) : 'No activity'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={lead.workflow_is_step_1_completed ? 'chip-green' : lead.workflow_step_1_status ? 'chip-amber' : 'chip-slate'}>
                          {workflowLabel(lead)}
                        </span>
                        {lead.workflow_step_1_status && (
                          <div className="mt-1 flex flex-wrap gap-1" title={humanize(lead.workflow_step_1_status)}>
                            {(lead.workflow_step_1_statuses?.length ? lead.workflow_step_1_statuses : [lead.workflow_step_1_status]).slice(0, 3).map(status => (
                              <StatusChip key={status} status={status} />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={lead.session_attendance_status === 'has_session' ? 'chip-blue' : 'chip-slate'}>
                          {lead.session_attendance_status === 'has_session' ? 'Session added' : 'No session'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="truncate" title={lead.assigned_to_name || undefined}>{lead.assigned_to_name || <span className="italic text-slate-400">Unassigned</span>}</div>
                      </td>
                      <td className="px-4 py-3">
                        {lead.read_only_access ? (
                          <span className="chip-amber">To others</span>
                        ) : lead.was_reassigned ? (
                          <span className="chip-blue">To me</span>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {(lead.latest_followup_at || lead.next_followup_at) ? (
                          <div
                            className={clsx(
                              'text-sm',
                              isOverdue(lead.latest_followup_at || lead.next_followup_at) && 'text-rose-600',
                              isDueToday(lead.latest_followup_at || lead.next_followup_at) && 'text-amber-700',
                            )}
                            title={formatISTTooltip(lead.latest_followup_at || lead.next_followup_at)}
                          >
                            <span className={followupChipClass(lead.followup_state)}>{humanize(lead.followup_state || 'upcoming')}</span>
                            <span className="mt-1 block text-xs">{formatISTCompact(lead.latest_followup_at || lead.next_followup_at)}</span>
                          </div>
                        ) : <span className="text-slate-400">Not available</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500" title={formatISTTooltip(lead.created_at)}>
                        {formatISTCompact(lead.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {lead.read_only_access ? (
                          <Link href={`/leads/${lead.id}`} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50">
                            <Eye className="h-3 w-3" /> View
                          </Link>
                        ) : (
                          <LeadRowActionsMenu
                            phone={lead.phone}
                            isRmUser={isRmUser}
                            onCall={() => {
                              triggerPhoneCall(lead.phone);
                              openCommunication(lead, 'calls');
                            }}
                            onChat={() => openCommunication(lead, 'chat')}
                            onCreateNotes={() => router.push(`/notes?leadId=${encodeURIComponent(lead.id)}&compose=1`)}
                            onAddPersonalMeeting={() => router.push(`/personal-meetings?leadId=${encodeURIComponent(lead.id)}&create=1`)}
                            onAddRemark={() => setRemarkLeadId(lead.id)}
                            onDelete={canDeleteLead ? () => setDeleteLeadItem(lead) : undefined}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <button
              disabled={page <= 1}
              onClick={() => setFilters(f => ({ ...f, page: page - 1 }))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 disabled:opacity-50 hover:bg-slate-50"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <div className="text-xs text-slate-500 sm:text-center">
              Showing {(page - 1) * size + 1}-{Math.min(page * size, total)} of {total.toLocaleString()}
            </div>
            <button
              disabled={page >= pages}
              onClick={() => setFilters(f => ({ ...f, page: page + 1 }))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 disabled:opacity-50 hover:bg-slate-50"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <Modal open={!!communicationLead} onClose={() => setCommunicationLead(null)} title="Lead Communication" size="lg">
        {communicationLead && (
          <LeadCommunicationPanel leadId={communicationLead.id} lead={communicationLead} defaultTab={communicationTab} />
        )}
      </Modal>
      {remarkLeadId && <RemarkModal leadId={remarkLeadId} mode={isRmUser ? 'rm_update' : 'default'} open={!!remarkLeadId} onClose={() => setRemarkLeadId(null)} />}
      <AddLeadModal open={addLeadOpen} onClose={() => setAddLeadOpen(false)} />
      <LeadLabelPickerModal
        open={bulkLabelOpen}
        onClose={() => setBulkLabelOpen(false)}
        mode="bulk"
        leadIds={selectedIds}
        title="Add Labels to Selected Leads"
        description={`${selectedIds.length} selected lead${selectedIds.length === 1 ? '' : 's'}`}
        onSuccess={() => setSelectedIds([])}
      />
      <Modal open={bulkRemarkOpen} onClose={() => setBulkRemarkOpen(false)} title={isRmUser ? 'Add RM Update to Selected Leads' : 'Add Remark to Selected Leads'} size="md">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">This {isRmUser ? 'RM update' : 'remark'} will be added to {selectedIds.length} selected lead{selectedIds.length === 1 ? '' : 's'} you can access.</p>
          <div>
            <label className="mb-3 block text-sm font-semibold text-slate-900">Statuses</label>
            <div className="space-y-3">
              {LEAD_REMARK_GROUPS.map(group => (
                <div key={group.key}>
                  <p className={clsx('mb-2 text-[11px] font-semibold uppercase tracking-wide', {
                    emerald: 'text-emerald-700', sky: 'text-sky-700', amber: 'text-amber-700', slate: 'text-slate-500',
                  }[group.tone])}>{group.label}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {group.options.map(option => {
                      const selected = bulkStatuses.includes(option.value as CallStatus);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => toggleBulkStatus(option.value as CallStatus)}
                          className={clsx(
                            'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                            selected ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {bulkStatuses.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {bulkStatuses.map(status => <StatusChip key={status} status={status} />)}
              </div>
            )}
          </div>
          <textarea
            className="input min-h-[120px] resize-y"
            value={bulkRemark}
            onChange={event => setBulkRemark(event.target.value)}
            placeholder="Write the remark..."
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setBulkRemarkOpen(false)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button onClick={submitBulkRemark} disabled={bulkAddRemark.isPending} className="btn-primary rounded-lg px-4 py-2 text-sm">
            {bulkAddRemark.isPending ? 'Saving...' : isRmUser ? 'Save RM Update' : 'Save Remark'}
          </button>
        </div>
      </Modal>
      <Modal
        open={!!deleteLeadItem}
        onClose={() => setDeleteLeadItem(null)}
        title="Delete Lead Permanently"
        description="This is a hard delete and cannot be undone."
        size="md"
        footer={
          <>
            <button onClick={() => setDeleteLeadItem(null)} className="btn-ghost rounded-lg px-4 py-2 text-sm">Cancel</button>
            <button
              onClick={confirmDeleteLead}
              disabled={deleteLead.isPending}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              {deleteLead.isPending ? 'Deleting...' : 'I am sure, delete'}
            </button>
          </>
        }
      >
        {deleteLeadItem && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-2">
                <div className="font-semibold">{displayLeadName(deleteLeadItem)}</div>
                <div>This will permanently delete the lead and its direct CRM history like remarks, workflow, sessions, labels, call logs, and payment attachments.</div>
                <div>Linked customer notes and chat records may remain in CRM but will no longer point to this lead.</div>
              </div>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={deleteAllOpen}
        onClose={() => {
          if (deleteAllLeads.isPending) return;
          setDeleteAllOpen(false);
          setDeleteAllConfirmation('');
          setDeleteAllScope('all');
        }}
        title="Delete Leads Permanently"
        description="Choose which lead bucket to hard delete from the CRM."
        size="md"
        footer={
          <>
            <button
              onClick={() => {
                setDeleteAllOpen(false);
                setDeleteAllConfirmation('');
                setDeleteAllScope('all');
              }}
              disabled={deleteAllLeads.isPending}
              className="btn-ghost rounded-lg px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={confirmDeleteAllLeads}
              disabled={deleteAllLeads.isPending || deleteAllConfirmation.trim().toUpperCase() !== 'DELETE ALL LEADS'}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              {deleteAllLeads.isPending ? 'Deleting all...' : 'I am sure, delete all'}
            </button>
          </>
        }
      >
        <div className="space-y-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-2">
              <div className="font-semibold">This is a hard delete for the selected lead bucket.</div>
              <div>The delete is not limited to the current page rows. It runs against the full matching bucket in CRM.</div>
              <div>Lead remarks, workflow, sessions, labels, call logs, and payment attachments linked to those leads will also be deleted.</div>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-rose-800">
              Which leads do you want to delete?
            </label>
            <select
              className="input"
              value={deleteAllScope}
              onChange={(event) => setDeleteAllScope(event.target.value as DeleteAllLeadScope)}
            >
              {DELETE_ALL_SCOPE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="text-xs text-rose-700">
              {selectedDeleteScope.hint}
            </div>
            <div className="text-xs text-rose-700">
              Current visible count for this screen: {total.toLocaleString()} lead{total === 1 ? '' : 's'}.
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-rose-800">
              Type `DELETE ALL LEADS` to continue
            </label>
            <input
              className="input"
              value={deleteAllConfirmation}
              onChange={(event) => setDeleteAllConfirmation(event.target.value)}
              placeholder="DELETE ALL LEADS"
            />
            <div className="text-xs text-rose-700">
              Final deletion scope: <strong>{selectedDeleteScope.label}</strong>.
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
