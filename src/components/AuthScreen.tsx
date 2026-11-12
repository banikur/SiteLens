import React, { useState } from 'react';
import { Fingerprint, KeyRound, Lock, ShieldCheck, AlertCircle } from 'lucide-react';
import {
  AuthenticatedUser,
  loginWithBiometric,
  loginWithPassword,
  loginWithPin,
} from '../services/authClient';
import { useLanguage } from '../i18n/LanguageContext';

interface AuthScreenProps {
  onAuthenticated: (user: AuthenticatedUser) => void;
}

type AuthMode = 'password' | 'pin' | 'biometric';

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const { lang, setLang } = useLanguage();
  const isId = lang === 'id';

  const [mode, setMode] = useState<AuthMode>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'password') {
        const user = await loginWithPassword(username, password);
        onAuthenticated(user);
      } else if (mode === 'pin') {
        const user = await loginWithPin(username, pin);
        onAuthenticated(user);
      } else {
        const user = await loginWithBiometric(username);
        onAuthenticated(user);
      }
    } catch (err: any) {
      setError(err?.message || (isId ? 'Gagal masuk. Periksa kembali kredensial Anda.' : 'Sign in failed. Please check your credentials.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center font-black text-slate-950 text-sm">
              SL
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-tight">SiteLens</h1>
              <p className="text-[11px] text-slate-400">
                {isId ? 'Operasional & Inspeksi Lapangan' : 'Precision Site Operations'}
              </p>
            </div>
          </div>

          <div className="flex items-center bg-slate-800 rounded-md p-0.5 border border-slate-700">
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                lang === 'en' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setLang('id')}
              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                lang === 'id' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              ID
            </button>
          </div>
        </div>

        {/* Auth Mode Tabs */}
        <div className="grid grid-cols-3 gap-1 p-2 bg-slate-950/60 border-b border-slate-800">
          <button
            type="button"
            onClick={() => {
              setMode('password');
              setError(null);
            }}
            className={`flex items-center justify-center space-x-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              mode === 'password'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>{isId ? 'Password' : 'Password'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('pin');
              setError(null);
            }}
            className={`flex items-center justify-center space-x-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              mode === 'pin'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>PIN</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('biometric');
              setError(null);
            }}
            className={`flex items-center justify-center space-x-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              mode === 'biometric'
                ? 'bg-slate-800 text-amber-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Fingerprint className="w-3.5 h-3.5" />
            <span>{isId ? 'Sidik Jari' : 'Biometric'}</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              {isId ? 'Username' : 'Username'}
              {mode === 'biometric' && (
                <span className="text-slate-500 font-normal ml-1">
                  ({isId ? 'opsional untuk passkey perangkat' : 'optional for device passkey'})
                </span>
              )}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required={mode !== 'biometric'}
              autoComplete="username"
              placeholder="admin"
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          {mode === 'password' && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>
          )}

          {mode === 'pin' && (
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
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white tracking-[0.4em] font-mono placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>
          )}

          {mode === 'biometric' && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto">
                <Fingerprint className="w-6 h-6 text-amber-400" />
              </div>
              <p className="text-xs text-slate-300">
                {isId
                  ? 'Gunakan sensor sidik jari atau biometrik perangkat yang sudah terdaftar.'
                  : 'Use your registered device fingerprint or biometric passkey.'}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-sm transition-colors flex items-center justify-center space-x-2"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>
              {loading
                ? isId
                  ? 'Memverifikasi...'
                  : 'Verifying...'
                : mode === 'biometric'
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
  );
};

