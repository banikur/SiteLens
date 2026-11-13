import React, { useState } from 'react';
import {
  Award,
  UserCheck,
  UserPlus,
  KeyRound,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  X,
  Save,
} from 'lucide-react';
import { User, UserRole } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface TeamManagementProps {
  users: User[];
  activeUser: User;
  onSwitchUser: (userId: string) => void;
  onRefreshData?: () => void;
}

const ROLE_DESCRIPTIONS_EN: Record<
  UserRole,
  { duties: string; primaryFocus: string }
> = {
  'Field Inspector / Petugas K3': {
    duties:
      'Executes inspection sessions from active templates, records SHA-256 hashed and GPS geotagged photo evidence, captures field UT thickness readings, and exercises Stop Work Authority (SWA) for critical hazards.',
    primaryFocus: 'Field Safety Audit, Mobile Checklists & Physical Verification',
  },
  'Action Owner / Pelaksana Perbaikan': {
    duties:
      'Receives immediate containment actions (ICA) and permanent corrective action plans (PCA), updates remediation progress, and uploads objective post-repair evidence.',
    primaryFocus: 'Physical Remediation Execution & Defect Containment',
  },
  'Office / Integrity Engineer': {
    duties:
      'Manages piping circuits, pressure vessels, and CML master data; calculates governing corrosion rates; evaluates API 579-1 Fitness-For-Service and minimum required thickness.',
    primaryFocus: 'Mechanical Integrity, Degradation Mechanisms & FFS Calculations',
  },
  'Authorized Inspector (API 510/570) & Verifikator K3': {
    duties:
      'Certifies pressurized equipment integrity reports, performs independent four-eyes physical verification of corrective actions, and audits effectiveness over 30-90 day monitoring windows.',
    primaryFocus: 'Independent Statutory & Code Verification (API 510/570 / K3)',
  },
  'HSE / Quality Manager & Tenant Admin': {
    duties:
      'Configures tenant compliance profiles (SMK3 PP 50/2012 & Major Hazard status), governs master checklist templates, provisions user credentials, and audits safety KPIs (FR/SR).',
    primaryFocus: 'System Governance, Corporate Compliance & Risk Oversight',
  },
};

const ROLE_DESCRIPTIONS_ID: Record<
  UserRole,
  { duties: string; primaryFocus: string }
> = {
  'Field Inspector / Petugas K3': {
    duties:
      'Menjalankan sesi inspeksi dari template aktif, merekam foto bukti ber-geotag GPS dan hash SHA-256, mencatat pembacaan ketebalan UT, dan memicu Stop Work Authority (SWA) untuk temuan kritikal.',
    primaryFocus: 'Audit K3 Lapangan, Checklist Seluler & Verifikasi Fisik',
  },
  'Action Owner / Pelaksana Perbaikan': {
    duties:
      'Menerima tindakan penanganan segera (ICA) dan rencana tindakan korektif permanen (PCA), memperbarui progres perbaikan, dan mengunggah foto bukti pasca-perbaikan.',
    primaryFocus: 'Pelaksanaan Remediasi Fisik & Penanganan Cacat',
  },
  'Office / Integrity Engineer': {
    duties:
      'Mengelola sirkuit perpipaan, bejana tekan, dan CML; memvalidasi laju korosi penentu; mengevaluasi batas ketebalan minimum serta Fitness-For-Service (API 579-1).',
    primaryFocus: 'Integritas Mekanikal, Mekanisme Kerusakan & Analisis FFS',
  },
  'Authorized Inspector (API 510/570) & Verifikator K3': {
    duties:
      'Mengesahkan laporan inspeksi integritas bertekanan, melaksanakan verifikasi fisik independen (four-eyes check) atas tindakan korektif, dan memvalidasi efektivitas pemantauan 30-90 hari.',
    primaryFocus: 'Verifikasi Independen Kode Standar (API 510/570 / K3)',
  },
  'HSE / Quality Manager & Tenant Admin': {
    duties:
      'Mengonfigurasi profil kepatuhan tenant (SMK3 PP 50/2012 & status Potensi Bahaya Besar B3), mengelola master template, mengelola hak akses user, dan memantau KPI keselamatan (FR/SR).',
    primaryFocus: 'Tata Kelola Sistem, Kepatuhan Regulasi & Manajemen Risiko',
  },
};

export const TeamManagement: React.FC<TeamManagementProps> = ({
  users,
  activeUser,
  onSwitchUser,
  onRefreshData,
}) => {
  const { lang, t, translateRole } = useLanguage();
  const isId = lang === 'id';
  const isTenantAdmin = activeUser.role === 'HSE / Quality Manager & Tenant Admin';
  const descriptions = isId ? ROLE_DESCRIPTIONS_ID : ROLE_DESCRIPTIONS_EN;

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [resetPwdUser, setResetPwdUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newUser, setNewUser] = useState({
    username: '',
    name: '',
    email: '',
    password: '',
    role: 'Field Inspector / Petugas K3' as UserRole,
    title: '',
  });

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');
      setStatusMsg(isId ? `Pengguna ${newUser.name} berhasil dibuat.` : `User ${newUser.name} created successfully.`);
      setCreateModalOpen(false);
      setNewUser({
        username: '',
        name: '',
        email: '',
        password: '',
        role: 'Field Inspector / Petugas K3',
        title: '',
      });
      onRefreshData?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error creating user');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (targetUser: User) => {
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const nextActive = targetUser.isActive === false ? true : false;
      const res = await fetch(`/api/users/${targetUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isActive: nextActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update user status');
      setStatusMsg(
        isId
          ? `Status ${targetUser.name} diubah menjadi ${nextActive ? 'Aktif' : 'Nonaktif'}.`
          : `Status for ${targetUser.name} changed to ${nextActive ? 'Active' : 'Inactive'}.`
      );
      onRefreshData?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error updating user status');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPwdUser) return;
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/users/${resetPwdUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      setStatusMsg(isId ? `Password untuk ${resetPwdUser.name} berhasil diubah.` : `Password reset for ${resetPwdUser.name}.`);
      setResetPwdUser(null);
      setNewPassword('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error resetting password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            {t.team.title}
          </h1>
          <p className="text-xs text-slate-500 mt-1">{t.team.subtitle}</p>
        </div>

        {isTenantAdmin && (
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center shadow-xs shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5 mr-1.5" />
            <span>{isId ? 'Tambah Anggota Tim' : 'Add Team Member'}</span>
          </button>
        )}
      </div>

      {statusMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{statusMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Role Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {users.map((user) => {
          const roleInfo = descriptions[user.role] || {
            duties: 'Operasional K3 dan integritas fasilitas.',
            primaryFocus: 'Manajemen Risiko Lapangan',
          };
          const isActive = user.id === activeUser.id;

          return (
            <div
              key={user.id}
              className={`bg-white rounded-xl border p-5 flex flex-col justify-between transition-all shadow-xs ${
                isActive
                  ? 'border-amber-500 ring-2 ring-amber-500/20'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div>
                {/* User Headshot and Role */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center space-x-3">
                    {user.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.name}
                        referrerPolicy="no-referrer"
                        className="w-12 h-12 rounded-full border border-slate-200 object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full border border-slate-200 bg-amber-500/20 text-amber-500 font-bold flex items-center justify-center text-sm">
                        {user.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 leading-tight">
                        {user.name}
                      </h2>
                      <div className="text-xs font-semibold text-amber-700 mt-0.5">
                        {translateRole(user.role)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {user.email}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {isActive && (
                      <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">
                        {t.team.activeBadge}
                      </span>
                    )}
                    {user.isActive === false && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                        {isId ? 'Nonaktif' : 'Inactive'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Role Description */}
                <div className="mt-3 bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs">
                  <span className="font-bold text-slate-800 block mb-1">
                    {t.team.roleFocus} {roleInfo.primaryFocus}
                  </span>
                  <p className="text-slate-600 leading-relaxed text-[11px]">
                    {roleInfo.duties}
                  </p>
                </div>

                {/* Certifications */}
                {user.certifications && user.certifications.length > 0 && (
                  <div className="mt-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                      {t.team.certifications}
                    </span>
                    <div className="space-y-1">
                      {user.certifications.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-center text-[11px] text-slate-700 font-medium"
                        >
                          <Award className="w-3 h-3 text-amber-500 mr-1.5 shrink-0" />
                          <span className="truncate">{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Action */}
              <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
                <button
                  onClick={() => onSwitchUser(user.id)}
                  disabled={isActive}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center ${
                    isActive
                      ? 'bg-slate-100 text-slate-400 cursor-default'
                      : 'bg-slate-900 hover:bg-slate-800 text-white shadow-xs'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5 mr-1.5" />
                  {isActive
                    ? t.team.currentActivePersona
                    : t.team.switchTo.replace('{name}', user.name)}
                </button>

                {isTenantAdmin && (
                  <div className="flex items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setResetPwdUser(user)}
                      className="flex-1 py-1 px-2 rounded border border-slate-200 hover:bg-slate-50 text-[11px] font-medium text-slate-600 flex items-center justify-center"
                    >
                      <KeyRound className="w-3 h-3 mr-1 text-slate-400" />
                      <span>{isId ? 'Reset Sandi' : 'Reset Pwd'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(user)}
                      className={`px-2.5 py-1 rounded border text-[11px] font-medium ${
                        user.isActive === false
                          ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          : 'border-red-200 text-red-600 hover:bg-red-50'
                      }`}
                    >
                      {user.isActive === false ? (isId ? 'Aktifkan' : 'Activate') : isId ? 'Nonaktifkan' : 'Deactivate'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CREATE USER MODAL */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold flex items-center">
                <UserPlus className="w-4 h-4 mr-2 text-amber-500" />
                {isId ? 'Tambah Pengguna Baru' : 'Create User'}
              </h2>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Username</label>
                <input
                  type="text"
                  required
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  placeholder="john.doe"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  placeholder="John Doe"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="john.doe@company.com"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Peran Resmi (PRD Role)</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  {[
                    'Field Inspector / Petugas K3',
                    'Action Owner / Pelaksana Perbaikan',
                    'Office / Integrity Engineer',
                    'Authorized Inspector (API 510/570) & Verifikator K3',
                    'HSE / Quality Manager & Tenant Admin',
                  ].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Jabatan / Spesialisasi</label>
                <input
                  type="text"
                  value={newUser.title}
                  onChange={(e) => setNewUser({ ...newUser, title: e.target.value })}
                  placeholder="Plant Piping Integrity Engineer"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                >
                  {isId ? 'Batal' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                >
                  {busy ? '...' : isId ? 'Simpan Pengguna' : 'Save User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {resetPwdUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold flex items-center">
                <KeyRound className="w-4 h-4 mr-2 text-amber-500" />
                {isId ? 'Reset Password' : 'Reset Password'}
              </h2>
              <button
                type="button"
                onClick={() => setResetPwdUser(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="p-5 space-y-3.5 text-xs">
              <p className="text-slate-600">
                {isId ? 'Masukkan password baru untuk' : 'Enter new password for'}{' '}
                <strong>{resetPwdUser.name}</strong> (@{resetPwdUser.email}).
              </p>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Password Baru</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetPwdUser(null)}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                >
                  {isId ? 'Batal' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                >
                  {busy ? '...' : isId ? 'Ubah Password' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
