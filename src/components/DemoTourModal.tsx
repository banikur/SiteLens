import React, { useState } from 'react';
import {
  X,
  Compass,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  FolderPlus,
  Users2,
  Send,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  Play,
  RotateCcw,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { User } from '../types';

interface DemoTourModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tab: any) => void;
  onSwitchUser: (userId: string) => void;
  allUsers: User[];
  onOpenProjectStudio?: () => void;
}

export const DemoTourModal: React.FC<DemoTourModalProps> = ({
  isOpen,
  onClose,
  onSelectTab,
  onSwitchUser,
  allUsers,
  onOpenProjectStudio,
}) => {
  const { lang } = useLanguage();
  const isId = lang === 'id';
  const [currentStep, setCurrentStep] = useState<number>(1);

  if (!isOpen) return null;

  const steps = [
    {
      step: 1,
      title: isId ? 'Langkah 1: Setup Proyek Baru' : 'Step 1: Setup New Project',
      roleTitle: isId ? 'Project Manager / Tenant Admin' : 'Project Manager / Tenant Admin',
      recommendedUser: 'Arthur Sterling',
      userRoleKeyword: 'manager',
      icon: FolderPlus,
      highlight: isId ? 'Inisiasi Parameter Kontrak' : 'Contract Baseline Setup',
      desc: isId
        ? 'Alur resmi SiteLens dimulai dari inisiasi proyek baru sebelum data dummy dioperasikan. Masuk sebagai Project Manager untuk menentukan nama proyek, kode kontrak, zona risiko K3, dan target baseline.'
        : 'The formal SiteLens lifecycle begins by initializing a new project. Log in as Project Manager to define project name, contract code, safety risk zones, and baseline milestones.',
      whatToDo: isId ? [
        'Buka tab "Proyek & WBS" pada bilah navigasi kiri.',
        'Klik tombol "+ Tambah Proyek Baru" di sudut kanan atas.',
        'Masukkan nama proyek (contoh: "Pembangunan Flyover Simpang Susun") dan tentukan zona kerja risiko tinggi.',
        'Simpan proyek untuk membuka kanvas WBS Studio.',
      ] : [
        'Open "Projects & WBS" from the left navigation bar.',
        'Click "+ New Project" button in the upper right.',
        'Enter project name and define high-risk safety zones.',
        'Save project to unlock the WBS Studio canvas.',
      ],
      actionLabel: isId ? 'Buka Menu Proyek Sebagai PM' : 'Open Projects Menu as PM',
      actionHandler: () => {
        const pmUser = allUsers.find(
          (u) => u.name.toLowerCase().includes('arthur') || u.role.toLowerCase().includes('manager')
        );
        if (pmUser) onSwitchUser(pmUser.id);
        onSelectTab('projects');
        onClose();
      },
    },
    {
      step: 2,
      title: isId ? 'Langkah 2: Susun WBS & Assign Personel ke Node' : 'Step 2: WBS Tree & Assign Personnel per Node',
      roleTitle: isId ? 'Project Manager / Office Integrity' : 'Project Manager / Integrity Lead',
      recommendedUser: 'Arthur Sterling',
      userRoleKeyword: 'manager',
      icon: Users2,
      highlight: isId ? 'Penetapan Submitter & Verifikator' : 'Assign Submitter & Verifier',
      desc: isId
        ? 'Setiap node pekerjaan di WBS memerlukan penugasan personel yang jelas: siapa Site Engineer (Pelaksana Lapangan) yang berhak mengajukan RFI/inspeksi, dan siapa QA/QC Inspector yang bertugas mengesahkan.'
        : 'Every WBS work node requires explicit personnel assignment: designating which Site Engineer submits inspection requests, and which QA/QC Inspector validates hold points.',
      whatToDo: isId ? [
        'Di dalam Proyek, klik tombol "WBS Studio".',
        'Pilih preset standar (General EPC / Civil Building) atau buat node baru (contoh: "1.1 Pembesian Pile Cap").',
        'Di form edit node, tentukan "Site Engineer (Pelaksana)" dan "QA/QC Inspector (Verifikator)".',
        'Struktur tersimpan dan siap dipraktekkan oleh personel yang ditugaskan.',
      ] : [
        'Inside your project, click "WBS Studio".',
        'Apply an engineering preset or add a new node (e.g. "1.1 Pile Cap Rebar").',
        'In the node form, select the assigned Site Engineer and QA/QC Inspector.',
        'Assignments are saved and ready for field execution.',
      ],
      actionLabel: isId ? 'Buka WBS Studio' : 'Open WBS Studio',
      actionHandler: () => {
        onSelectTab('projects');
        onOpenProjectStudio?.();
        onClose();
      },
    },
    {
      step: 3,
      title: isId ? 'Langkah 3: Action Lapangan per Assigned Personel' : 'Step 3: Field Action by Assigned Engineer',
      roleTitle: isId ? 'Site Engineer / Pelaksana Lapangan' : 'Site Engineer / Field Lead',
      recommendedUser: 'Dave Kowalski / Priya Patel',
      userRoleKeyword: 'engineer',
      icon: Send,
      highlight: isId ? 'Pengajuan RFI & Kunci Hold Point' : 'Submit RFI & Engage Hold Point',
      desc: isId
        ? 'Beralih ke akun Site Engineer yang ditugaskan. Hanya personel pelaksana yang berwenang mengajukan Request for Inspection (RFI). Saat diajukan, Hold Point otomatis aktif dan mengunci tahapan berikutnya!'
        : 'Switch to the assigned Site Engineer account. Only authorized field engineers can submit inspection requests. Once submitted, the Hold Point automatically locks subsequent stages.',
      whatToDo: isId ? [
        'Ganti persona login menjadi "Dave Kowalski (Site Engineer)".',
        'Buka node WBS yang ditugaskan -> Klik "Tahapan & Hold Point".',
        'Klik "Ajukan Inspeksi Tahap 1" -> Isi checklist kepatuhan gambar teknis.',
        'Bubuhkan tanda tangan digital pemohon -> Status menjadi "Submitted / Pending Review".',
      ] : [
        'Switch persona to "Dave Kowalski (Site Engineer)".',
        'Open assigned WBS node -> Click "Stages & Hold Point".',
        'Click "Submit Stage 1 Attempt" -> Fill technical verification items.',
        'Provide digital sign-off -> Stage status becomes "Submitted / Pending Review".',
      ],
      actionLabel: isId ? 'Switch ke Site Engineer (Dave Kowalski)' : 'Switch to Site Engineer (Dave)',
      actionHandler: () => {
        const engUser = allUsers.find(
          (u) => u.name.toLowerCase().includes('dave') || u.role.toLowerCase().includes('engineer') || u.role.toLowerCase().includes('pelaksana')
        );
        if (engUser) onSwitchUser(engUser.id);
        onSelectTab('projects');
        onOpenProjectStudio?.();
        onClose();
      },
    },
    {
      step: 4,
      title: isId ? 'Langkah 4: Four-Eyes Sign-Off & S-Curve Real-Time' : 'Step 4: Four-Eyes Sign-Off & S-Curve Updates',
      roleTitle: isId ? 'QA/QC Lead / Owner Inspector' : 'QA/QC Lead / Inspector',
      recommendedUser: 'Elena Rostova / Marcus Chen',
      userRoleKeyword: 'inspector',
      icon: ShieldCheck,
      highlight: isId ? 'Verifikasi Independen & Bobot Bertambah' : 'Independent Verification & Verified Progress',
      desc: isId
        ? 'Beralih ke akun QA/QC Inspector yang ditugaskan. Sistem menegakkan Four-Eyes Principle: pelaksana dilarang mengesahkan inspeksinya sendiri. Setelah QA/QC menandatangani sertifikat, Hold Point terbuka dan Kurva S langsung melonjak!'
        : 'Switch to the assigned QA/QC Inspector. The system enforces the Four-Eyes Principle: submitters cannot self-approve. Once signed by QA/QC, the Hold Point releases and verified physical progress updates in real-time.',
      whatToDo: isId ? [
        'Ganti persona login menjadi "Elena Rostova (QA/QC Lead)".',
        'Buka pengajuan inspeksi yang berstatus "Submitted".',
        'Periksa bukti foto dan toleransi deviasi -> Klik "Setujui (Approved)".',
        'Tanda tangan digital verifikator -> Perhatikan Kurva S dan Bottleneck Radar bergerak otomatis!',
      ] : [
        'Switch persona to "Elena Rostova (QA/QC Lead)".',
        'Open the pending inspection stage.',
        'Review geotagged evidence -> Click "Approve".',
        'Sign verification stamp -> Watch verified S-Curve and SLA radar update instantly!',
      ],
      actionLabel: isId ? 'Switch ke QA/QC Lead (Elena Rostova)' : 'Switch to QA/QC Lead (Elena)',
      actionHandler: () => {
        const qcUser = allUsers.find(
          (u) => u.name.toLowerCase().includes('elena') || u.role.toLowerCase().includes('marcus') || u.role.toLowerCase().includes('qc') || u.role.toLowerCase().includes('inspector')
        );
        if (qcUser) onSwitchUser(qcUser.id);
        onSelectTab('projects');
        onOpenProjectStudio?.();
        onClose();
      },
    },
  ];

  const current = steps[currentStep - 1];
  const StepIcon = current.icon;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/85 backdrop-blur-xs flex items-center justify-center p-4 select-none">
      <div className="bg-[#0b0e14] border border-slate-700/90 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#0e131d]">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-[#d4f038] text-[#0b0e14] flex items-center justify-center font-bold">
              <Compass className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  {isId ? 'Panduan Alur Operasional SiteLens' : 'SiteLens Precision Walkthrough Tour'}
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-[#d4f038]/15 border border-[#d4f038]/30 text-[#d4f038] font-mono text-[10px] font-bold">
                  {isId ? `Tahap ${currentStep} dari 4` : `Step ${currentStep} of 4`}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isId ? 'Setup Proyek ➔ Assign Personel WBS ➔ Action Lapangan ➔ Four-Eyes Sign-Off' : 'Project Setup ➔ Assign Personnel ➔ Field Action ➔ Four-Eyes Sign-Off'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title={isId ? 'Tutup panduan' : 'Close tour'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Progress Bar */}
        <div className="grid grid-cols-4 border-b border-slate-800 bg-[#080b10]">
          {steps.map((s) => {
            const isDone = s.step < currentStep;
            const isCurrent = s.step === currentStep;
            return (
              <button
                key={s.step}
                type="button"
                onClick={() => setCurrentStep(s.step)}
                className={`py-2 px-3 text-left border-b-2 transition-all flex items-center space-x-2 ${
                  isCurrent
                    ? 'border-[#d4f038] bg-[#d4f038]/10 text-white font-bold'
                    : isDone
                    ? 'border-emerald-500/60 bg-emerald-500/5 text-slate-300'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold shrink-0 ${
                    isCurrent
                      ? 'bg-[#d4f038] text-[#0b0e14]'
                      : isDone
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {isDone ? <CheckCircle2 className="w-3 h-3" /> : s.step}
                </div>
                <div className="truncate hidden sm:block text-[11px]">
                  {s.step === 1
                    ? isId ? '1. Setup' : '1. Setup'
                    : s.step === 2
                    ? isId ? '2. Assign WBS' : '2. Assign WBS'
                    : s.step === 3
                    ? isId ? '3. Submit RFI' : '3. Submit RFI'
                    : isId ? '4. Four-Eyes' : '4. Four-Eyes'}
                </div>
              </button>
            );
          })}
        </div>

        {/* Step Content Body */}
        <div className="p-6 space-y-5 flex-1 bg-[#0b0e14]">
          {/* Main Step Headline Card */}
          <div className="p-4 rounded-xl border border-slate-800 bg-[#101522] flex items-start space-x-4">
            <div className="w-12 h-12 rounded-xl bg-[#d4f038]/15 border border-[#d4f038]/30 flex items-center justify-center text-[#d4f038] shrink-0">
              <StepIcon className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#d4f038] text-[#0b0e14]">
                  {current.highlight}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {isId ? 'Peran Kunci:' : 'Key Role:'} <strong className="text-white">{current.roleTitle}</strong>
                </span>
              </div>
              <h2 className="text-base font-bold text-white mt-1.5 tracking-tight">
                {current.title}
              </h2>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {current.desc}
              </p>
            </div>
          </div>

          {/* Action Checklist Box */}
          <div className="p-4 rounded-xl border border-slate-800/80 bg-[#0e131d] space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-200">
              <span>{isId ? 'Urutan Eksekusi Praktik di Demo:' : 'Hands-on Execution Sequence:'}</span>
              <span className="text-[10px] font-mono text-[#d4f038]">
                {isId ? 'Rekomendasi Akun:' : 'Recommended Account:'} {current.recommendedUser}
              </span>
            </div>
            <ul className="space-y-2 text-xs text-slate-300">
              {current.whatToDo.map((item, idx) => (
                <li key={idx} className="flex items-start space-x-2.5">
                  <span className="w-4 h-4 rounded-full bg-[#161c28] border border-slate-700 text-[#d4f038] font-mono font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span className="leading-snug">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-[#0e131d] flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <button
              type="button"
              disabled={currentStep === 1}
              onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
              className="px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent text-xs font-semibold flex items-center space-x-1.5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{isId ? 'Sebelumnya' : 'Previous'}</span>
            </button>
            <button
              type="button"
              disabled={currentStep === steps.length}
              onClick={() => setCurrentStep((prev) => Math.min(steps.length, prev + 1))}
              className="px-3 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent text-xs font-semibold flex items-center space-x-1.5 transition-colors"
            >
              <span>{isId ? 'Berikutnya' : 'Next'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center space-x-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-slate-400 hover:text-slate-200 text-xs font-medium transition-colors"
            >
              {isId ? 'Tutup' : 'Dismiss'}
            </button>
            <button
              type="button"
              onClick={current.actionHandler}
              className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-xs font-bold transition-colors flex items-center space-x-2 shadow-xs"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{current.actionLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
