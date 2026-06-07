'use client';
import { useEffect, useState, FormEvent, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Eye, EyeOff, LogIn, Shield, Users, Handshake,
  Mail, Phone, IdCard, User, Lock, ChevronRight,
} from 'lucide-react';
import { BirdMark } from '@/components/ui/BirdLogo';
import { RaccoonMascot } from '@/components/ui/RaccoonMascot';
import toast from 'react-hot-toast';
import { useAuth, dashboardPath } from '@/lib/auth';

type LoginRole = 'admin' | 'rm' | 'partner';

const ROLES: { key: LoginRole; label: string; desc: string; icon: typeof Shield; color: string; bg: string; border: string; ring: string }[] = [
  { key: 'admin',   label: 'Admin',   desc: 'Super Admin access',      icon: Shield,    color: 'text-rose-600',   bg: 'bg-rose-50',    border: 'border-rose-200', ring: 'ring-rose-500' },
  { key: 'rm',      label: 'RM',      desc: 'Relationship Manager',    icon: Users,     color: 'text-blue-600',   bg: 'bg-blue-50',    border: 'border-blue-200', ring: 'ring-blue-500' },
  { key: 'partner', label: 'Partner', desc: 'Channel Partner access',  icon: Handshake, color: 'text-emerald-600',bg: 'bg-emerald-50', border: 'border-emerald-200', ring: 'ring-emerald-500' },
];

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params  = useSearchParams();
  const { user, initialized, init, login, loading } = useAuth();

  const [role,     setRole]     = useState<LoginRole>('admin');
  const [fullName, setFullName] = useState('');
  const [email,    setEmail]    = useState('');
  const [phone,    setPhone]    = useState('');
  const [cpId,     setCpId]     = useState('');
  const [password, setPassword] = useState('');
  const [showPwd,  setShowPwd]  = useState(false);

  useEffect(() => { if (!initialized) init(); }, [initialized, init]);
  useEffect(() => {
    if (user) {
      const next = params.get('next') || dashboardPath(user.role);
      router.replace(next);
    }
  }, [user, params, router]);

  if (!initialized) return <div className="min-h-screen bg-slate-50" />;

  const activeRole = ROLES.find(r => r.key === role)!;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const identifier = email.trim() || cpId.trim() || phone.trim();
    if (!identifier) {
      toast.error('Please enter your Email, CP ID, or Mobile Number');
      return;
    }
    if (!password) {
      toast.error('Please enter your password');
      return;
    }

    try {
      await login(identifier, password, role);
      toast.success(`Welcome to DigitalADbird CRM!`);
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.error?.message
               || (err as any)?.response?.data?.error
               || 'Login failed. Please check your credentials.';
      toast.error(msg);
    }
  }

  function clearForm() {
    setFullName(''); setEmail(''); setPhone(''); setCpId(''); setPassword(''); setShowPwd(false);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex">

      {/* ── Left Branding Panel ── */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-10 xl:p-14 text-white relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/5" />
        <div className="absolute top-1/2 right-10 h-40 w-40 rounded-full bg-white/5" />

        {/* Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <BirdMark className="h-11 w-11 drop-shadow-lg" />
          <div>
            <span className="text-xl font-bold tracking-tight">DigitalADbird</span>
            <span className="block text-[10px] uppercase tracking-[0.2em] text-blue-200">CRM Platform</span>
          </div>
        </div>

        {/* Raccoon mascot — friendly supporting illustration */}
        <div className="hidden xl:block absolute bottom-6 right-6 z-0 opacity-95 pointer-events-none">
          <RaccoonMascot className="h-56 w-56" />
        </div>

        {/* Hero */}
        <div className="relative z-10">
          <h1 className="text-4xl xl:text-5xl font-bold leading-tight mb-5">
            Smart Lead<br />Management<br />
            <span className="text-blue-200">Made Simple</span>
          </h1>
          <p className="text-blue-100 text-base leading-relaxed mb-8 max-w-md">
            Distribute leads intelligently, track every interaction, and close more deals.
            Built for high-performance teams.
          </p>

          {/* Feature grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Lead Distribution', sub: 'Round-robin & weighted' },
              { label: 'Role-Based Access', sub: 'Admin, RM, Partner' },
              { label: 'Real-Time Reports', sub: 'Live dashboards' },
              { label: 'Meta Integration', sub: 'Facebook Ads sync' },
            ].map(f => (
              <div key={f.label} className="rounded-xl bg-white/10 backdrop-blur-sm px-3.5 py-2.5">
                <div className="text-xs font-semibold text-white">{f.label}</div>
                <div className="text-[10px] text-blue-200">{f.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 flex items-center justify-between text-blue-200 text-xs">
          <span>DigitalADbird &copy; {new Date().getFullYear()}</span>
          <span className="flex items-center gap-1.5">
            <Lock className="h-3 w-3" />
            Secured by JWT
          </span>
        </div>
      </div>

      {/* ── Right Login Panel ── */}
      <div className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8">
        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2.5 mb-6">
            <BirdMark className="h-10 w-10 shrink-0 shadow-md rounded-xl" />
            <div>
              <span className="text-lg font-bold text-slate-900">DigitalADbird</span>
              <span className="block text-[10px] uppercase tracking-widest text-slate-400">CRM Platform</span>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-1">Welcome back</h2>
          <p className="text-sm text-slate-500 mb-6">Sign in to your CRM account</p>

          {/* ── Role Selector ── */}
          <div className="mb-6">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2.5">
              Select your role
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {ROLES.map(r => {
                const Icon = r.icon;
                const active = role === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => { setRole(r.key); clearForm(); }}
                    className={`relative flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3.5 transition-all duration-200
                      ${active
                        ? `${r.border} ${r.bg} shadow-sm ring-2 ${r.ring} ring-offset-1`
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                  >
                    <div className={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${active ? r.bg : 'bg-slate-100'}`}>
                      <Icon className={`h-4.5 w-4.5 ${active ? r.color : 'text-slate-400'}`} />
                    </div>
                    <span className={`text-xs font-semibold ${active ? r.color : 'text-slate-600'}`}>{r.label}</span>
                    <span className="text-[9px] text-slate-400 leading-tight text-center">{r.desc}</span>
                    {active && (
                      <div className={`absolute -top-1 -right-1 h-4 w-4 rounded-full grid place-items-center text-white text-[8px]
                        ${r.key === 'admin' ? 'bg-rose-500' : r.key === 'rm' ? 'bg-blue-500' : 'bg-emerald-500'}`}>
                        <svg viewBox="0 0 12 12" fill="none" className="h-2.5 w-2.5"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Login Form ── */}
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Full Name */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
                <User className="h-3.5 w-3.5 text-slate-400" />
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Enter your full name"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
              />
            </div>

            {/* Email */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
                <Mail className="h-3.5 w-3.5 text-slate-400" />
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
              />
            </div>

            {/* Mobile Number */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
                <Phone className="h-3.5 w-3.5 text-slate-400" />
                Mobile Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+91 98XXXXXXXX"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
              />
            </div>

            {/* CP ID */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
                <IdCard className="h-3.5 w-3.5 text-slate-400" />
                CP ID
                <span className="text-[10px] text-slate-400 font-normal">(Channel Partner ID)</span>
              </label>
              <input
                type="text"
                value={cpId}
                onChange={e => setCpId(e.target.value)}
                placeholder={role === 'admin' ? 'Not required for Admin' : 'e.g. SBA28071544'}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
              />
            </div>

            {/* Password */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
                <Lock className="h-3.5 w-3.5 text-slate-400" />
                Password
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 pr-11 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className={`relative w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-200 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed
                ${role === 'admin'
                  ? 'bg-gradient-to-r from-rose-500 to-rose-600 shadow-rose-200 hover:from-rose-600 hover:to-rose-700 hover:shadow-rose-300'
                  : role === 'rm'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 shadow-blue-200 hover:from-blue-700 hover:to-indigo-700 hover:shadow-blue-300'
                  : 'bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-emerald-200 hover:from-emerald-600 hover:to-emerald-700 hover:shadow-emerald-300'
                }`}
            >
              {loading ? (
                <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {loading ? 'Signing in...' : `Sign In as ${activeRole.label}`}
              {!loading && <ChevronRight className="h-3.5 w-3.5 ml-1" />}
            </button>
          </form>

          {/* Help box */}
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">How to sign in</p>
            <div className="space-y-1.5 text-xs text-slate-500">
              <div className="flex items-start gap-2">
                <span className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${role === 'admin' ? 'bg-rose-500' : role === 'rm' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                <span>
                  {role === 'admin'
                    ? 'Use your admin email address and password'
                    : role === 'rm'
                    ? 'Use your CP ID or email with your assigned password'
                    : 'Use your CP ID or email with your assigned password'
                  }
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${role === 'admin' ? 'bg-rose-500' : role === 'rm' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                <span>You can also sign in using your registered mobile number</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-2.5">
              Contact your administrator if you need access or forgot your password.
            </p>
          </div>

          <p className="mt-5 text-center text-[10px] uppercase tracking-[0.18em] text-slate-300">
            DigitalADbird &middot; Enterprise CRM &middot; {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}
