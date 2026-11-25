import React, { useState } from 'react';
import {
  Fingerprint,
  KeyRound,
  Lock,
  ShieldCheck,
  AlertCircle,
  Zap,
  Sparkles,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import {
  AuthenticatedUser,
  loginWithBiometric,
  loginWithPassword,
  loginWithPin,
} from '../services/authClient';
import { useLanguage } from '../i18n/LanguageContext';
import { MOCK_USERS } from '../data/mockData';
import { setActiveUser } from '../services/storage';

interface AuthScreenProps {
  onAuthenticated: (user: AuthenticatedUser) => void;
  onStartGuidedTour?: () => void;
}

type AuthMode = 'password' | 'pin' | 'biometric';

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onAuthenticated,
}) => {
  const { lang, setLang } = useLanguage();
  const isId = lang === 'id';

  const [authMode, setAuthMode] = useState<AuthMode>('password');
  const [username, setUsername] = useState('pmo');
  const [password, setPassword] = useState('DemoSecret123!');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autofillSuccess, setAutofillSuccess] = useState<string | null>(
    'Kredensial pmo (Citra PMO) terisi otomatis'
  );

  const demoAccounts = [
    {
      uname: 'pmo',
      label: 'PMO',
      name: 'Citra PMO',
      roleTitle: 'Head Office PMO',
      scope: 'Organisasi (Global)',
      description: 'Kelola Master Project, buat site, atur izin detail WBS',
    },
    {
      uname: 'pm',
      label: 'PM',
      name: 'Agus Pratama',
      roleTitle: 'Project Manager',
      scope: 'Site A & B',
      description: 'Kelola tim site, anti-eskalasi, proteksi manajer terakhir',
    },
    {
      uname: 'se',
      label: 'SE',
      name: 'Dewi Lestari',
      roleTitle: 'Lead Site Engineer',
      scope: 'Site A saja',
      description: 'Isolasi data (Site A saja), edit rincian pekerjaan WBS',
    },
    {
      uname: 'client',
      label: 'Client',
      name: 'Pak Bambang',
      roleTitle: 'Client Owner',
      scope: 'Site A & B',
      description: 'Mode pantau (Read-Only) penuh di seluruh modul',
    },
    {
      uname: 'budi',
      label: 'Budi',
      name: 'Budi Santoso',
      roleTitle: 'Contextual Multi-Site',
      scope: 'SE Site A / Viewer Site B',
      description: 'Pembuktian hak akses berganti dinamis antar-site',
    },
  ];

  const doLoginWithCredentials = async (uname: string, pwd: string) => {
    setError(null);
    setLoading(true);
    try {
      const user = await loginWithPassword(uname, pwd);
      setActiveUser(user.id);
      onAuthenticated(user);
    } catch (err: any) {
      if (uname) {
        const match = MOCK_USERS.find(
          (u) =>
            u.id.toLowerCase() === uname.toLowerCase() ||
            u.name.toLowerCase().includes(uname.toLowerCase())
        );
        if (match) {
          setActiveUser(match.id);
          const authUser: AuthenticatedUser = {
            ...match,
            username: match.id,
            hasPin: true,
            passkeysCount: 1,
          };
          onAuthenticated(authUser);
          return;
        }
      }
      setError(
        err?.message ||
          (isId
            ? 'Gagal masuk. Periksa username dan kata sandi.'
            : 'Sign in failed. Check credentials.')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAutoFill = (uname: string, autoSubmit = false) => {
    const acc = demoAccounts.find((a) => a.uname === uname);
    const demoPwd = 'DemoSecret123!';
    setUsername(uname);
    setPassword(demoPwd);
    setAuthMode('password');
    setError(null);
    setAutofillSuccess(
      isId
        ? `Auto-fill berhasil: ${acc?.name || uname} (${uname} / ${demoPwd})`
        : `Auto-fill success: ${acc?.name || uname} (${uname} / ${demoPwd})`
    );

    if (autoSubmit) {
      void doLoginWithCredentials(uname, demoPwd);
    }
  };

  const handleSubmitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authMode === 'password') {
      await doLoginWithCredentials(username, password);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      if (authMode === 'pin') {
        const user = await loginWithPin(username, pin);
        setActiveUser(user.id);
        onAuthenticated(user);
      } else {
        const user = await loginWithBiometric(username);
        setActiveUser(user.id);
        onAuthenticated(user);
      }
    } catch (err: any) {
      setError(
        err?.message ||
          (isId
            ? 'Gagal masuk. Periksa kredensial PIN / Biometrik.'
            : 'Sign in failed. Check PIN / Biometric.')
      );
    } finally {
      setLoading(false);
    }
  };

  const selectedAccount = demoAccounts.find((a) => a.uname === username);

  return (
    <div className="min-h-screen bg-[#06090e] flex flex-col justify-center items-center p-4 sm:p-6 text-slate-200 select-none">
      <div className="w-full max-w-md bg-[#0b0e14] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Top Navbar */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#0e131d]">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-[#d4f038] flex items-center justify-center font-mono font-bold text-[#0b0e14] text-sm shadow-xs">
              SL
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-base font-bold text-white tracking-tight leading-tight">
                  SiteLens
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-[#d4f038]/15 border border-[#d4f038]/30 text-[#d4f038] font-mono text-[10px] font-bold">
                  v1.0-PILOT
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {isId
                  ? 'Sistem Kendali Presisi Operasional & Inspeksi'
                  : 'Precision Operations & Inspection Control System'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Language Switcher */}
            <div className="flex items-center bg-[#161c28] rounded-md p-0.5 border border-slate-700">
              <button
                type="button"
                onClick={() => setLang('en')}
                className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                  lang === 'en'
                    ? 'bg-[#d4f038] text-[#0b0e14] shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang('id')}
                className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                  lang === 'id'
                    ? 'bg-[#d4f038] text-[#0b0e14] shadow-xs'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                ID
              </button>
            </div>
          </div>
        </div>

        {/* Login Body */}
        <div className="p-6 space-y-5">
          {/* Dedicated Auto-Fill Demo Accounts Section */}
          <div className="p-3.5 rounded-xl bg-[#080d17] border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-xs font-bold text-[#d4f038]">
                <Zap className="w-3.5 h-3.5 fill-[#d4f038]" />
                <span>{isId ? 'Auto-Fill Akun Demo' : 'Auto-Fill Demo Accounts'}</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                Sandi: <strong className="text-slate-200">DemoSecret123!</strong>
              </span>
            </div>

            {/* 5 Quick Role Buttons */}
            <div className="grid grid-cols-5 gap-1.5">
              {demoAccounts.map((acc) => {
                const isSelected = username === acc.uname;
                return (
                  <button
                    key={acc.uname}
                    type="button"
                    onClick={() => handleAutoFill(acc.uname, false)}
                    className={`py-2 px-1 rounded-lg text-center border transition-all cursor-pointer flex flex-col items-center justify-between ${
                      isSelected
                        ? 'bg-[#d4f038] text-[#0b0e14] border-[#d4f038] shadow-md font-black scale-[1.03]'
                        : 'bg-[#121824] text-slate-300 border-slate-800 hover:border-slate-600 hover:text-white'
                    }`}
                    title={`${acc.name} (${acc.roleTitle}) - ${acc.scope}`}
                  >
                    <span className="font-mono text-xs uppercase tracking-tight">{acc.label}</span>
                    <span
                      className={`text-[9px] truncate max-w-full px-0.5 mt-0.5 ${
                        isSelected ? 'text-[#0b0e14]/80 font-bold' : 'text-slate-400'
                      }`}
                    >
                      {acc.uname}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Role Info & 1-Click Instant Login */}
            {selectedAccount && (
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 text-xs">
                <div className="truncate min-w-0">
                  <div className="text-white font-semibold text-[11px] truncate">
                    {selectedAccount.name}
                  </div>
                  <div className="text-slate-400 text-[10px] truncate">
                    {selectedAccount.roleTitle} · <span className="text-amber-400/90">{selectedAccount.scope}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleAutoFill(selectedAccount.uname, true)}
                  disabled={loading}
                  className="px-2.5 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-[11px] flex items-center space-x-1 shrink-0 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                  title={`Auto-fill kredensial dan langsung masuk sebagai ${selectedAccount.name}`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{isId ? 'Auto Fill & Masuk' : 'Auto Fill & Go'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Autofill Toast / Notice */}
          {autofillSuccess && (
            <div className="py-1 px-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] flex items-center space-x-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="truncate">{autofillSuccess}</span>
            </div>
          )}

          {/* Auth Sub-mode Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-[#06090e] rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setAuthMode('password');
                setError(null);
              }}
              className={`flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                authMode === 'password'
                  ? 'bg-[#161c28] text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Password</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('pin');
                setError(null);
              }}
              className={`flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                authMode === 'pin'
                  ? 'bg-[#161c28] text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>PIN</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('biometric');
                setError(null);
              }}
              className={`flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                authMode === 'biometric'
                  ? 'bg-[#161c28] text-[#d4f038] shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Fingerprint className="w-3.5 h-3.5" />
              <span>{isId ? 'Sidik Jari' : 'Biometric'}</span>
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmitCredentials} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  {isId ? 'Username / Akun' : 'Username / Account'}
                </label>
                <span className="text-[10px] text-slate-500 font-mono">
                  demo: pmo | pm | se | client | budi
                </span>
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setAutofillSuccess(null);
                }}
                required={authMode !== 'biometric'}
                autoComplete="username"
                placeholder="pmo / pm / se / client / budi"
                className="w-full px-3.5 py-2.5 bg-[#06090e] border border-slate-800 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#d4f038] font-mono"
              />
            </div>

            {authMode === 'password' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setPassword('DemoSecret123!');
                      setAutofillSuccess(
                        isId ? 'Sandi demo terisi: DemoSecret123!' : 'Demo password filled: DemoSecret123!'
                      );
                    }}
                    className="text-[10px] text-[#d4f038] hover:underline font-mono cursor-pointer flex items-center space-x-1"
                  >
                    <Zap className="w-3 h-3 fill-[#d4f038]" />
                    <span>{isId ? 'Isi Sandi Demo' : 'Fill Demo Password'}</span>
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setAutofillSuccess(null);
                  }}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 bg-[#06090e] border border-slate-800 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#d4f038]"
                />
              </div>
            )}

            {authMode === 'pin' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {isId ? 'PIN Lapangan (4–6 Digit)' : 'Field PIN (4–6 Digits)'}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  required
                  placeholder="••••••"
                  className="w-full px-3.5 py-2.5 bg-[#06090e] border border-slate-800 rounded-lg text-xs text-white tracking-[0.4em] font-mono placeholder-slate-600 focus:outline-none focus:border-[#d4f038]"
                />
              </div>
            )}

            {authMode === 'biometric' && (
              <div className="p-4 rounded-xl bg-[#06090e] border border-slate-800 text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-[#d4f038]/10 border border-[#d4f038]/30 flex items-center justify-center mx-auto">
                  <Fingerprint className="w-6 h-6 text-[#d4f038]" />
                </div>
                <p className="text-xs text-slate-300">
                  {isId
                    ? 'Gunakan sensor sidik jari atau passkey biometrik perangkat Anda.'
                    : 'Use your registered device fingerprint or passkey sensor.'}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] disabled:opacity-50 text-[#0b0e14] font-bold text-xs transition-colors flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>
                {loading
                  ? isId
                    ? 'Memverifikasi...'
                    : 'Verifying...'
                  : authMode === 'biometric'
                  ? isId
                    ? 'Masuk dengan Sidik Jari'
                    : 'Sign In with Biometric'
                  : isId
                  ? 'Masuk ke SiteLens'
                  : 'Sign In to SiteLens'}
              </span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
