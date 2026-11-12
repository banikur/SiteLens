import React from 'react';
import {
  Award,
  UserCheck,
} from 'lucide-react';
import { User, UserRole } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface TeamManagementProps {
  users: User[];
  activeUser: User;
  onSwitchUser: (userId: string) => void;
}

const ROLE_DESCRIPTIONS_EN: Record<
  UserRole,
  { duties: string; primaryFocus: string }
> = {
  'Site Supervisor': {
    duties:
      'Performs daily site inspections, toolbox safety meetings, PPE compliance checks, and housekeeping walks.',
    primaryFocus: 'Field Safety & Ground Logistics',
  },
  'Site Engineer': {
    duties:
      'Creates structural engineering checklists, conducts works inspections, verifies shoring deflections, and signs off permit-to-work checks.',
    primaryFocus: 'Civil & Geotechnical Integrity',
  },
  'Equipment Operator': {
    duties:
      'Performs daily pre-operational equipment checks on tower cranes, excavators, and hoists before shift operation.',
    primaryFocus: 'Heavy Equipment & Mechanical Safety',
  },
  'HSE Officer': {
    duties:
      'Conducts independent safety inspections, audits hazardous activities, reviews submitted checklists, and manages corrective actions.',
    primaryFocus: 'Regulatory HSE Compliance & Verification',
  },
  'QC Inspector': {
    duties:
      'Performs quality hold-point inspections, pre-pour rebar cover checks, welding inspections, and non-destructive testing.',
    primaryFocus: 'Quality Assurance & Material Standards',
  },
  'Environmental Officer': {
    duties:
      'Monitors sedimentation, water run-off, fuel depot bunding, noise and vibration levels, and environmental compliance.',
    primaryFocus: 'Erosion, Spill Control & Ecology',
  },
  'Site Manager': {
    duties:
      'Reviews aggregate inspection performance, signs off critical high-risk operations, and governs multi-contractor compliance.',
    primaryFocus: 'Executive Governance & Project Delivery',
  },
};

const ROLE_DESCRIPTIONS_ID: Record<
  UserRole,
  { duties: string; primaryFocus: string }
> = {
  'Site Supervisor': {
    duties:
      'Menjalankan inspeksi lokasi harian, rapat keselamatan (toolbox meeting), pemeriksaan kepatuhan APD, dan patroli kerapihan kerja.',
    primaryFocus: 'Keselamatan Lapangan & Logistik Area',
  },
  'Site Engineer': {
    duties:
      'Menyusun checklist rekayasa struktural, melakukan inspeksi pekerjaan sipil, memverifikasi lendutan shoring, dan menyetujui izin kerja.',
    primaryFocus: 'Integritas Sipil & Geoteknik',
  },
  'Equipment Operator': {
    duties:
      'Melakukan pemeriksaan pra-operasi harian pada tower crane, excavator, dan alat angkat sebelum pergantian shift.',
    primaryFocus: 'Alat Berat & Keselamatan Mekanis',
  },
  'HSE Officer': {
    duties:
      'Melaksanakan inspeksi keselamatan independen, mengaudit pekerjaan berisiko tinggi, memverifikasi checklist, dan mengelola tindakan korektif.',
    primaryFocus: 'Kepatuhan Regulasi K3 & Verifikasi',
  },
  'QC Inspector': {
    duties:
      'Melakukan inspeksi hold-point kualitas, pemeriksaan tahu beton & pembesian pra-cor, inspeksi pengelasan, serta pengujian material.',
    primaryFocus: 'Jaminan Mutu (QA/QC) & Standar Material',
  },
  'Environmental Officer': {
    duties:
      'Memantau sedimentasi, limpasan air kerja, tanggul penampung BBM, tingkat kebisingan/getaran, dan kepatuhan lingkungan.',
    primaryFocus: 'Kontrol Erosi, Tumpahan & Ekologi',
  },
  'Site Manager': {
    duties:
      'Meninjau kinerja kepatuhan proyek secara menyeluruh, mengesahkan operasi berisiko tinggi, dan mengawasi kepatuhan lintas kontraktor.',
    primaryFocus: 'Tata Kelola Eksekutif & Penyelesaian Proyek',
  },
};

export const TeamManagement: React.FC<TeamManagementProps> = ({
  users,
  activeUser,
  onSwitchUser,
}) => {
  const { lang, t, translateRole } = useLanguage();
  const descriptions = lang === 'id' ? ROLE_DESCRIPTIONS_ID : ROLE_DESCRIPTIONS_EN;

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
      </div>

      {/* Role Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {users.map((user) => {
          const roleInfo = descriptions[user.role] || {
            duties: 'Site operations team member.',
            primaryFocus: 'Operations',
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
                    <img
                      src={user.avatar}
                      alt={user.name}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-full border border-slate-200 object-cover"
                    />
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

                  {isActive && (
                    <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider shrink-0">
                      {t.team.activeBadge}
                    </span>
                  )}
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
              <div className="mt-5 pt-4 border-t border-slate-100">
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
