/**
 * Canonical Permission Keys for SiteLens RBAC System.
 * Shared between backend (Express/Drizzle) and frontend (React/Vite).
 * Corresponds to Section F.4 of RECONSTRUCTION_BLUEPRINT.md v2.3.
 */

export const PERMISSIONS = {
  // Proyek & Keanggotaan
  PROJECT_VIEW: 'project.view',                     // [ORG/PRJ] Melihat daftar & detail proyek
  PROJECT_CREATE: 'project.create',                 // [ORG] Membuat entitas proyek baru
  PROJECT_EDIT: 'project.edit',                     // [PRJ] Mengedit parameter/metadata proyek
  PROJECT_MANAGE_MEMBERS: 'project.manage_members', // [PRJ] Mengelola tim & role proyek

  // WBS, Bobot & Baseline (D3)
  WBS_VIEW: 'wbs.view',                             // [ORG/PRJ] Melihat pohon WBS
  WBS_EDIT_STRUCTURE: 'wbs.edit_structure',         // [ORG] HO/PMO: susun paket kerja level atas
  WBS_EDIT_DETAIL: 'wbs.edit_detail',               // [PRJ] Site: tambah aktivitas di bawah allow_detailing
  WBS_FREEZE_BASELINE: 'wbs.freeze_baseline',       // [ORG] HO/PMO: bekukan baseline acuan (R-0)
  WBS_REQUEST_CHANGE: 'wbs.request_change',         // [PRJ] Site: ajukan change request
  WBS_APPROVE_CHANGE: 'wbs.approve_change',         // [ORG] HO/PMO: setujui change request

  // Tahapan Alur Kerja / RFI (D1)
  STAGE_VIEW: 'stage.view',                         // [ORG/PRJ] Melihat alur kerja stage
  STAGE_REQUEST: 'stage.request',                   // [PRJ] Site Engineer: ajukan RFI (status -> requested)
  STAGE_EXECUTE: 'stage.execute',                   // [PRJ] Inspector: isi checklist & foto (status -> submitted)
  STAGE_APPROVE: 'stage.approve',                   // [PRJ] QA/QC Lead / Owner: sign-off four-eyes
  STAGE_OVERRIDE: 'stage.override',                 // [ORG] HO Director / Owner Rep: bypass darurat

  // Inspeksi Non-WBS (Routine & Adhoc)
  INSPECTION_ROUTINE: 'inspection.routine',         // [PRJ] Jalankan inspeksi berkala terjadwal
  INSPECTION_ADHOC: 'inspection.adhoc',             // [PRJ] Buat inspeksi/temuan mendadak
  INSPECTION_REVIEW: 'inspection.routine_review',   // [PRJ] Review & approval inspeksi routine/adhoc
  INSPECTION_DELETE: 'inspection.delete',           // [PRJ] Hapus draf inspeksi yang belum disubmit

  // Temuan Cacat & CAPA
  CAPA_VIEW: 'capa.view',                           // [ORG/PRJ] Melihat daftar CAPA
  CAPA_CREATE: 'capa.create',                       // [PRJ] Terbitkan temuan ketidaksesuaian
  CAPA_UPDATE_PROGRESS: 'capa.update_progress',     // [PRJ] Pelaksana: update progres perbaikan
  CAPA_CLOSE: 'capa.close',                         // [PRJ] QA/QC: verifikasi & tutup temuan (anti self-closing)

  // Master Template & Standar Mutu
  TEMPLATE_VIEW: 'template.view',                   // [ORG/PRJ] Melihat perpustakaan template
  TEMPLATE_MANAGE: 'template.manage',               // [ORG] Buat/edit template standar organisasi
  TEMPLATE_DELETE: 'template.delete',               // [ORG] Hapus template yang tidak terikat riwayat

  // Konfigurasi Alur & Penjadwalan
  FLOW_PRESET_MANAGE: 'flow_preset.manage',         // [ORG] Kelola preset alur RFI
  SCHEDULE_MANAGE: 'schedule.manage',               // [PRJ] Atur jadwal inspeksi rutin proyek

  // Monitoring, Cuaca, Kurva-S & Laporan
  REPORT_VIEW: 'report.view',                       // [ORG/PRJ] Melihat dasbor Kurva-S & radar
  REPORT_EXPORT: 'report.export',                   // [PRJ] Ekspor laporan resmi format PDF
  WEATHER_LOG: 'weather.log',                       // [PRJ] Catat jam hujan & kondisi cuaca
  SCURVE_OVERRIDE: 'scurve.override',               // [PRJ] Site PM: penimpaan kurva target rencana

  // Kepatuhan Regulasi & Fasilitas
  TENANT_COMPLIANCE_MANAGE: 'tenant.compliance_manage', // [ORG] Kelola kepatuhan SMK3 & B3

  // Administrasi Tenant & Sistem
  ADMIN_ROLES: 'admin.roles',                       // [ORG] Kelola role kustom & permission
  ADMIN_USERS: 'admin.users',                       // [ORG] Kelola akun pengguna & aktivasi
  ADMIN_AUDIT: 'admin.audit',                       // [ORG] Melihat log jejak audit mutasi
  ADMIN_SETTINGS: 'admin.settings',                 // [ORG] Konfigurasi server & integrasi
  SYSTEM_BREAK_GLASS: 'system.break_glass',         // [ORG] Akses pemulihan bencana (teraudit penuh)

  // Bukti Foto & Dokumen
  EVIDENCE_UPLOAD: 'evidence.upload',               // [PRJ] Upload foto/dokumen bukti inspeksi
} as const;

export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS];
