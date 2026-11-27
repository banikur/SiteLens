import React, { useEffect, useState, useRef } from 'react';
import {
  Bell,
  History,
  Send,
  Save,
  CheckCircle2,
  AlertCircle,
  Shield,
  Plus,
  Trash2,
  X,
  Lock,
  FileText,
  Upload,
  Image as ImageIcon,
  Printer,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { User, CompanySettings } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';
import {
  apiGetRoles,
  apiCreateRole,
  apiUpdateRole,
  apiDeleteRole,
  apiGetPermissionsCatalog,
  apiGetCompanySettings,
  apiUpdateCompanySettings,
  type RoleWithPermissions,
  type PermissionItem,
} from '../services/api';
import { getStoredCompanySettings, saveStoredCompanySettings } from '../services/storage';
import { exportSampleLetterheadPdf } from '../utils/pdfGenerator';

interface SettingsViewProps {
  currentUser: User;
}

interface NotificationConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  webhookUrl: string;
  webhookType: 'slack' | 'telegram' | 'generic';
  notifyOnCriticalCapa: boolean;
  notifyOnApproval: boolean;
}

interface AuditLogEntry {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, any>;
  createdAt: string;
}

const MODULE_LABELS_ID: Record<string, string> = {
  project: 'Proyek & Keanggotaan',
  wbs: 'WBS, Bobot & Baseline',
  stage: 'Tahapan Alur Kerja (RFI)',
  inspection: 'Inspeksi Non-WBS',
  capa: 'Temuan Cacat & CAPA',
  template: 'Master Template & Standar',
  flow_preset: 'Konfigurasi Alur RFI',
  schedule: 'Penjadwalan Inspeksi',
  report: 'Monitoring, Cuaca & Laporan',
  weather: 'Log Cuaca & Hujan',
  scurve: 'Kurva-S Proyek',
  tenant: 'Kepatuhan Regulasi SMK3 & B3',
  admin: 'Administrasi Tenant & Akun',
  system: 'Sistem & Break-Glass',
  evidence: 'Bukti Foto & Dokumen',
};

const MODULE_LABELS_EN: Record<string, string> = {
  project: 'Project & Membership',
  wbs: 'WBS, Weights & Baseline',
  stage: 'Workflow Stages (RFI)',
  inspection: 'Non-WBS Inspections',
  capa: 'Defects & CAPA',
  template: 'Checklist Templates',
  flow_preset: 'RFI Flow Presets',
  schedule: 'Inspection Schedules',
  report: 'Monitoring & Reports',
  weather: 'Weather & Rain Logs',
  scurve: 'Project S-Curve',
  tenant: 'SMK3 & Hazardous Compliance',
  admin: 'Tenant & User Administration',
  system: 'System & Break-Glass',
  evidence: 'Photo Evidence & Uploads',
};

export const SettingsView: React.FC<SettingsViewProps> = ({ currentUser: _currentUser }) => {
  const { lang } = useLanguage();
  const isId = lang === 'id';
  const moduleLabels = isId ? MODULE_LABELS_ID : MODULE_LABELS_EN;

  const { can, isLoading: isLoadingPerms } = usePermission();
  const canManageRoles = !isLoadingPerms && can(PERMISSIONS.ADMIN_ROLES);
  const canManageSettings = !isLoadingPerms && can(PERMISSIONS.ADMIN_SETTINGS);
  const canViewAudit = !isLoadingPerms && can(PERMISSIONS.ADMIN_AUDIT);

  const [activeTab, setActiveTab] = useState<'roles' | 'notifications' | 'letterhead' | 'audit'>(
    canManageRoles ? 'roles' : 'letterhead'
  );

  // Corporate Letterhead & Logo State
  const [companySettings, setCompanySettings] = useState<CompanySettings>(() => getStoredCompanySettings());
  const [logoPreview, setLogoPreview] = useState<string>(() => getStoredCompanySettings().companyLogo || '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Notifications State
  const [config, setConfig] = useState<NotificationConfig>({
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    webhookUrl: '',
    webhookType: 'generic',
    notifyOnCriticalCapa: true,
    notifyOnApproval: true,
  });

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const AUDIT_PAGE_SIZE = 15;

  // Roles & Permissions State
  const [rolesList, setRolesList] = useState<RoleWithPermissions[]>([]);
  const [permissionsCatalog, setPermissionsCatalog] = useState<PermissionItem[]>([]);
  const [selectedRole, setSelectedRole] = useState<RoleWithPermissions | null>(null);
  const [activePermSet, setActivePermSet] = useState<Set<string>>(new Set());

  // Create Role Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleId, setNewRoleId] = useState('');
  const [newRolePerms, setNewRolePerms] = useState<Set<string>>(new Set());

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load roles & permissions catalog
  const loadRolesAndPermissions = async () => {
    if (!canManageRoles) return;
    try {
      const [rolesRes, permsRes] = await Promise.all([
        apiGetRoles(),
        apiGetPermissionsCatalog(),
      ]);
      setRolesList(rolesRes.roles);
      setPermissionsCatalog(permsRes.permissions);
      if (rolesRes.roles.length > 0 && !selectedRole) {
        setSelectedRole(rolesRes.roles[0]);
        setActivePermSet(new Set(rolesRes.roles[0].permissions));
      } else if (selectedRole) {
        const refreshed = rolesRes.roles.find((r) => r.id === selectedRole.id);
        if (refreshed) {
          setSelectedRole(refreshed);
          setActivePermSet(new Set(refreshed.permissions));
        }
      }
    } catch (err: any) {
      console.error('Failed to load roles/permissions:', err);
    }
  };

  useEffect(() => {
    if (canManageRoles) {
      void loadRolesAndPermissions();
    }

    // Always fetch latest company settings
    apiGetCompanySettings()
      .then((res) => {
        if (res?.settings) {
          setCompanySettings(res.settings);
          setLogoPreview(res.settings.companyLogo || '');
          saveStoredCompanySettings(res.settings);
        }
      })
      .catch(() => {});

    if (canManageSettings) {
      fetch('/api/notifications/settings', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.settings) {
            setConfig({
              smtpHost: d.settings.smtpHost || '',
              smtpPort: d.settings.smtpPort || 587,
              smtpUser: d.settings.smtpUser || '',
              smtpPass: d.settings.smtpPass || '',
              smtpFrom: d.settings.smtpFrom || '',
              webhookUrl: d.settings.webhookUrl || '',
              webhookType: d.settings.webhookType || 'generic',
              notifyOnCriticalCapa: Boolean(d.settings.notifyOnCriticalCapa),
              notifyOnApproval: Boolean(d.settings.notifyOnApproval),
            });
          }
        })
        .catch(() => {});
    }

    if (canViewAudit) {
      fetch('/api/audit-logs', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.auditLogs) {
            setAuditLogs(d.auditLogs);
          }
        })
        .catch(() => {});
    }
  }, [canManageRoles, canManageSettings, canViewAudit]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg(isId ? 'Ukuran file logo maksimal 2 MB.' : 'Logo file size must be under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setLogoPreview(dataUrl);
      setCompanySettings((prev) => ({ ...prev, companyLogo: dataUrl }));
      setStatusMsg(isId ? 'Logo dipilih. Klik "Simpan Kop Surat" untuk menyimpan permanen.' : 'Logo selected. Click "Save Letterhead" to persist.');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLogoPreview('');
    setCompanySettings((prev) => ({ ...prev, companyLogo: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
    setStatusMsg(isId ? 'Logo dihapus dari pratinjau. Klik "Simpan Kop Surat" untuk menyimpan perubahan.' : 'Logo removed from preview. Click "Save Letterhead" to persist.');
  };

  const handleSaveCompanySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const payload: Partial<CompanySettings> = {
        ...companySettings,
        companyLogo: logoPreview,
      };
      const res = await apiUpdateCompanySettings(payload);
      if (res?.settings) {
        setCompanySettings(res.settings);
        setLogoPreview(res.settings.companyLogo || '');
        saveStoredCompanySettings(res.settings);
      } else {
        saveStoredCompanySettings(payload);
      }
      setStatusMsg(isId ? 'Profil perusahaan & Kop Surat berhasil disimpan. Semua ekspor PDF otomatis menggunakan kop surat ini!' : 'Company letterhead saved successfully. All PDF exports will use this letterhead!');
    } catch (err: any) {
      saveStoredCompanySettings({ ...companySettings, companyLogo: logoPreview });
      setStatusMsg(isId ? 'Kop Surat tersimpan di perangkat lokal.' : 'Letterhead saved to local storage.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadSamplePdf = () => {
    try {
      exportSampleLetterheadPdf({
        lang,
        companySettings: {
          ...companySettings,
          companyLogo: logoPreview,
        },
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal membuat file PDF contoh.');
    }
  };

  const handleSelectRole = (r: RoleWithPermissions) => {
    setSelectedRole(r);
    setActivePermSet(new Set(r.permissions));
    setStatusMsg(null);
    setErrorMsg(null);
  };

  const handleTogglePerm = (permId: string) => {
    if (!selectedRole) return;
    const next = new Set(activePermSet);
    if (next.has(permId)) {
      next.delete(permId);
    } else {
      next.add(permId);
    }
    setActivePermSet(next);
  };

  const handleSaveRolePermissions = async () => {
    if (!selectedRole) return;
    setSaving(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await apiUpdateRole(selectedRole.id, {
        permissions: Array.from(activePermSet),
      });
      setStatusMsg(
        isId
          ? `Hak akses untuk peran ${res.role.name} berhasil diperbarui.`
          : `Permissions for role ${res.role.name} updated successfully.`
      );
      await loadRolesAndPermissions();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update role permissions');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await apiCreateRole({
        name: newRoleName,
        id: newRoleId || undefined,
        permissions: Array.from(newRolePerms),
      });
      setStatusMsg(
        isId
          ? `Peran kustom ${res.role.name} berhasil dibuat.`
          : `Custom role ${res.role.name} created successfully.`
      );
      setCreateModalOpen(false);
      setNewRoleName('');
      setNewRoleId('');
      setNewRolePerms(new Set());
      await loadRolesAndPermissions();
      setSelectedRole(res.role);
      setActivePermSet(new Set(res.role.permissions));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to create custom role');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async (role: RoleWithPermissions) => {
    if (role.isSystem) return;
    const confirmMsg = isId
      ? `Apakah Anda yakin ingin menghapus peran kustom "${role.name}"?`
      : `Are you sure you want to delete custom role "${role.name}"?`;
    if (!window.confirm(confirmMsg)) return;

    setSaving(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      await apiDeleteRole(role.id);
      setStatusMsg(
        isId
          ? `Peran kustom ${role.name} berhasil dihapus.`
          : `Custom role ${role.name} deleted successfully.`
      );
      setSelectedRole(null);
      await loadRolesAndPermissions();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete role');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    setErrorMsg(null);
    setSaving(true);
    try {
      const res = await fetch('/api/notifications/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings.');
      setStatusMsg(isId ? 'Pengaturan notifikasi disimpan.' : 'Notification settings saved.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestNotification = async () => {
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/notifications/test', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.errors?.length) {
        setErrorMsg(data.errors.join(' | '));
      } else if (!data.webhookSent && !data.emailSent) {
        setErrorMsg(
          isId
            ? 'Belum ada Webhook URL atau SMTP Host yang dikonfigurasi.'
            : 'No Webhook URL or SMTP Host configured yet.'
        );
      } else {
        setStatusMsg(
          isId
            ? `Test terkirim (Webhook: ${data.webhookSent ? 'OK' : '-'}, Email: ${data.emailSent ? 'OK' : '-'})`
            : `Test dispatched (Webhook: ${data.webhookSent ? 'OK' : '-'}, Email: ${data.emailSent ? 'OK' : '-'})`
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Test notification failed.');
    }
  };

  // Group catalog permissions by module
  const permsByModule = permissionsCatalog.reduce<Record<string, PermissionItem[]>>(
    (acc, p) => {
      acc[p.module] = acc[p.module] || [];
      acc[p.module].push(p);
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            {isId ? 'Pengaturan & Tata Kelola Sistem' : 'Settings & Governance'}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {isId
              ? 'Kelola peran custom, matriks hak akses RBAC, integrasi notifikasi, serta jejak audit.'
              : 'Manage custom roles, RBAC permission matrices, notification channels, and audit trails.'}
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
          {canManageRoles && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('roles');
                setStatusMsg(null);
                setErrorMsg(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                activeTab === 'roles'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-amber-500" />
              <span>{isId ? 'Peran & Izin' : 'Roles & Permissions'}</span>
            </button>
          )}

          {canManageSettings && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('letterhead');
                setStatusMsg(null);
                setErrorMsg(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                activeTab === 'letterhead'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              <span>{isId ? 'Kop Surat & Logo' : 'Letterhead & Logo'}</span>
            </button>
          )}

          {canManageSettings && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('notifications');
                setStatusMsg(null);
                setErrorMsg(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                activeTab === 'notifications'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Bell className="w-3.5 h-3.5 text-slate-500" />
              <span>{isId ? 'Notifikasi' : 'Notifications'}</span>
            </button>
          )}

          {canViewAudit && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('audit');
                setStatusMsg(null);
                setErrorMsg(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                activeTab === 'audit'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5 text-slate-500" />
              <span>{isId ? 'Jejak Audit' : 'Audit Trail'}</span>
            </button>
          )}
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center space-x-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{statusMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* TAB 1: ROLES & PERMISSIONS */}
      {activeTab === 'roles' && canManageRoles && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Role List (4 Cols) */}
            <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  {isId ? 'Daftar Peran (Roles)' : 'Roles List'}
                </span>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(true)}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] flex items-center space-x-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>{isId ? 'Peran Baru' : 'New Role'}</span>
                </button>
              </div>

              <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1">
                {rolesList.map((r) => {
                  const isSelected = selectedRole?.id === r.id;
                  return (
                    <div
                      key={r.id}
                      onClick={() => handleSelectRole(r)}
                      className={`p-3 rounded-lg border text-xs cursor-pointer transition-all flex items-center justify-between ${
                        isSelected
                          ? 'border-amber-500 bg-amber-50/50 shadow-xs'
                          : 'border-slate-100 hover:border-slate-200 bg-slate-50/50'
                      }`}
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900">{r.name}</span>
                          {r.isSystem ? (
                            <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-slate-200 text-slate-700">
                              System
                            </span>
                          ) : (
                            <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                              Custom
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {r.id} • {r.permissions.length} {isId ? 'izin' : 'perms'}
                        </div>
                      </div>

                      {!r.isSystem && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteRole(r);
                          }}
                          className="p-1 rounded text-slate-400 hover:text-red-600 transition-colors"
                          title={isId ? 'Hapus Peran' : 'Delete Role'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Permission Matrix Editor (8 Cols) */}
            <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 p-5 space-y-5">
              {selectedRole ? (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex items-center space-x-2">
                        <h2 className="text-sm font-bold text-slate-900">{selectedRole.name}</h2>
                        {selectedRole.isSystem && (
                          <span className="text-[10px] font-medium text-slate-500 flex items-center">
                            <Lock className="w-3 h-3 mr-1 text-slate-400" />
                            {isId ? 'Peran Bawaan Sistem' : 'System Role'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {isId
                          ? 'Konfigurasi hak akses permission efektif untuk peran ini.'
                          : 'Configure effective permission privileges for this role.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleSaveRolePermissions}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center space-x-1.5 shrink-0"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{saving ? '...' : isId ? 'Simpan Izin' : 'Save Permissions'}</span>
                    </button>
                  </div>

                  {/* Modules Grouping */}
                  <div className="space-y-5 max-h-[550px] overflow-y-auto pr-2">
                    {Object.entries(permsByModule).map(([mod, pList]) => (
                      <div key={mod} className="space-y-2">
                        <div className="text-[11px] font-bold text-slate-800 uppercase tracking-wider bg-slate-100/80 px-2.5 py-1 rounded">
                          {moduleLabels[mod] || mod}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          {pList.map((perm) => {
                            const isChecked = activePermSet.has(perm.id);
                            return (
                              <label
                                key={perm.id}
                                className={`p-2.5 rounded-lg border flex items-start space-x-2.5 cursor-pointer transition-colors ${
                                  isChecked
                                    ? 'bg-amber-50/40 border-amber-300/80'
                                    : 'bg-white border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleTogglePerm(perm.id)}
                                  className="mt-0.5 rounded text-amber-500 focus:ring-amber-400"
                                />
                                <div className="leading-tight">
                                  <span className="font-mono text-[11px] font-semibold text-slate-900 block">
                                    {perm.id}
                                  </span>
                                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                                    {perm.description}
                                  </span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="py-12 text-center text-slate-400 text-xs">
                  {isId ? 'Pilih peran di sebelah kiri untuk melihat hak akses.' : 'Select a role on the left.'}
                </div>
              )}
            </div>
          </div>

          {/* CREATE ROLE MODAL */}
          {createModalOpen && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center">
                    <Shield className="w-4 h-4 mr-2 text-amber-500" />
                    {isId ? 'Buat Peran Kustom Baru' : 'Create Custom Role'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setCreateModalOpen(false)}
                    className="p-1 rounded text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleCreateRole} className="p-5 space-y-4 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {isId ? 'Nama Peran' : 'Role Name'} *
                    </label>
                    <input
                      type="text"
                      required
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      placeholder="e.g. Junior Field Auditor"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      {isId ? 'Slug / ID (Opsional)' : 'Slug / ID (Optional)'}
                    </label>
                    <input
                      type="text"
                      value={newRoleId}
                      onChange={(e) => setNewRoleId(e.target.value)}
                      placeholder="e.g. junior_field_auditor"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-2">
                      {isId ? 'Pilih Izin Awal:' : 'Initial Permissions:'} ({newRolePerms.size} {isId ? 'dipilih' : 'selected'})
                    </label>
                    <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg p-2.5 space-y-3">
                      {Object.entries(permsByModule).map(([mod, pList]) => (
                        <div key={mod} className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                            {moduleLabels[mod] || mod}
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {pList.map((p) => {
                              const checked = newRolePerms.has(p.id);
                              return (
                                <label
                                  key={p.id}
                                  className="flex items-center space-x-1.5 text-[11px] p-1 rounded hover:bg-slate-50 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const next = new Set(newRolePerms);
                                      if (next.has(p.id)) next.delete(p.id);
                                      else next.add(p.id);
                                      setNewRolePerms(next);
                                    }}
                                    className="rounded text-amber-500"
                                  />
                                  <span className="font-mono truncate">{p.id}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setCreateModalOpen(false)}
                      className="px-3.5 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
                    >
                      {isId ? 'Batal' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      disabled={saving || !newRoleName.trim()}
                      className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                    >
                      {saving ? '...' : isId ? 'Buat Peran' : 'Create Role'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: NOTIFICATIONS */}
      {activeTab === 'notifications' && canManageSettings && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
              <Bell className="w-4 h-4 text-amber-500" />
              <span>{isId ? 'Pengaturan Alert (SMTP & Webhook)' : 'Alert Channels (SMTP & Webhook)'}</span>
            </div>
            <button
              type="button"
              onClick={handleTestNotification}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center space-x-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isId ? 'Kirim Test' : 'Send Test'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Webhook URL</label>
              <input
                type="url"
                value={config.webhookUrl}
                onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Webhook Format</label>
              <select
                value={config.webhookType}
                onChange={(e) =>
                  setConfig({ ...config, webhookType: e.target.value as NotificationConfig['webhookType'] })
                }
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="generic">Generic JSON (WhatsApp / Custom)</option>
                <option value="slack">Slack Incoming Webhook</option>
                <option value="telegram">Telegram Bot Webhook</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">SMTP Host</label>
              <input
                type="text"
                value={config.smtpHost}
                onChange={(e) => setConfig({ ...config, smtpHost: e.target.value })}
                placeholder="smtp.gmail.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">SMTP Port</label>
              <input
                type="number"
                value={config.smtpPort}
                onChange={(e) => setConfig({ ...config, smtpPort: Number(e.target.value) || 587 })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">SMTP User / Recipient</label>
              <input
                type="text"
                value={config.smtpUser}
                onChange={(e) => setConfig({ ...config, smtpUser: e.target.value })}
                placeholder="alerts@company.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">SMTP Password</label>
              <input
                type="password"
                value={config.smtpPass}
                onChange={(e) => setConfig({ ...config, smtpPass: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-2 text-xs text-slate-700">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.notifyOnCriticalCapa}
                onChange={(e) => setConfig({ ...config, notifyOnCriticalCapa: e.target.checked })}
              />
              <span>{isId ? 'Alert pada CAPA High / Critical' : 'Alert on High / Critical CAPA'}</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.notifyOnApproval}
                onChange={(e) => setConfig({ ...config, notifyOnApproval: e.target.checked })}
              />
              <span>{isId ? 'Alert pada Pengajuan & Approval' : 'Alert on Approval Submissions'}</span>
            </label>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center space-x-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? '...' : isId ? 'Simpan Pengaturan' : 'Save Settings'}</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: CORPORATE LETTERHEAD & LOGO KOP SURAT */}
      {activeTab === 'letterhead' && canManageSettings && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Form Configuration Column */}
          <form onSubmit={handleSaveCompanySettings} className="lg:col-span-7 bg-white p-6 rounded-xl border border-slate-200 space-y-5 text-xs shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-blue-600" />
                <h2 className="text-sm font-bold text-slate-900">
                  {isId ? 'Identitas Perusahaan & Kop Surat Resmi' : 'Corporate Identity & Official Letterhead'}
                </h2>
              </div>
              <button
                type="button"
                onClick={handleDownloadSamplePdf}
                className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] flex items-center space-x-1.5 transition-colors border border-blue-200"
                title={isId ? 'Unduh contoh dokumen PDF dengan kop surat saat ini' : 'Download sample PDF with current letterhead'}
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{isId ? 'Cetak Contoh PDF' : 'Sample PDF'}</span>
              </button>
            </div>

            {/* Logo Upload Section */}
            <div className="space-y-2">
              <label className="block font-bold text-slate-800">
                {isId ? 'Logo Perusahaan (Untuk Kop Surat Seluruh PDF)' : 'Company Logo (Used in All PDF Letterheads)'}
              </label>

              <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/70">
                {/* Logo Preview Box */}
                <div className="w-28 h-20 bg-white rounded-lg border border-slate-200 flex items-center justify-center p-2 shrink-0 shadow-2xs overflow-hidden">
                  {logoPreview ? (
                    <img
                      src={logoPreview}
                      alt="Company Logo Preview"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-slate-400 text-center">
                      <ImageIcon className="w-6 h-6 mb-1 text-slate-300" />
                      <span className="text-[9px] font-medium leading-tight">Belum Ada Logo</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-2 text-center sm:text-left">
                  <div className="text-[11px] text-slate-600">
                    {isId
                      ? 'Format yang didukung: PNG (transparan disarankan), JPEG, WebP. Maksimal 2 MB.'
                      : 'Supported formats: PNG (transparent recommended), JPEG, WebP. Max 2 MB.'}
                  </div>
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleLogoUpload}
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] flex items-center space-x-1.5 shadow-2xs transition-colors cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{logoPreview ? (isId ? 'Ganti Logo' : 'Change Logo') : (isId ? 'Upload Logo' : 'Upload Logo')}</span>
                    </button>
                    {logoPreview && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-[11px] flex items-center space-x-1 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{isId ? 'Hapus' : 'Remove'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Input Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-700 mb-1">
                  {isId ? 'Nama Lengkap Perusahaan / Badan Usaha *' : 'Company / Legal Entity Name *'}
                </label>
                <input
                  type="text"
                  required
                  value={companySettings.companyName}
                  onChange={(e) => setCompanySettings({ ...companySettings, companyName: e.target.value })}
                  placeholder="PT ADHI JAYA KONSTRUKSI TBK"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900 font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {isId ? 'Header Lini Usaha (Baris 1)' : 'Business Line Header'}
                </label>
                <input
                  type="text"
                  value={companySettings.letterheadHeader}
                  onChange={(e) => setCompanySettings({ ...companySettings, letterheadHeader: e.target.value })}
                  placeholder="KONTRAKTOR UTAMA & MANAJEMEN KONSTRUKSI TERPADU"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {isId ? 'Akreditasi / Sertifikasi (Baris 2)' : 'Accreditation / Subtitle'}
                </label>
                <input
                  type="text"
                  value={companySettings.letterheadSubheader}
                  onChange={(e) => setCompanySettings({ ...companySettings, letterheadSubheader: e.target.value })}
                  placeholder="Sistem Manajemen Mutu, K3 & Lingkungan (ISO 9001 / ISO 45001 / SMK3 PP 50/2012)"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold text-slate-700 mb-1">
                  {isId ? 'Alamat Kantor Pusat / Head Office' : 'Company Address'}
                </label>
                <input
                  type="text"
                  value={companySettings.companyAddress}
                  onChange={(e) => setCompanySettings({ ...companySettings, companyAddress: e.target.value })}
                  placeholder="Gedung Cyber 2 Tower Lt. 18, Jl. H.R. Rasuna Said Blok X-5 No. 13, Jakarta 12950"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {isId ? 'Telepon / Call Center' : 'Phone Number'}
                </label>
                <input
                  type="text"
                  value={companySettings.companyPhone}
                  onChange={(e) => setCompanySettings({ ...companySettings, companyPhone: e.target.value })}
                  placeholder="+62 21 5290 8800"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {isId ? 'Email Resmi Perusahaan' : 'Official Email'}
                </label>
                <input
                  type="email"
                  value={companySettings.companyEmail}
                  onChange={(e) => setCompanySettings({ ...companySettings, companyEmail: e.target.value })}
                  placeholder="corsec@perusahaan.co.id"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {isId ? 'Situs Web Resmi' : 'Company Website'}
                </label>
                <input
                  type="text"
                  value={companySettings.companyWebsite}
                  onChange={(e) => setCompanySettings({ ...companySettings, companyWebsite: e.target.value })}
                  placeholder="www.perusahaan.co.id"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {isId ? 'Format No. Registrasi SOP / Dokumen' : 'Document Registration No.'}
                </label>
                <input
                  type="text"
                  value={companySettings.documentRegistrationNo}
                  onChange={(e) => setCompanySettings({ ...companySettings, documentRegistrationNo: e.target.value })}
                  placeholder="DOC-REF-SL/2026/01"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-slate-100">
              <span className="text-[11px] text-slate-500 italic">
                {isId ? '✓ Otomatis disematkan pada Blanko Ceklis & Laporan Inspeksi PDF' : '✓ Automatically applied to all Blank Checklists & Inspection PDFs'}
              </span>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? '...' : isId ? 'Simpan Kop Surat' : 'Save Letterhead'}</span>
              </button>
            </div>
          </form>

          {/* Live Preview Column */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-slate-900 text-white px-4 py-3 rounded-xl flex items-center justify-between shadow-xs">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-[#d4f038]" />
                <span className="text-xs font-bold">{isId ? 'Live Pratinjau Kop Surat PDF' : 'Live Letterhead PDF Preview'}</span>
              </div>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                A4 Standard
              </span>
            </div>

            {/* Simulated Paper Sheet */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-md space-y-4 text-slate-900 select-none">
              {/* Paper Kop Surat */}
              <div className="pb-3 border-b-2 border-slate-900 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start space-x-3">
                    {/* Logo display */}
                    <div className="w-14 h-12 bg-slate-50 rounded border border-slate-200 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                      {logoPreview ? (
                        <img src={logoPreview} alt="Logo" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <div className="w-9 h-9 rounded bg-slate-900 text-[#d4f038] font-bold text-xs flex items-center justify-center">
                          SL
                        </div>
                      )}
                    </div>
                    <div>
                      <h3 className="font-extrabold text-xs text-slate-950 uppercase tracking-tight leading-tight">
                        {companySettings.companyName || 'PT SITELENS KONSTRUKSI NUSANTARA'}
                      </h3>
                      <div className="text-[10px] font-bold text-slate-700 leading-tight mt-0.5">
                        {companySettings.letterheadHeader || 'KONTRAKTOR UTAMA & MANAJEMEN KONSTRUKSI TERPADU'}
                      </div>
                      <div className="text-[9px] text-slate-500 leading-tight mt-0.5 line-clamp-1">
                        {companySettings.companyAddress || 'Gedung Cyber 2 Tower Lt. 18, Jl. H.R. Rasuna Said, Jakarta'}
                      </div>
                      <div className="text-[8.5px] text-slate-500 font-mono mt-0.5">
                        Telp: {companySettings.companyPhone || '-'} | Email: {companySettings.companyEmail || '-'}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[9px] font-bold">
                      {isId ? 'DOKUMEN RESMI' : 'OFFICIAL DOC'}
                    </span>
                    <div className="text-[8px] font-mono text-slate-400 mt-1">
                      {companySettings.documentRegistrationNo || 'DOC-REF-SL/01'}
                    </div>
                  </div>
                </div>

                {/* Subheader / ISO line */}
                <div className="text-[8.5px] text-slate-500 text-right italic font-serif pt-1 border-t border-slate-200">
                  {companySettings.letterheadSubheader || 'Sistem Manajemen Mutu, K3 & Lingkungan (ISO 9001 / ISO 45001 / SMK3 PP 50/2012)'}
                </div>
              </div>

              {/* Sample Document Body Content */}
              <div className="space-y-2 pt-1">
                <div className="p-2 rounded bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <span className="font-bold text-[11px] text-slate-800 uppercase">
                    {isId ? 'LAPORAN INSPEKSI MUTU & K3 LAPANGAN' : 'QUALITY & HSE FIELD INSPECTION REPORT'}
                  </span>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    PASS / APPROVED
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] bg-slate-50/50 p-2.5 rounded border border-slate-100">
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase font-bold">Proyek</span>
                    <span className="font-semibold text-slate-800">Menara Sudirman Tower Phase 2</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase font-bold">Site / Zona</span>
                    <span className="font-semibold text-slate-800">Zone A - Level 14 Rebar Inspection</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase font-bold">Inspektur</span>
                    <span className="font-semibold text-slate-800">Budi Santoso (Field QC)</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase font-bold">Verifikator</span>
                    <span className="font-semibold text-slate-800">Ir. Hendra Gunawan (QA/QC Lead)</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-blue-50/80 border border-blue-200 text-blue-900 text-[10px] leading-relaxed">
                  💡 <strong>Informasi Sistem:</strong> Kop surat ini telah aktif terintegrasi dengan modul pembuatan blanko ceklis kosong ([pdfGenerator](file:///c:/Users/Programer/Documents/SiteLens/src/utils/pdfGenerator.ts)) dan laporan resmi inspeksi lapangan.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: ENHANCED AUDIT TRAIL WITH SEARCH & PAGINATION */}
      {activeTab === 'audit' && canViewAudit && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          {/* Header & Search Bar */}
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
              <History className="w-4 h-4 text-slate-600" />
              <span>{isId ? 'Log Audit Aktivitas & Tata Kelola Keamanan' : 'Activity Audit Trail & Security Governance'}</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                {auditLogs.length} total
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => {
                    setAuditSearch(e.target.value);
                    setAuditPage(1);
                  }}
                  placeholder={isId ? 'Cari aktor, aksi, atau entitas...' : 'Search actor, action, or entity...'}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-slate-800"
                />
              </div>
            </div>
          </div>

          {/* Audit Logs Table */}
          {(() => {
            const filtered = auditLogs.filter((log) => {
              if (!auditSearch) return true;
              const q = auditSearch.toLowerCase();
              return (
                (log.actorName && log.actorName.toLowerCase().includes(q)) ||
                (log.action && log.action.toLowerCase().includes(q)) ||
                (log.entityType && log.entityType.toLowerCase().includes(q)) ||
                (log.entityId && log.entityId.toLowerCase().includes(q))
              );
            });

            const totalPages = Math.max(1, Math.ceil(filtered.length / AUDIT_PAGE_SIZE));
            const currentPage = Math.min(auditPage, totalPages);
            const startIdx = (currentPage - 1) * AUDIT_PAGE_SIZE;
            const pageLogs = filtered.slice(startIdx, startIdx + AUDIT_PAGE_SIZE);

            return (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                      <tr>
                        <th className="px-4 py-2.5">Waktu</th>
                        <th className="px-4 py-2.5">Aktor / Pengguna</th>
                        <th className="px-4 py-2.5">Aksi Keamanan</th>
                        <th className="px-4 py-2.5">Entitas Terkait</th>
                        <th className="px-4 py-2.5">Metadata Perubahan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pageLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                            {auditSearch
                              ? (isId ? 'Tidak ada catatan audit yang cocok dengan pencarian.' : 'No audit entries match search.')
                              : (isId ? 'Belum ada catatan audit.' : 'No audit entries recorded yet.')}
                          </td>
                        </tr>
                      ) : (
                        pageLogs.map((log) => {
                          const isCreate = log.action.includes('CREATE') || log.action.includes('ADD');
                          const isDelete = log.action.includes('DELETE') || log.action.includes('REMOVE');
                          const isUpdate = log.action.includes('UPDATE') || log.action.includes('PATCH');
                          return (
                            <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                                {new Date(log.createdAt).toLocaleString('id-ID', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </td>
                              <td className="px-4 py-2.5 font-bold text-slate-900 whitespace-nowrap">
                                {log.actorName}
                              </td>
                              <td className="px-4 py-2.5 whitespace-nowrap">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                                    isCreate
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : isDelete
                                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                      : isUpdate
                                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                      : 'bg-slate-100 text-slate-700 border border-slate-200'
                                  }`}
                                >
                                  {log.action}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-slate-700 font-medium whitespace-nowrap">
                                <span className="font-semibold text-slate-900">{log.entityType}</span>
                                <span className="text-[10px] font-mono text-slate-400 ml-1.5 truncate max-w-[120px] inline-block align-bottom">
                                  ({log.entityId})
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-slate-500 font-mono text-[10px] max-w-xs truncate">
                                {log.metadata ? JSON.stringify(log.metadata) : '-'}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {filtered.length > AUDIT_PAGE_SIZE && (
                  <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between text-xs text-slate-600">
                    <div>
                      Menampilkan <span className="font-bold">{startIdx + 1}</span> s/d{' '}
                      <span className="font-bold">{Math.min(startIdx + AUDIT_PAGE_SIZE, filtered.length)}</span> dari{' '}
                      <span className="font-bold">{filtered.length}</span> log
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-1.5 rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="font-bold text-slate-800">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAuditPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="p-1.5 rounded-lg border border-slate-300 hover:bg-white disabled:opacity-40 cursor-pointer"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
};
