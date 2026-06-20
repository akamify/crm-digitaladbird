'use client';

import { KeyRound, MailPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSendOnboardingEmail, useSendPasswordResetLink } from '@/hooks/useUsers';

function errorMessage(error: unknown) {
  const payload = (error as { response?: { data?: { error?: { code?: string; message?: string } } } })?.response?.data?.error;
  if (payload?.code === 'EMAIL_PROVIDER_NOT_CONFIGURED') return 'Email provider is not configured.';
  if (payload?.code === 'USER_EMAIL_MISSING') return 'User has no registered email.';
  return payload?.message || 'Email could not be sent.';
}

export function UserEmailActions({ userId }: { userId: string }) {
  const reset = useSendPasswordResetLink();
  const onboarding = useSendOnboardingEmail();

  return (
    <>
      <button
        type="button"
        disabled={reset.isPending}
        onClick={() => {
          if (!confirm("Send password reset link? A secure password reset link will be sent to this user's registered email.")) return;
          reset.mutate(userId, {
            onSuccess: () => toast.success('Reset link sent.'),
            onError: (error) => toast.error(errorMessage(error)),
          });
        }}
        className="rounded p-1.5 text-slate-400 hover:bg-orange-50 hover:text-orange-600 disabled:opacity-50"
        title="Send password reset link"
        aria-label="Send password reset link"
      >
        <KeyRound className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={onboarding.isPending}
        onClick={() => onboarding.mutate(userId, {
          onSuccess: () => toast.success('Onboarding email sent.'),
          onError: (error) => toast.error(errorMessage(error)),
        })}
        className="rounded p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
        title="Resend onboarding email"
        aria-label="Resend onboarding email"
      >
        <MailPlus className="h-3.5 w-3.5" />
      </button>
    </>
  );
}
