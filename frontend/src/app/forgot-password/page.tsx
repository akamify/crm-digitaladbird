'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { useForgotPassword } from '@/hooks/usePasswordReset';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const forgotPassword = useForgotPassword();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    forgotPassword.mutate(email.trim().toLowerCase(), {
      onSuccess: (response: { message?: string } | void) => {
        toast.success(response?.message || 'Password reset email sent successfully.');
        setSubmitted(true);
      },
      onError: (error: unknown) => {
        const payload = error as { response?: { data?: { message?: string; error?: { message?: string } } } };
        toast.error(payload.response?.data?.error?.message || payload.response?.data?.message || 'Unable to send password reset email. Please try again.');
        setSubmitted(true);
      },
    });
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-8 text-slate-900">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Digital AdBird logo"
            width={40}
            height={40}
            className="h-10 w-10 rounded-lg object-contain"
          />
          <div>
            <div className="font-semibold">Digital AdBird</div>
            <div className="text-xs text-slate-500">CRM Platform</div>
          </div>
        </div>
        <h1 className="text-2xl font-semibold">Forgot password</h1>
        {submitted ? (
          <div className="mt-5 space-y-5">
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              If an account exists for this email, a reset link has been sent.
            </p>
            <Link href="/login" className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700">
              <ArrowLeft className="h-4 w-4" /> Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-5">
            <p className="text-sm text-slate-500">Enter your registered email address.</p>
            <div>
              <label htmlFor="reset-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input id="reset-email" type="email" autoComplete="email" placeholder='name@example.com' required value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" />
              </div>
            </div>
            <button type="submit" disabled={forgotPassword.isPending || !email.trim()} className="h-11 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {forgotPassword.isPending ? 'Sending...' : 'Send reset link'}
            </button>
            <div className="flex justify-center">
              <Link href="/login" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Back to login</Link>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
