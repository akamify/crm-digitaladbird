'use client';

import { FormEvent, Suspense, useEffect, useId, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Eye, EyeOff, Lock, LogIn, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { BirdMark } from '@/components/ui/BirdLogo';
import { dashboardPath, useAuth } from '@/lib/auth';

function loginErrorMessage(error: unknown) {
  const payload = (error as {
    response?: { data?: { code?: string; message?: string; error?: { code?: string; message?: string } | string } };
  })?.response?.data;
  const nested = typeof payload?.error === 'string' ? null : payload?.error;
  const code = payload?.code || nested?.code;
  if (code === 'USER_INACTIVE') return 'Account inactive or blocked.';
  if (code === 'ROLE_MISMATCH') return 'Role mismatch. Please use the correct account type.';
  if (code === 'PASSWORD_NOT_SET') return 'Password is not configured for this account.';
  return payload?.message
    || (typeof payload?.error === 'string' ? payload.error : nested?.message)
    || 'Invalid credentials. Please check your login details.';
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, initialized, init, login, loading } = useAuth();
  const identifierId = useId();
  const passwordId = useId();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const sessionExpired = params.get('expired') === '1';

  useEffect(() => {
    if (!initialized) init();
  }, [initialized, init]);

  useEffect(() => {
    if (!initialized || !user) return;
    router.replace(params.get('next') || dashboardPath(user.role));
  }, [initialized, params, router, user]);

  const canSubmit = useMemo(
    () => identifier.trim().length > 0 && password.length > 0 && !loading,
    [identifier, password, loading],
  );

  if (!initialized) return <div className="min-h-screen bg-slate-50" />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const loginId = identifier.trim();

    if (!loginId) {
      setError('Enter your email, CP ID, or phone number.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }

    setError('');
    try {
      const loggedInUser = await login(loginId, password);
      toast.success('Signed in successfully');
      router.replace(params.get('next') || dashboardPath(loggedInUser.role));
    } catch (err: unknown) {
      const text = loginErrorMessage(err);
      setError(text);
      toast.error(text);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="hidden bg-slate-950 px-10 py-12 text-white lg:flex lg:flex-col lg:justify-between">
            <div className="flex items-center gap-3">
              <BirdMark className="h-11 w-11 rounded-xl shadow-lg" />
              <div>
                <div className="text-xl font-semibold tracking-tight">DigitalADbird</div>
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">CRM Platform</div>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-4xl font-semibold leading-tight tracking-tight">
                Lead operations, team performance, and customer follow-up in one place.
              </p>
              <p className="max-w-sm text-sm leading-6 text-slate-300">
                Sign in with your registered email, CP ID, or phone number.
              </p>
            </div>

            <div className="text-xs text-slate-500">
              DigitalADbird CRM · Secure session access
            </div>
          </div>

          <div className="px-5 py-8 sm:px-10 sm:py-12">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <BirdMark className="h-10 w-10 rounded-xl shadow-md" />
              <div>
                <div className="text-lg font-semibold">DigitalADbird</div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">CRM Platform</div>
              </div>
            </div>

            <div className="mb-7">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Sign in</h1>
              <p className="mt-2 text-sm text-slate-500">
                Use your registered email, CP ID, or phone number.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div>
                <label htmlFor={identifierId} className="mb-1.5 block text-sm font-medium text-slate-700">
                  Email, phone, or CP ID
                </label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id={identifierId}
                    name="username"
                    type="text"
                    value={identifier}
                    onChange={(event) => {
                      setIdentifier(event.target.value);
                      if (error) setError('');
                    }}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    placeholder="Email, phone, or CP ID"
                    aria-invalid={!!error}
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                </div>
              </div>

              <div>
                <label htmlFor={passwordId} className="mb-1.5 block text-sm font-medium text-slate-700">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id={passwordId}
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (error) setError('');
                    }}
                    autoComplete="current-password"
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-11 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    placeholder="Enter your password"
                    aria-invalid={!!error}
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <Link href="/forgot-password" className="text-sm font-medium text-blue-600 hover:text-blue-700">
                  Forgot password?
                </Link>
              </div>

              {error && (
                <div
                  id="login-error"
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {!error && sessionExpired && (
                <div
                  role="status"
                  className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Your session expired after 24 hours. Please login again.</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>

            <div className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-500">
              <Link href="/privacy-policy" className="hover:text-blue-600">Privacy Policy</Link>
              <span aria-hidden="true">|</span>
              <Link href="/terms" className="hover:text-blue-600">Terms and Conditions</Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
