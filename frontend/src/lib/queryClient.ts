'use client';
import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: (failureCount, err: unknown) => {
          const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
          if (status === 401 || status === 403 || status === 404) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: (failureCount, err: unknown) => {
          const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 1;
        },
      },
    },
  });
}
