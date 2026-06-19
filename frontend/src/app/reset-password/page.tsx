'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { BirdMark } from '@/components/ui/BirdLogo';
import { useResetPassword, useVerifyResetToken } from '@/hooks/usePasswordReset';

function apiError(error: unknown) {
  return (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
    || 'Password could not be reset.';
}

export default function ResetPasswordPage() {
  return <Suspense fallback={<div className="min-h-screen bg-slate-50" />}><ResetPasswordForm /></Suspense>;
}

function ResetPasswordForm() {
  const token = useSearchParams().get('token');
  const verification = useVerifyResetToken(token);
  const resetPassword = useResetPassword();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    resetPassword.mutate({ token, password, confirmPassword }, {
      onSuccess: () => { setError(''); setComplete(true); },
      onError: (requestError) => setError(apiError(requestError)),
    });
  }

  const invalid = !token || verification.isError;
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-8 text-slate-900">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
        <div className="mb-7 flex items-center gap-3"><BirdMark className="h-10 w-10 rounded-lg" /><div><div className="font-semibold">DigitalADbird</div><div className="text-xs text-slate-500">CRM Platform</div></div></div>
        <h1 className="text-2xl font-semibold">Set a new password</h1>
        {verification.isLoading ? <p className="mt-5 text-sm text-slate-500">Verifying secure link...</p> : invalid ? (
          <div className="mt-5 space-y-4"><p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">This reset link is invalid or expired.</p><Link href="/forgot-password" className="text-sm font-medium text-blue-600">Request another link</Link></div>
        ) : complete ? (
          <div className="mt-5 space-y-4"><p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Password reset successfully. Please login again.</p><Link href="/login" className="inline-flex h-10 items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white">Go to login</Link></div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <p className="text-sm text-slate-500">Account: {verification.data?.email}</p>
            <PasswordField label="New password" value={password} show={showPassword} onChange={setPassword} onToggle={() => setShowPassword(value => !value)} />
            <PasswordField label="Confirm password" value={confirmPassword} show={showPassword} onChange={setConfirmPassword} />
            <p className="text-xs leading-5 text-slate-500">Use at least 8 characters with uppercase, lowercase, number, and special character.</p>
            {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            <button type="submit" disabled={resetPassword.isPending || !password || !confirmPassword} className="h-11 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{resetPassword.isPending ? 'Resetting...' : 'Reset password'}</button>
          </form>
        )}
      </section>
    </main>
  );
}

function PasswordField({ label, value, show, onChange, onToggle }: { label: string; value: string; show: boolean; onChange: (value: string) => void; onToggle?: () => void }) {
  const id = label.toLowerCase().replace(/\s+/g, '-');
  return <div><label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label><div className="relative"><Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input id={id} type={show ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 pl-10 pr-11 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" />{onToggle && <button type="button" onClick={onToggle} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center text-slate-500" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}</div></div>;
}
