'use client';
import { ReactNode, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { makeQueryClient } from '@/lib/queryClient';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#ffffff',
            color: '#0f172a',
            border: '1px solid #e2e8f0',
            boxShadow: '0 10px 30px -10px rgba(15,23,42,0.15)',
            fontSize: '0.85rem',
          },
          success: { iconTheme: { primary: '#db2777', secondary: '#ffffff' } },
          error:   { iconTheme: { primary: '#e11d48', secondary: '#ffffff' } },
        }}
      />
    </QueryClientProvider>
  );
}
