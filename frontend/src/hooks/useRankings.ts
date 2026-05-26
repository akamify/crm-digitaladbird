'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';

export interface RankLabel {
  pos: number;
  emoji: string;
  label: string;
}

export interface RankedEntry {
  id: string;
  user_id: string;
  rank_date: string;
  scope: string;
  team_name: string | null;
  rank_position: number;
  prev_position: number | null;
  score: string;
  leads_total: number;
  leads_converted: number;
  calls_made: number;
  followups_done: number;
  avg_response_hrs: string;
  conv_rate: string;
  movement: 'up' | 'down' | 'new' | 'stable';
  full_name: string;
  email: string;
  role: string;
  user_team: string | null;
  recent_appreciations: string;
  latest_badges: Array<{ badge_type: string; note: string; from_name: string; created_at: string }> | null;
  rank_label: RankLabel | null;
  badge_emoji: Record<string, string>;
}

export interface RankHistory {
  rank_date: string;
  rank_position: number;
  prev_position: number | null;
  score: string;
  leads_converted: number;
  calls_made: number;
  followups_done: number;
  conv_rate: string;
  movement: string;
}

export interface MyRank {
  scope: string;
  rank_position: number;
  prev_position: number | null;
  score: string;
  movement: string;
  rank_date: string;
}

export interface BadgeCount {
  badge_type: string;
  count: string;
}

export interface UserBadge {
  rank: { rank_position: number; score: string; movement: string; scope: string } | null;
  label: RankLabel | null;
  badges: BadgeCount[];
  badge_map: Record<string, string>;
}

export interface RmInsights {
  top_members: RankedEntry[];
  weak_members: Array<{ id: string; full_name: string; team_name: string; leads_total: number; leads_converted: number; calls_made: number }>;
  best_converter: { id: string; full_name: string; conversions: string; total: string } | null;
  most_active: { id: string; full_name: string; activity: string } | null;
  rank_labels: RankLabel[];
}

export type RankScope = 'member' | 'partner' | 'rm' | 'team' | 'overall';
export type RankPeriod = 'today' | 'week' | 'month';

export function useRankings(scope: RankScope, period: RankPeriod = 'today') {
  return useQuery({
    queryKey: ['rankings', scope, period],
    queryFn: () => apiGet<RankedEntry[]>(`/rankings/${scope}?period=${period}`),
    refetchInterval: 60000,
  });
}

export function useMyRank() {
  return useQuery({
    queryKey: ['rankings', 'my'],
    queryFn: () => apiGet<{ ranks: MyRank[]; badges: BadgeCount[] }>('/rankings/my'),
    refetchInterval: 60000,
  });
}

export function useRankHistory(userId: string, scope: RankScope = 'overall', days = 30) {
  return useQuery({
    queryKey: ['rankings', 'history', userId, scope, days],
    queryFn: () => apiGet<{ history: RankHistory[]; growth_pct: number; current_rank: number | null }>(
      `/rankings/user-history/${userId}?scope=${scope}&days=${days}`
    ),
    enabled: !!userId,
  });
}

export function useUserBadge(userId: string) {
  return useQuery({
    queryKey: ['rankings', 'badge', userId],
    queryFn: () => apiGet<UserBadge>(`/rankings/user-badge/${userId}`),
    enabled: !!userId,
    staleTime: 120000,
  });
}

export function useRmInsights() {
  return useQuery({
    queryKey: ['rankings', 'rm-insights'],
    queryFn: () => apiGet<RmInsights>('/rankings/rm-insights'),
    refetchInterval: 60000,
  });
}

export function useComputeRankings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ computed: number; date: string }>('/rankings/compute'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rankings'] }),
  });
}

export function useGiveAppreciation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { to_user_id: string; badge_type: string; note?: string }) => apiPost('/appreciations', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rankings'] });
      qc.invalidateQueries({ queryKey: ['appreciations'] });
    },
  });
}

export function useAppreciations(userId: string) {
  return useQuery({
    queryKey: ['appreciations', userId],
    queryFn: () => apiGet<{
      appreciations: Array<{ id: string; badge_type: string; note: string | null; from_name: string; created_at: string }>;
      summary: BadgeCount[];
    }>(`/appreciations/${userId}`),
    enabled: !!userId,
  });
}

export const RANK_LABELS: RankLabel[] = [
  { pos: 1,  emoji: '⭐', label: 'Superstar Performer' },
  { pos: 2,  emoji: '👑', label: 'Excellent Leader' },
  { pos: 3,  emoji: '🔥', label: 'Great Performer' },
  { pos: 4,  emoji: '🚀', label: 'Rising Star' },
  { pos: 5,  emoji: '💎', label: 'Smart Worker' },
  { pos: 6,  emoji: '🎯', label: 'Fast Responder' },
  { pos: 7,  emoji: '⚡', label: 'Active Performer' },
  { pos: 8,  emoji: '🏆', label: 'Team Player' },
  { pos: 9,  emoji: '🌟', label: 'Consistent Worker' },
  { pos: 10, emoji: '🎉', label: 'Good Performer' },
];

export const BADGE_MAP: Record<string, { emoji: string; label: string; color: string }> = {
  star:          { emoji: '⭐', label: 'Star',          color: 'bg-amber-100 text-amber-700' },
  excellent:     { emoji: '🔥', label: 'Excellent',     color: 'bg-orange-100 text-orange-700' },
  good_work:     { emoji: '👏', label: 'Good Work',     color: 'bg-green-100 text-green-700' },
  outstanding:   { emoji: '💎', label: 'Outstanding',   color: 'bg-violet-100 text-violet-700' },
  fast_worker:   { emoji: '🚀', label: 'Fast Worker',   color: 'bg-blue-100 text-blue-700' },
  top_closer:    { emoji: '🏆', label: 'Top Closer',    color: 'bg-yellow-100 text-yellow-700' },
  best_followup: { emoji: '🎯', label: 'Best Followup', color: 'bg-rose-100 text-rose-700' },
};
