'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/api';

export interface ResetTokenStatus {
  valid: true;
  email: string;
  expiresAt: string;
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) => apiPost<{ message?: string }>('/auth/forgot-password', { email }),
  });
}

export function useVerifyResetToken(token: string | null) {
  return useQuery({
    queryKey: ['auth', 'reset-token', token],
    queryFn: () => apiGet<ResetTokenStatus>('/auth/reset-password/verify', { token }),
    enabled: Boolean(token),
    retry: false,
    staleTime: 30_000,
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { token: string; password: string; confirmPassword: string }) =>
      apiPost<void>('/auth/reset-password', input),
  });
}
