import React, { useState } from 'react';
import { X, Fingerprint, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  AuthenticatedUser,
  registerBiometric,
  setupPin,
} from '../services/authClient';
import { useLanguage } from '../i18n/LanguageContext';

interface SecuritySettingsModalProps {
  isOpen: boolean;
  user: AuthenticatedUser | null;
  onClose: () => void;
  onUpdated: (updates: Partial<AuthenticatedUser>) => void;
}

export const SecuritySettingsModal: React.FC<SecuritySettingsModalProps> = ({
  isOpen,
  user,
  onClose,
  onUpdated,
}) => {
  const { lang } = useLanguage();
  const isId = lang === 'id';

  const [pin, setPin] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isOpen || !user) return null;

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await setupPin(pin);
      setPin('');
      onUpdated({ hasPin: true });
      setStatusMsg(isId ? 'PIN lapangan berhasil disimpan.' : 'Field PIN saved.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save PIN.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterBiometric = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await registerBiometric(deviceName || undefined);
      setDeviceName('');
      onUpdated({ passkeysCount: (user.passkeysCount || 0) + 1 });
      setStatusMsg(
        isId
          ? 'Sidik jari / biometrik perangkat berhasil didaftarkan.'
          : 'Device fingerprint / biometric registered.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Biometric registration failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-white">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold">
              {isId ? 'Keamanan Akun & Biometrik' : 'Account Security & Biometrics'}
            </h2>
            <p className="text-[11px] text-slate-400">
              @{user.username} • {user.role}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {statusMsg && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{statusMsg}</span>
            </div>
          )}
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* PIN Setup */}
          <form onSubmit={handleSavePin} className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold flex items-center space-x-1.5">
                <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                <span>{isId ? 'PIN Cepat Lapangan (4–6 Digit)' : 'Quick Field PIN (4–6 Digits)'}</span>
              </label>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                {user.hasPin ? (isId ? 'Aktif' : 'Configured') : isId ? 'Belum Diatur' : 'Not Set'}
              </span>
            </div>
            <div className="flex space-x-2">
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                required
                placeholder="123456"
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white font-mono tracking-widest focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold border border-slate-700"
              >
                {isId ? 'Simpan PIN' : 'Save PIN'}
              </button>
            </div>
          </form>

          {/* WebAuthn Fingerprint Registration */}
          <div className="pt-4 border-t border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold flex items-center space-x-1.5">
                <Fingerprint className="w-3.5 h-3.5 text-amber-400" />
                <span>{isId ? 'Sidik Jari / Passkey Perangkat' : 'Device Fingerprint / Passkey'}</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                {user.passkeysCount} {isId ? 'perangkat' : 'registered'}
              </span>
            </div>
            <div className="flex space-x-2">
              <input
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder={isId ? 'Nama perangkat (opsional)' : 'Device label (optional)'}
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={handleRegisterBiometric}
                disabled={busy}
                className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
              >
                {isId ? 'Daftarkan' : 'Register'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

