import React, { useState } from 'react';
import {
  Fingerprint,
  KeyRound,
  Lock,
  ShieldCheck,
  AlertCircle,
  Users2,
  FolderPlus,
  Compass,
  ArrowRight,
  Shield,
  Eye,
  CheckCircle2,
  Ban,
  Scale,
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

type ScreenMode = 'demo_roles' | 'credentials';
type AuthMode = 'password' | 'pin' | 'biometric';

interface RoleCardData {
  id: string;
  name: string;
  roleTitle: string;
  badge: string;
  avatar: string;
  canDo: string[];
  restrictedFrom: string[];
  fourEyesRole: string;
  defaultActionTab: string;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onAuthenticated,
  onStartGuidedTour,
}) => {
  const { lang, setLang } = useLanguage();
  const isId = lang === 'id';

  const [screenMode, setScreenMode] = useState<ScreenMode>('demo_roles');
  const [authMode, setAuthMode] = useState<AuthMode>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const demoRoles: RoleCardData[] = [
    {
      id: 'usr-hse-1',
      name: 'Elena Rostova',
      roleTitle: isId ? 'QA/QC Lead / Owner Inspector' : 'QA/QC Lead / Inspector',
      badge: isId ? 'Verifikator Mutu & Four-Eyes' : 'Quality Verifier & Four-Eyes',
      avatar: '/src/assets/images/avatar_elena_rostova_1794440488629.jpg',
      canDo: isId ? [
        'Memeriksa & mengesahkan pengajuan inspeksi (Witness/Approval)',
        'Membuka & melepaskan Hold Point teknis di lapangan',
        'Menandatangani sertifikat kelulusan mutu digital / lembar fisik',
        'Menerbitkan & memverifikasi penutupan Punchlist (CAPA)',
      ] : [
        'Inspect and approve stage inspection requests (Witness/Approval)',
        'Unlock and clear technical Hold Points in field execution',
        'Sign digital acceptance certificates / physical scanned sheets',
        'Issue and verify closure of Punchlist (CAPA) findings',
      ],
      restrictedFrom: isId ? [
        'Dilarang meng-approve inspeksi yang diajukan oleh dirinya sendiri (Four-Eyes locked)',
      ] : [
        'Strictly blocked from self-approving own submissions (Four-Eyes locked)',
      ],
      fourEyesRole: isId ? 'Verifikator Independen Wajib' : 'Mandatory Independent Verifier',
      defaultActionTab: 'inspections',
    },
    {
      id: 'usr-sup-1',
      name: 'Dave Kowalski',
      roleTitle: isId ? 'Site Engineer / Pelaksana Lapangan' : 'Site Engineer / Field Lead',
      badge: isId ? 'Pelaksana & Submitter RFI' : 'Field Submitter & Lead',
      avatar: '/src/assets/images/avatar_marcus_vance_1794440487345.jpg',
      canDo: isId ? [
        'Mengajukan Request for Inspection (RFI) tahap pekerjaan',
        'Mengisi lembar ceklis kepatuhan gambar teknis & toleransi',
        'Mengunggah bukti foto lapangan ber-geotag',
        'Membubuhkan tanda tangan pemohon sebelum Hold Point',
      ] : [
        'Submit Request for Inspection (RFI) for assigned work nodes',
        'Complete technical drawing compliance checklists & tolerances',
        'Upload geotagged field evidence photos',
        'Provide submitter digital sign-off engaging Hold Points',
      ],
      restrictedFrom: isId ? [
        'Dilarang mengesahkan hasil inspeksi sendiri tanpa verifikasi QA/QC',
      ] : [
        'Cannot approve own work; Hold Point locks until QA/QC signs',
      ],
      fourEyesRole: isId ? 'Pemohon Lapangan (Submitter)' : 'Field Submitter',
      defaultActionTab: 'projects',
    },
    {
      id: 'usr-pm-1',
      name: 'Arthur Sterling',
      roleTitle: isId ? 'Project Manager / Office Integrity' : 'Project Manager / Integrity Lead',
      badge: isId ? 'Setup Proyek & Alokasi WBS' : 'Project Setup & WBS Owner',
      avatar: '/src/assets/images/avatar_marcus_vance_1794440487345.jpg',
      canDo: isId ? [
        'Membuat & mengonfigurasi Proyek Baru dari awal',
        'Menyusun struktur WBS Tree & menetapkan bobot pekerjaan (%)',
        'Menugaskan Site Engineer & QA/QC ke setiap node pekerjaan',
        'Mencatat log cuaca harian & klaim perpanjangan waktu (EOT)',
        'Melakukan override manual Kurva S jika terjadi deviasi',
      ] : [
        'Create and configure new projects from scratch',
        'Structure WBS Tree and assign work package weights (%)',
        'Assign Site Engineers & QA/QC Inspectors to each node',
        'Log daily weather and calculate recommended EOT claims',
        'Apply manual S-Curve baseline overrides when warranted',
      ],
      restrictedFrom: isId ? [
        'Dilarang memverifikasi inspeksi fisik mandiri di lapangan',
      ] : [
        'Cannot self-certify physical inspection stages on the ground',
      ],
      fourEyesRole: isId ? 'Inisiator Baseline & Pemilik Proyek' : 'Baseline Initiator & Project Owner',
      defaultActionTab: 'projects',
    },
    {
      id: 'usr-admin-1',
      name: 'Arthur Sterling (Admin)',
      roleTitle: isId ? 'Project Director & Tenant Admin' : 'Project Director & Tenant Admin',
      badge: isId ? 'Otoritas Tertinggi Tenant' : 'Tenant Director Authority',
      avatar: '/src/assets/images/avatar_elena_rostova_1794440488629.jpg',
      canDo: isId ? [
        'Akses penuh lintas seluruh proyek dalam satu tenant',
        'Konfigurasi profil kepatuhan ganda SMK3 PP 50/2012 & ISO 45001',
        'Audit trail sistem, log integritas SHA-256, & lisensi pengguna',
        'Setup webhook integrasi ERP & keamanan PIN/Biometrik',
      ] : [
        'Full oversight access across all projects within tenant',
        'Dual-compliance profiling for SMK3 PP 50/2012 & ISO 45001',
        'System audit trail, SHA-256 integrity logs, and user licenses',
        'ERP webhook integration & biometric/PIN security settings',
      ],
      restrictedFrom: isId ? [
        'Tidak difokuskan untuk submit inspeksi teknis harian',
      ] : [
        'Not intended for routine daily field inspection submissions',
      ],
      fourEyesRole: isId ? 'Auditor Final & Eksekutif' : 'Final Executive Auditor',
      defaultActionTab: 'compliance',
    },
    {
      id: 'usr-eng-1',
      name: 'Priya Patel',
      roleTitle: isId ? 'Integrity / Structural Engineer' : 'Integrity / Structural Engineer',
      badge: isId ? 'Spesialis Teknis & Rencana' : 'Technical Specialist',
      avatar: '/src/assets/images/avatar_elena_rostova_1794440488629.jpg',
      canDo: isId ? [
        'Verifikasi acuan gambar kerja (Shop Drawing) & revisi aktif',
        'Memantau perhitungan Kurva S & SLA Aging Bottleneck Radar',
        'Mengajukan rekomendasi teknis perbaikan struktur',
      ] : [
        'Verify shop drawing references and active document revisions',
        'Monitor S-Curve progress and SLA Aging Bottleneck Radar',
        'Formulate technical remediation proposals for structures',
      ],
      restrictedFrom: isId ? [
        'Dilarang memutasi profil K3 tenant tanpa izin Admin',
      ] : [
        'Cannot alter tenant HSE compliance profile without Admin role',
      ],
      fourEyesRole: isId ? 'Peninjau Teknis Spesialis' : 'Specialist Technical Reviewer',
      defaultActionTab: 'projects',
    },
    {
      id: 'usr-viewer-1',
      name: 'Sarah Jenkins',
      roleTitle: isId ? 'Client / Vendor Viewer' : 'Client / Vendor Viewer',
      badge: isId ? 'Mode Pengawas (Read-Only)' : 'Auditor Mode (Read-Only)',
      avatar: '/src/assets/images/avatar_marcus_vance_1794440487345.jpg',
      canDo: isId ? [
        'Memantau Kurva S fisik terverifikasi secara real-time',
        'Melihat radar bottleneck keterlambatan persetujuan SLA',
        'Mengekspor laporan progres & riwayat audit digital',
      ] : [
        'Monitor verified physical S-Curve in real-time',
        'Track SLA approval aging and bottleneck radar alerts',
        'Export progress reports and tamper-evident audit history',
      ],
      restrictedFrom: isId ? [
        'Mode baca saja (Read-only): Tidak dapat mengubah WBS atau mengesahkan inspeksi',
      ] : [
        'Strictly read-only: Cannot mutate WBS nodes or sign off stages',
      ],
      fourEyesRole: isId ? 'Pengawas Eksternal' : 'External Observer',
      defaultActionTab: 'dashboard',
    },
  ];

  const handleSelectDemoRole = (roleData: RoleCardData) => {
    const existing = MOCK_USERS.find((u) => u.id === roleData.id) || {
      id: roleData.id,
      name: roleData.name,
      role: roleData.roleTitle as any,
      title: roleData.roleTitle,
      email: `${roleData.id}@sitelens-demo.internal`,
      avatar: roleData.avatar,
      assignedProjects: ['prj-101', 'prj-102', 'prj-103'],
      certifications: ['API 510', 'ISO 9001', 'SMK3'],
    };

    setActiveUser(existing.id);

    const authUser: AuthenticatedUser = {
      ...existing,
      username: existing.id,
      hasPin: true,
      passkeysCount: 1,
    };

    onAuthenticated(authUser);
  };

  const handleStartDemoScenario = () => {
    const pmRole = demoRoles.find((r) => r.id === 'usr-pm-1') || demoRoles[2];
    handleSelectDemoRole(pmRole);
    if (onStartGuidedTour) {
      setTimeout(() => {
        onStartGuidedTour();
      }, 150);
    }
  };

  const handleSubmitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (authMode === 'password') {
        const user = await loginWithPassword(username, password);
        onAuthenticated(user);
      } else if (authMode === 'pin') {
        const user = await loginWithPin(username, pin);
        onAuthenticated(user);
      } else {
        const user = await loginWithBiometric(username);
        onAuthenticated(user);
      }
    } catch (err: any) {
      if (username) {
        const match = MOCK_USERS.find(
          (u) =>
            u.id.toLowerCase() === username.toLowerCase() ||
            u.name.toLowerCase().includes(username.toLowerCase())
        );
        if (match) {
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
            ? 'Gagal masuk. Gunakan tab "Pilihan Peran Demo" untuk demonstrasi instan.'
            : 'Sign in failed. Please use "Demo Roles & Scenarios" tab for instant access.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#06090e] flex flex-col justify-center items-center p-4 sm:p-6 text-slate-200 select-none">
      <div className="w-full max-w-5xl bg-[#0b0e14] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
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
                  ? 'Sistem Kendali Presisi Operasional & Inspeksi Lapangan'
                  : 'Precision Site Operations & Inspection Control System'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Language Switcher */}
            <div className="flex items-center bg-[#161c28] rounded-md p-0.5 border border-slate-700">
              <button
                type="button"
                onClick={() => setLang('en')}
                className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
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
                className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
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

        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-2 border-b border-slate-800 bg-[#080b10]">
          <button
            type="button"
            onClick={() => setScreenMode('demo_roles')}
            className={`py-3 px-4 text-center font-bold text-xs flex items-center justify-center space-x-2 border-b-2 transition-all ${
              screenMode === 'demo_roles'
                ? 'border-[#d4f038] bg-[#d4f038]/10 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users2 className="w-4 h-4 text-[#d4f038]" />
            <span>
              {isId
                ? 'Pilihan Peran Demo (Matriks Kapabilitas 6 Roles)'
                : 'Demo Roles Explorer (6 Role Capability Matrix)'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setScreenMode('credentials')}
            className={`py-3 px-4 text-center font-bold text-xs flex items-center justify-center space-x-2 border-b-2 transition-all ${
              screenMode === 'credentials'
                ? 'border-[#d4f038] bg-[#d4f038]/10 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Lock className="w-4 h-4 text-[#d4f038]" />
            <span>
              {isId ? 'Masuk Kredensial (Password / PIN / Biometrik)' : 'Sign In with Credentials'}
            </span>
          </button>
        </div>

        {/* Tab 1: Demo Roles & Capability Matrix */}
        {screenMode === 'demo_roles' && (
          <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
            {/* Guided Scenario Banner */}
            <div className="p-4 rounded-xl border border-[#d4f038]/40 bg-[#d4f038]/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-start space-x-3.5">
                <div className="w-10 h-10 rounded-lg bg-[#d4f038] text-[#0b0e14] flex items-center justify-center font-bold shrink-0 mt-0.5">
                  <Compass className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#d4f038] text-[#0b0e14]">
                      {isId ? 'ALUR LENGKAP RESMI' : 'OFFICIAL WORKFLOW'}
                    </span>
                    <h3 className="text-sm font-bold text-white tracking-tight">
                      {isId
                        ? 'Mulai Alur Demonstrasi Dari Awal (End-to-End Walkthrough)'
                        : 'Start Guided End-to-End Demonstration Scenario'}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    {isId
                      ? 'Setup Proyek Baru ➔ Susun WBS & Assign Personel per Node ➔ Login Site Engineer (Submit RFI) ➔ Login QA/QC Lead (Four-Eyes Sign-Off) ➔ Perhatikan S-Curve bergerak real-time!'
                      : 'Setup New Project ➔ WBS Structure & Assign Personnel per Node ➔ Submit RFI as Site Engineer ➔ Four-Eyes Sign-Off as QA/QC Lead ➔ Watch S-Curve advance!'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleStartDemoScenario}
                className="px-4 py-2.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs flex items-center space-x-2 transition-colors shrink-0 shadow-xs"
              >
                <span>{isId ? 'Mulai Skenario Terpandu' : 'Launch Guided Scenario'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Role Capability Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {demoRoles.map((role) => (
                <div
                  key={role.id}
                  className="p-4 rounded-xl border border-slate-800 bg-[#0e131d] hover:border-slate-700 transition-all flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 text-[#d4f038] font-mono font-bold flex items-center justify-center text-xs">
                          {role.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">{role.name}</div>
                          <div className="text-[10px] text-slate-400 leading-tight">
                            {role.roleTitle}
                          </div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[9px] font-mono font-semibold bg-[#161c28] text-[#d4f038] border border-slate-700">
                        {role.badge}
                      </span>
                    </div>

                    {/* Four-Eyes Position Badge */}
                    <div className="p-2 rounded-lg bg-[#06090e] border border-slate-800 text-[10px] flex items-center space-x-2">
                      <Scale className="w-3.5 h-3.5 text-[#d4f038] shrink-0" />
                      <div className="truncate">
                        <span className="text-slate-400">Four-Eyes:</span>{' '}
                        <strong className="text-white">{role.fourEyesRole}</strong>
                      </div>
                    </div>

                    {/* What Can Do */}
                    <div>
                      <div className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider mb-1 flex items-center space-x-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>{isId ? 'Kewenangan Utama:' : 'Key Capabilities:'}</span>
                      </div>
                      <ul className="space-y-1 text-[11px] text-slate-300">
                        {role.canDo.map((item, idx) => (
                          <li key={idx} className="flex items-start space-x-1.5 leading-snug">
                            <span className="text-[#d4f038] mt-0.5">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Restrictions */}
                    <div>
                      <div className="text-[10px] font-semibold text-rose-300 uppercase tracking-wider mb-1 flex items-center space-x-1">
                        <Ban className="w-3 h-3 text-rose-400" />
                        <span>{isId ? 'Restriksi / Larangan:' : 'Strict Restrictions:'}</span>
                      </div>
                      <ul className="space-y-1 text-[11px] text-rose-300/90">
                        {role.restrictedFrom.map((item, idx) => (
                          <li key={idx} className="flex items-start space-x-1.5 leading-snug">
                            <span>✕</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* CTA Button */}
                  <div className="pt-4 mt-3 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => handleSelectDemoRole(role)}
                      className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-[#d4f038] hover:text-[#0b0e14] text-white font-bold text-xs transition-colors flex items-center justify-center space-x-2 shadow-xs"
                    >
                      <span>
                        {isId ? `Masuk sebagai ${role.name.split(' ')[0]}` : `Sign In as ${role.name.split(' ')[0]}`}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 2: Standard Credentials Login */}
        {screenMode === 'credentials' && (
          <div className="p-6 max-w-md mx-auto w-full space-y-5">
            {/* Auth Sub-mode Tabs */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-[#06090e] rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('password');
                  setError(null);
                }}
                className={`flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
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
                className={`flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
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
                className={`flex items-center justify-center space-x-1.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
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
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmitCredentials} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {isId ? 'Username / ID Personel' : 'Username / Personnel ID'}
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required={authMode !== 'biometric'}
                  autoComplete="username"
                  placeholder="admin / manager / engineer / inspector"
                  className="w-full px-3.5 py-2.5 bg-[#06090e] border border-slate-800 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#d4f038] font-mono"
                />
              </div>

              {authMode === 'password' && (
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
                className="w-full py-2.5 px-4 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] disabled:opacity-50 text-[#0b0e14] font-bold text-xs transition-colors flex items-center justify-center space-x-2 shadow-xs"
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

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setScreenMode('demo_roles')}
                className="text-xs text-[#d4f038] hover:underline"
              >
                {isId ? '← Kembali ke Pilihan Peran Demo' : '← Back to Demo Roles'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
