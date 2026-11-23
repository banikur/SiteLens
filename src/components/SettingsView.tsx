import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { User } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';
import {
  apiGetRoles,
  apiCreateRole,
  apiUpdateRole,
  apiDeleteRole,
  apiGetPermissionsCatalog,
  type RoleWithPermissions,
  type PermissionItem,
} from '../services/api';

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

  const [activeTab, setActiveTab] = useState<'roles' | 'notifications' | 'audit'>(
    canManageRoles ? 'roles' : 'notifications'
  );

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

      {/* TAB 3: AUDIT TRAIL */}
      {activeTab === 'audit' && canViewAudit && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center space-x-2 text-sm font-bold text-slate-900">
            <History className="w-4 h-4 text-slate-500" />
            <span>{isId ? 'Log Audit Aktivitas (100 Terbaru)' : 'Activity Audit Trail (Latest 100)'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                <tr>
                  <th className="px-4 py-2.5">Time</th>
                  <th className="px-4 py-2.5">Actor</th>
                  <th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Entity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      {isId ? 'Belum ada catatan audit.' : 'No audit entries yet.'}
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 font-semibold text-slate-800">{log.actorName}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-amber-700">{log.action}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {log.entityType} ({log.entityId})
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
