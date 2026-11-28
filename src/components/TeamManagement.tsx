import React, { useState, useEffect } from 'react';
import {
  UserCheck,
  UserPlus,
  KeyRound,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  X,
  Save,
  Shield,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Layers,
  Eye,
  Upload,
  Download,
  Edit2,
  Camera,
  Trash2,
  Fingerprint,
} from 'lucide-react';
import { escapeCsvCell } from '../utils/sanitize';
import { TeamImportModal } from './TeamImportModal';
import { User, UserRole, Project } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';
import {
  apiGetRoles,
  apiGetProjectMembers,
  apiAddProjectMember,
  apiRemoveProjectMember,
  type RoleWithPermissions,
  type ProjectMemberItem,
} from '../services/api';

interface TeamManagementProps {
  users: User[];
  activeUser: User;
  onSwitchUser: (userId: string) => void;
  onRefreshData?: () => void;
  projects?: Project[];
}

export const TeamManagement: React.FC<TeamManagementProps> = ({
  users,
  activeUser,
  onSwitchUser,
  onRefreshData,
  projects,
}) => {
  const { lang, t, translateRole } = useLanguage();
  const isId = lang === 'id';
  const { can, isLoading: isLoadingPerms } = usePermission();
  const isTenantAdmin =
    !isLoadingPerms &&
    (can(PERMISSIONS.ADMIN_USERS) || can(PERMISSIONS.PROJECT_MANAGE_MEMBERS));
  const isFocusMode = (activeUser as any)?.focusMode === 'setup-flow';

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [projectMembers, setProjectMembers] = useState<ProjectMemberItem[]>([]);
  const [rolesList, setRolesList] = useState<RoleWithPermissions[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [groupByRole, setGroupByRole] = useState(true);
  const [collapsedRoles, setCollapsedRoles] = useState<Set<string>>(new Set());
  const [previewUser, setPreviewUser] = useState<User | null>(null);
  const [activeCategoryTab, setActiveCategoryTab] = useState<'internal' | 'external'>('internal');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    title: '',
    avatar: '',
    role: 'Field / QC Inspector' as UserRole,
    userCategory: 'internal' as 'internal' | 'external',
    employeeCode: '',
    phone: '',
    organizationName: '',
  });

  const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,40}$/;
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_REGEX = /^\+?[0-9\s-]{8,18}$/;
  const EMPLOYEE_CODE_REGEX = /^[A-Za-z0-9._/-]{2,40}$/;

  const handleAvatarUpload = (
    file: File | undefined,
    onLoaded: (dataUrl: string) => void
  ) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setModalError(isId ? 'Format foto harus PNG, JPG, atau WEBP.' : 'Photo must be PNG, JPG, or WEBP.');
      return;
    }
    if (file.size > 1.5 * 1024 * 1024) {
      setModalError(isId ? 'Ukuran foto maksimal 1.5 MB.' : 'Maximum photo size is 1.5 MB.');
      return;
    }
    setModalError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onLoaded(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const getEffectiveCategory = (u: User): 'internal' | 'external' => {
    if (
      u.role === 'Action Owner / Subcontractor' ||
      u.role === 'Client / Vendor Viewer' ||
      u.role === 'Action Owner / Pelaksana Perbaikan'
    ) {
      return 'external';
    }
    if (u.userCategory === 'internal' || u.userCategory === 'external') return u.userCategory;
    return 'internal';
  };

  const internalCount = users.filter((u) => getEffectiveCategory(u) === 'internal').length;
  const externalCount = users.filter((u) => getEffectiveCategory(u) === 'external').length;

  const toggleRoleGroup = (role: string) => {
    setCollapsedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const filteredUsers = users.filter((u) => {
    if (getEffectiveCategory(u) !== activeCategoryTab) return false;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' ? u.isActive !== false : u.isActive === false);
    const q = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      u.name.toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.title || '').toLowerCase().includes(q) ||
      (u.employeeCode || '').toLowerCase().includes(q) ||
      (u.organizationName || '').toLowerCase().includes(q) ||
      (u.phone || '').toLowerCase().includes(q) ||
      translateRole(u.role).toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  const handleExportTeamCsv = () => {
    const headers = ['Name', 'Email', 'NIK/Kode', 'Phone', 'Divisi/Perusahaan', 'Category', 'Role', 'Title', 'Status'];
    const rows = filteredUsers.map((u) => [
      escapeCsvCell(u.name),
      escapeCsvCell(u.email),
      escapeCsvCell(u.employeeCode || ''),
      escapeCsvCell(u.phone || ''),
      escapeCsvCell(u.organizationName || ''),
      escapeCsvCell(getEffectiveCategory(u)),
      escapeCsvCell(u.role),
      escapeCsvCell(u.title || ''),
      escapeCsvCell(u.isActive === false ? 'Inactive' : 'Active'),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sitelens_team_${activeCategoryTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openEditProfile = (u: User) => {
    setModalError(null);
    setEditUser(u);
    setEditForm({
      name: u.name,
      title: u.title || '',
      avatar: u.avatar || '',
      role: u.role,
      userCategory: getEffectiveCategory(u),
      employeeCode: u.employeeCode || '',
      phone: u.phone || '',
      organizationName: u.organizationName || '',
    });
  };

  const handleSaveProfileEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setModalError(null);
    const trimmedCode = editForm.employeeCode.trim();
    const trimmedPhone = editForm.phone.trim();
    if (trimmedCode && !EMPLOYEE_CODE_REGEX.test(trimmedCode)) {
      setModalError(
        isId
          ? 'Format NIK / Kode Vendor tidak valid (2-40 karakter: huruf, angka, . _ / -).'
          : 'Invalid Employee/Vendor Code (2-40 chars: letters, numbers, . _ / -).'
      );
      return;
    }
    if (trimmedPhone && !PHONE_REGEX.test(trimmedPhone)) {
      setModalError(
        isId
          ? 'Format No. HP tidak valid (8-18 digit, boleh awalan + atau spasi/-).'
          : 'Invalid phone format (8-18 digits, optional +, spaces, or -).'
      );
      return;
    }

    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: editForm.name,
          title: editForm.title,
          avatar: editForm.avatar,
          role: editForm.role,
          userCategory: editForm.userCategory,
          employeeCode: trimmedCode,
          phone: trimmedPhone,
          organizationName: editForm.organizationName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update profile');
      setStatusMsg(isId ? `Profil ${editForm.name} berhasil diperbarui.` : `Profile for ${editForm.name} updated.`);
      setEditUser(null);
      onRefreshData?.();
    } catch (err: any) {
      setModalError(err?.message || 'Error updating profile');
    } finally {
      setBusy(false);
    }
  };
  const [assignModalUser, setAssignModalUser] = useState<User | null>(null);
  const [assignRoleId, setAssignRoleId] = useState<string>('field_inspector');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [resetPwdUser, setResetPwdUser] = useState<User | null>(null);
  const [resetMode, setResetMode] = useState<'password' | 'pin' | 'biometric'>('password');
  const [newPassword, setNewPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinAction, setPinAction] = useState<'set' | 'clear'>('set');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGetRoles()
      .then((r) => setRolesList(r.roles))
      .catch(() => { });
  }, []);

  const refreshProjectMembers = async () => {
    if (!selectedProjectId) {
      setProjectMembers([]);
      return;
    }
    try {
      const res = await apiGetProjectMembers(selectedProjectId);
      setProjectMembers(res.members);
    } catch {
      setProjectMembers([]);
    }
  };

  useEffect(() => {
    void refreshProjectMembers();
  }, [selectedProjectId]);

  const handleAssignToProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignModalUser || !selectedProjectId) return;
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      await apiAddProjectMember(selectedProjectId, {
        userId: assignModalUser.id,
        roleId: assignRoleId,
      });
      setStatusMsg(
        isId
          ? `${assignModalUser.name} berhasil ditugaskan ke proyek.`
          : `${assignModalUser.name} successfully assigned to project.`
      );
      setAssignModalUser(null);
      await refreshProjectMembers();
      onRefreshData?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to assign project member');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveFromProject = async (targetUser: User) => {
    if (!selectedProjectId) return;
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      await apiRemoveProjectMember(selectedProjectId, targetUser.id);
      setStatusMsg(
        isId
          ? `Penugasan ${targetUser.name} pada proyek telah dicabut.`
          : `Assignment for ${targetUser.name} removed from project.`
      );
      await refreshProjectMembers();
      onRefreshData?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to remove project member');
    } finally {
      setBusy(false);
    }
  };

  const [newUser, setNewUser] = useState({
    username: '',
    name: '',
    email: '',
    password: '',
    avatar: '',
    role: 'Field / QC Inspector' as UserRole,
    title: '',
    userCategory: 'internal' as 'internal' | 'external',
    employeeCode: '',
    phone: '',
    organizationName: '',
  });

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    const trimmedUsername = newUser.username.trim();
    const trimmedEmail = newUser.email.trim();
    const trimmedCode = newUser.employeeCode.trim();
    const trimmedPhone = newUser.phone.trim();

    if (!USERNAME_REGEX.test(trimmedUsername)) {
      setModalError(
        isId
          ? 'Username harus 3-40 karakter (huruf, angka, titik, garis bawah, atau tanda hubung).'
          : 'Username must be 3-40 characters (letters, numbers, ., _, -).'
      );
      return;
    }
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setModalError(isId ? 'Format email tidak valid.' : 'Invalid email address format.');
      return;
    }
    if (newUser.password.length < 8) {
      setModalError(isId ? 'Password minimal 8 karakter.' : 'Password must be at least 8 characters.');
      return;
    }
    if (trimmedCode && !EMPLOYEE_CODE_REGEX.test(trimmedCode)) {
      setModalError(
        isId
          ? 'Format NIK / Kode Vendor tidak valid (2-40 karakter: huruf, angka, . _ / -).'
          : 'Invalid Employee/Vendor Code (2-40 chars: letters, numbers, . _ / -).'
      );
      return;
    }
    if (trimmedPhone && !PHONE_REGEX.test(trimmedPhone)) {
      setModalError(
        isId
          ? 'Format No. HP tidak valid (8-18 digit, boleh awalan + atau spasi/-).'
          : 'Invalid phone format (8-18 digits, optional +, spaces, or -).'
      );
      return;
    }

    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...newUser,
          username: trimmedUsername,
          email: trimmedEmail,
          employeeCode: trimmedCode,
          phone: trimmedPhone,
        }),
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
        avatar: '',
        role: 'Field / QC Inspector',
        title: '',
        userCategory: activeCategoryTab,
        employeeCode: '',
        phone: '',
        organizationName: '',
      });
      onRefreshData?.();
    } catch (err: any) {
      setModalError(err?.message || 'Error creating user');
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
    setModalError(null);

    let payload: Record<string, unknown> = {};
    let successMessage = '';

    if (resetMode === 'password') {
      if (newPassword.trim().length < 8) {
        setModalError(isId ? 'Password minimal 8 karakter.' : 'Password must be at least 8 characters.');
        return;
      }
      payload = { password: newPassword.trim() };
      successMessage = isId
        ? `Password untuk ${resetPwdUser.name} berhasil diubah.`
        : `Password reset for ${resetPwdUser.name}.`;
    } else if (resetMode === 'pin') {
      if (pinAction === 'clear') {
        payload = { resetPin: true };
        successMessage = isId
          ? `PIN login untuk ${resetPwdUser.name} telah dihapus/direset.`
          : `Login PIN cleared for ${resetPwdUser.name}.`;
      } else {
        if (!/^\d{4,6}$/.test(newPin.trim())) {
          setModalError(isId ? 'PIN harus berupa 4 hingga 6 digit angka.' : 'PIN must be 4 to 6 numeric digits.');
          return;
        }
        payload = { pin: newPin.trim() };
        successMessage = isId
          ? `PIN baru untuk ${resetPwdUser.name} berhasil disimpan.`
          : `New PIN saved for ${resetPwdUser.name}.`;
      }
    } else {
      payload = { resetBiometrics: true };
      successMessage = isId
        ? `Sidik jari / passkey terdaftar milik ${resetPwdUser.name} berhasil direset.`
        : `Registered fingerprint / passkeys reset for ${resetPwdUser.name}.`;
    }

    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/users/${resetPwdUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset credentials');
      setStatusMsg(successMessage);
      setResetPwdUser(null);
      setNewPassword('');
      setNewPin('');
      onRefreshData?.();
    } catch (err: any) {
      setModalError(err?.message || 'Error resetting credentials');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto pr-1 space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            {t.team.title}
          </h1>
          <p className="text-xs text-slate-500 mt-1">{t.team.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportTeamCsv}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            <span>Export CSV</span>
          </button>
          {isTenantAdmin && (
            <>
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs flex items-center"
              >
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                <span>Import CSV</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewUser((prev) => ({
                    ...prev,
                    userCategory: activeCategoryTab,
                    role: activeCategoryTab === 'external' ? 'Action Owner / Subcontractor' : 'Field / QC Inspector',
                  }));
                  setCreateModalOpen(true);
                }}
                className="px-3.5 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs flex items-center shadow-xs"
              >
                <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                <span>{isId ? 'Tambah Anggota' : 'Add Member'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Category Tabs: Principal Internal vs External */}
      <div className="flex items-center space-x-2 border-b border-slate-200 pb-2 text-xs">
        <button
          type="button"
          onClick={() => setActiveCategoryTab('internal')}
          className={`px-3.5 py-2 rounded-lg font-semibold transition-colors flex items-center space-x-2 ${activeCategoryTab === 'internal'
            ? 'bg-slate-900 text-[#d4f038]'
            : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
        >
          <span>{isId ? 'Tim Principal (Internal)' : 'Principal Team (Internal)'}</span>
          <span className="px-1.5 py-0.2 rounded-full bg-white/15 text-[11px] font-mono">{internalCount}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveCategoryTab('external')}
          className={`px-3.5 py-2 rounded-lg font-semibold transition-colors flex items-center space-x-2 ${activeCategoryTab === 'external'
            ? 'bg-slate-900 text-[#d4f038]'
            : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
        >
          <span>{isId ? 'Pihak Eksternal (Vendor & Klien)' : 'External Users (Vendor & Client)'}</span>
          <span className="px-1.5 py-0.2 rounded-full bg-white/15 text-[11px] font-mono">{externalCount}</span>
        </button>
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

      {/* Top Filter & Search Bar (Option B: Filter Select + Search on Top) */}
      <div className="bg-white rounded-xl border border-slate-200 p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isId ? 'Cari nama, email, jabatan, atau peran...' : 'Search name, email, title, or role...'}
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-800"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {projects && projects.length > 0 && (
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              aria-label={isId ? 'Filter Proyek' : 'Project Filter'}
              className="px-2.5 py-2 border border-slate-300 rounded-lg bg-white font-medium text-slate-800"
            >
              <option value="">{isId ? 'Semua Proyek' : 'All Projects'}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          )}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            aria-label={isId ? 'Filter Status' : 'Status Filter'}
            className="px-2.5 py-2 border border-slate-300 rounded-lg bg-white font-medium text-slate-800"
          >
            <option value="all">{isId ? 'Status: Semua' : 'Status: All'}</option>
            <option value="active">{isId ? 'Status: Aktif' : 'Status: Active'}</option>
            <option value="inactive">{isId ? 'Status: Nonaktif' : 'Status: Inactive'}</option>
          </select>
        </div>
      </div>

      {/* Team Members DataTable */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Toolbar */}
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-800">
            {isId ? `Daftar Anggota (${filteredUsers.length})` : `Team Directory (${filteredUsers.length})`}
          </span>

          <div className="flex items-center gap-2">
            {groupByRole && filteredUsers.length > 0 && (() => {
              const visibleRoles = Array.from(new Set(filteredUsers.map((u) => u.role)));
              const allCollapsed = visibleRoles.length > 0 && visibleRoles.every((r) => collapsedRoles.has(r));
              return (
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedRoles(allCollapsed ? new Set() : new Set(visibleRoles))
                  }
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-medium inline-flex items-center space-x-1 transition-colors"
                >
                  {allCollapsed ? (
                    <>
                      <ChevronsUpDown className="w-3 h-3" />
                      <span>{isId ? 'Buka Semua' : 'Expand All'}</span>
                    </>
                  ) : (
                    <>
                      <ChevronsDownUp className="w-3 h-3" />
                      <span>{isId ? 'Tutup Semua' : 'Collapse All'}</span>
                    </>
                  )}
                </button>
              );
            })()}
            <button
              type="button"
              onClick={() => setGroupByRole((v) => !v)}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium inline-flex items-center space-x-1 transition-colors ${groupByRole
                ? 'bg-slate-900 text-[#d4f038] border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
            >
              <Layers className="w-3 h-3" />
              <span>{isId ? 'Kelompokkan per Role' : 'Group by Role'}</span>
            </button>
          </div>
        </div>

        {/* DataTable */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
              <tr>
                <th className="py-3 px-4">{isId ? 'Anggota' : 'Member'}</th>
                <th className="py-3 px-3">{isId ? 'Peran & Fokus' : 'Role & Focus'}</th>
                {selectedProjectId && (
                  <th className="py-3 px-3">{isId ? 'Penugasan Proyek' : 'Project Role'}</th>
                )}
                <th className="py-3 px-3">{isId ? 'Status Akun' : 'Status'}</th>
                <th className="py-3 px-4 text-right">{isId ? 'Aksi' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={selectedProjectId ? 5 : 4} className="py-10 text-center text-slate-400">
                    {isId ? 'Tidak ada anggota tim yang cocok.' : 'No matching team members.'}
                  </td>
                </tr>
              ) : (() => {
                const renderUserRow = (user: User) => {
                  const isActive = user.id === activeUser.id;
                  const projMember = selectedProjectId
                    ? projectMembers.find((m) => m.userId === user.id)
                    : undefined;

                  return (
                    <tr
                      key={user.id}
                      className={`hover:bg-slate-50/80 transition-colors ${isActive ? 'bg-amber-50/40' : ''}`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center space-x-3">
                          {user.avatar ? (
                            <img
                              src={user.avatar}
                              alt={user.name}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-full border border-slate-200 object-cover shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full border border-slate-200 bg-slate-900 text-[#d4f038] font-semibold flex items-center justify-center text-xs shrink-0">
                              {user.name.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center space-x-1.5">
                              <span className="font-semibold text-slate-900 truncate">{user.name}</span>
                              {isActive && (
                                <span className="px-1.5 py-0.5 rounded bg-slate-900 text-[#d4f038] text-[10px] font-medium shrink-0">
                                  {t.team.activeBadge}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {user.employeeCode && <span className="font-mono text-slate-700 mr-1.5">{user.employeeCode}</span>}
                              {user.email}
                              {user.phone && <span className="ml-1.5 font-mono">• {user.phone}</span>}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 max-w-xs">
                        <div className="font-medium text-slate-800">
                          {user.title ? `${user.title} (${translateRole(user.role)})` : translateRole(user.role)}
                        </div>
                        {user.organizationName && (
                          <div className="text-[11px] text-slate-500 truncate">
                            {user.organizationName}
                          </div>
                        )}
                      </td>

                      {selectedProjectId && (
                        <td className="py-3 px-3">
                          <div className="flex items-center space-x-2">
                            {projMember ? (
                              <span className="font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                {projMember.roleName}
                              </span>
                            ) : (
                              <span className="text-slate-400">
                                {isId ? 'Luar Proyek' : 'Not in Project'}
                              </span>
                            )}
                            {isTenantAdmin && (
                              projMember ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRemoveFromProject(user)}
                                  className="text-rose-600 hover:underline text-[11px] font-medium"
                                >
                                  {isId ? 'Cabut' : 'Remove'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAssignModalUser(user);
                                    setAssignRoleId(rolesList[0]?.id || 'field_inspector');
                                  }}
                                  className="text-amber-700 hover:underline text-[11px] font-medium"
                                >
                                  + {isId ? 'Tugaskan' : 'Assign'}
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      )}

                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${user.isActive === false
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${user.isActive === false ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                            <span>{user.isActive === false ? (isId ? 'Nonaktif' : 'Inactive') : (isId ? 'Aktif' : 'Active')}</span>
                          </span>
                          {isTenantAdmin && (
                            <button
                              type="button"
                              onClick={() => handleToggleActive(user)}
                              className="text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:underline"
                            >
                              {user.isActive === false ? (isId ? 'Aktifkan' : 'Activate') : (isId ? 'Nonaktifkan' : 'Deactivate')}
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewUser(user)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-medium text-slate-700 inline-flex items-center transition-colors"
                            title={isId ? 'Preview Personil' : 'Preview Member'}
                          >
                            <Eye className="w-3 h-3 mr-1 text-slate-500" />
                            <span>{isId ? 'Preview' : 'View'}</span>
                          </button>
                          {isTenantAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditProfile(user)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-medium text-slate-700 inline-flex items-center transition-colors"
                              >
                                <Edit2 className="w-3 h-3 mr-1 text-slate-500" />
                                <span>{isId ? 'Edit' : 'Edit'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setResetPwdUser(user)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-medium text-slate-700 inline-flex items-center transition-colors"
                              >
                                <KeyRound className="w-3 h-3 mr-1 text-slate-400" />
                                <span>{isId ? 'Reset Akses' : 'Reset'}</span>
                              </button>
                            </>
                          )}
                          {(isFocusMode || activeUser.role === 'Project Director & Tenant Admin') && (
                            <button
                              type="button"
                              onClick={() => onSwitchUser(user.id)}
                              disabled={isActive}
                              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium inline-flex items-center transition-colors ${isActive
                                ? 'bg-slate-100 text-slate-400 cursor-default'
                                : 'border border-slate-200 text-slate-700 hover:bg-slate-100'
                                }`}
                            >
                              <UserCheck className="w-3 h-3 mr-1 text-slate-400" />
                              <span>{isActive ? (isId ? 'Aktif' : 'Current') : (isId ? 'Simulasi' : 'Switch')}</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                };

                if (!groupByRole) {
                  return filteredUsers.map(renderUserRow);
                }

                const grouped = new Map<string, User[]>();
                for (const u of filteredUsers) {
                  const list = grouped.get(u.role) || [];
                  list.push(u);
                  grouped.set(u.role, list);
                }

                return Array.from(grouped.entries()).map(([roleKey, groupUsers]) => {
                  const isCollapsed = collapsedRoles.has(roleKey);
                  return (
                    <React.Fragment key={roleKey}>
                      <tr
                        onClick={() => toggleRoleGroup(roleKey)}
                        className="bg-slate-50/90 hover:bg-slate-100/80 cursor-pointer border-y border-slate-200 transition-colors"
                      >
                        <td colSpan={selectedProjectId ? 5 : 4} className="py-2.5 px-4">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center space-x-2 min-w-0">
                              {isCollapsed ? (
                                <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                              )}
                              <span className="font-semibold text-slate-900">
                                {translateRole(roleKey as UserRole)}
                              </span>
                            </div>
                            <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono text-[11px] font-medium shrink-0">
                              {groupUsers.length}
                            </span>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed && groupUsers.map(renderUserRow)}
                    </React.Fragment>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE USER MODAL */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900 my-8">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h2 className="text-sm font-bold flex items-center">
                <UserPlus className="w-4 h-4 mr-2 text-amber-500" />
                {isId ? 'Tambah Pengguna Baru' : 'Create User'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setCreateModalOpen(false);
                }}
                className="p-1 rounded text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-4 text-xs">
              {modalError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-medium">
                  {modalError}
                </div>
              )}

              {/* Photo Upload Row */}
              <div className="flex items-center gap-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                {newUser.avatar ? (
                  <img
                    src={newUser.avatar}
                    alt={newUser.name || 'Avatar'}
                    className="w-16 h-16 rounded-full object-cover border border-slate-300 shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-slate-900 text-[#d4f038] font-bold flex items-center justify-center text-base shrink-0">
                    {(newUser.name || newUser.username || 'U').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 mb-1">
                    {isId ? 'Foto Profil Personil (Opsional)' : 'Profile Photo (Optional)'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 font-semibold text-slate-700 cursor-pointer">
                      <Camera className="w-3.5 h-3.5" />
                      <span>{isId ? 'Unggah Foto' : 'Upload Photo'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          handleAvatarUpload(e.target.files?.[0], (url) =>
                            setNewUser((prev) => ({ ...prev, avatar: url }))
                          );
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {newUser.avatar && (
                      <button
                        type="button"
                        onClick={() => setNewUser((prev) => ({ ...prev, avatar: '' }))}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-semibold"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{isId ? 'Hapus' : 'Remove'}</span>
                      </button>
                    )}
                    <span className="text-[11px] text-slate-500">PNG, JPG, WEBP max 1.5 MB</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Username *</label>
                  <input
                    type="text"
                    required
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    placeholder="john.doe"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nama Lengkap *</label>
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
                  <label className="block font-semibold text-slate-700 mb-1">Email *</label>
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
                  <label className="block font-semibold text-slate-700 mb-1">Password * (min. 8)</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isId ? 'Peran Resmi Konstruksi (System Role)' : 'Official Role'}
                  </label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs font-semibold"
                  >
                    {[
                      'Field / QC Inspector',
                      'Action Owner / Subcontractor',
                      'Project / Site Engineer',
                      'QA/QC Lead / Owner Inspector',
                      'Project Director & Tenant Admin',
                      'Client / Vendor Viewer',
                    ].map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isId ? 'Kategori' : 'Category'}
                  </label>
                  <select
                    value={newUser.userCategory}
                    onChange={(e) => setNewUser({ ...newUser, userCategory: e.target.value as 'internal' | 'external' })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-xs font-semibold"
                  >
                    <option value="internal">{isId ? 'Tim Principal (Internal)' : 'Principal (Internal)'}</option>
                    <option value="external">{isId ? 'Pihak Eksternal' : 'External'}</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {newUser.userCategory === 'external' ? (isId ? 'Kode Vendor' : 'Vendor Code') : 'NIK / ID Karyawan'}
                  </label>
                  <input
                    type="text"
                    value={newUser.employeeCode}
                    onChange={(e) => setNewUser({ ...newUser, employeeCode: e.target.value })}
                    placeholder={newUser.userCategory === 'external' ? 'VND-001' : 'EMP-001'}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {newUser.userCategory === 'external' ? (isId ? 'Perusahaan / Instansi' : 'Company') : (isId ? 'Divisi' : 'Department')}
                  </label>
                  <input
                    type="text"
                    value={newUser.organizationName}
                    onChange={(e) => setNewUser({ ...newUser, organizationName: e.target.value })}
                    placeholder={newUser.userCategory === 'external' ? 'PT Mitra Konstruksi' : 'Divisi QA/QC'}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isId ? 'No. HP / WhatsApp' : 'Phone'}
                  </label>
                  <input
                    type="text"
                    value={newUser.phone}
                    onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                    placeholder="0812xxxxxxxx"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isId ? 'Jabatan / Spesialisasi Proyek' : 'Job Title / Specialization'}
                  </label>
                  <input
                    type="text"
                    value={newUser.title}
                    onChange={(e) => setNewUser({ ...newUser, title: e.target.value })}
                    placeholder="Senior Site Quality Control Engineer"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setModalError(null);
                    setCreateModalOpen(false);
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                >
                  {isId ? 'Batal' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                >
                  {busy ? '...' : isId ? 'Simpan Pengguna' : 'Save User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET CREDENTIALS MODAL */}
      {resetPwdUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="text-sm font-bold flex items-center">
                  <KeyRound className="w-4 h-4 mr-2 text-amber-500" />
                  {isId ? 'Reset Kredensial Login' : 'Reset Login Credentials'}
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {resetPwdUser.name} ({resetPwdUser.email})
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setResetPwdUser(null);
                }}
                className="p-1 rounded text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 pt-4 flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setResetMode('password');
                }}
                className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-semibold border transition-colors ${resetMode === 'password'
                  ? 'bg-slate-900 text-[#d4f038] border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
              >
                Password
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setResetMode('pin');
                }}
                className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-semibold border transition-colors ${resetMode === 'pin'
                  ? 'bg-slate-900 text-[#d4f038] border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
              >
                PIN (4-6 Digit)
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setResetMode('biometric');
                }}
                className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-semibold border transition-colors inline-flex items-center justify-center gap-1 ${resetMode === 'biometric'
                  ? 'bg-slate-900 text-[#d4f038] border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
              >
                <Fingerprint className="w-3.5 h-3.5" />
                <span>{isId ? 'Sidik Jari' : 'Biometric'}</span>
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="p-5 space-y-3.5 text-xs">
              {modalError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-medium">
                  {modalError}
                </div>
              )}

              {resetMode === 'password' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isId ? 'Password Baru (min. 8 karakter)' : 'New Password (min. 8 chars)'}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              )}

              {resetMode === 'pin' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPinAction('set')}
                      className={`flex-1 py-1.5 px-2.5 rounded-lg border font-semibold ${pinAction === 'set'
                        ? 'bg-amber-50 border-amber-400 text-amber-900'
                        : 'border-slate-200 text-slate-600'
                        }`}
                    >
                      {isId ? 'Set PIN Baru' : 'Set New PIN'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPinAction('clear')}
                      className={`flex-1 py-1.5 px-2.5 rounded-lg border font-semibold ${pinAction === 'clear'
                        ? 'bg-rose-50 border-rose-300 text-rose-800'
                        : 'border-slate-200 text-slate-600'
                        }`}
                    >
                      {isId ? 'Hapus / Reset PIN' : 'Clear PIN'}
                    </button>
                  </div>

                  {pinAction === 'set' ? (
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {isId ? 'PIN Baru (4-6 digit angka)' : 'New PIN (4-6 numeric digits)'}
                      </label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        required
                        value={newPin}
                        onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono tracking-widest focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-rose-50/70 border border-rose-200 text-rose-800 leading-relaxed">
                      {isId
                        ? 'PIN login user ini akan dihapus. User harus mengatur PIN baru dari Pengaturan Keamanan akun.'
                        : 'This user’s login PIN will be removed. They will need to set a new PIN from Security Settings.'}
                    </div>
                  )}
                </div>
              )}

              {resetMode === 'biometric' && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1.5 leading-relaxed">
                  <div className="font-bold flex items-center gap-1.5">
                    <Fingerprint className="w-4 h-4 text-amber-700" />
                    <span>{isId ? 'Cabut Semua Sidik Jari / Passkey Perangkat' : 'Revoke All Registered Fingerprints / Passkeys'}</span>
                  </div>
                  <p>
                    {isId
                      ? 'Seluruh kredensial WebAuthn (sidik jari / biometrik perangkat) yang tertaut ke akun ini akan dihapus. User dapat mendaftarkan ulang sidik jari baru dari perangkatnya.'
                      : 'All WebAuthn device credentials linked to this account will be deleted so the user can re-register a new fingerprint/passkey.'}
                  </p>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalError(null);
                    setResetPwdUser(null);
                  }}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                >
                  {isId ? 'Batal' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className={`px-4 py-2 rounded-lg font-bold ${resetMode === 'biometric' || (resetMode === 'pin' && pinAction === 'clear')
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                    }`}
                >
                  {busy
                    ? '...'
                    : resetMode === 'biometric'
                      ? isId ? 'Reset Sidik Jari' : 'Reset Biometric'
                      : resetMode === 'pin' && pinAction === 'clear'
                        ? isId ? 'Hapus PIN' : 'Clear PIN'
                        : isId ? 'Simpan' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ASSIGN TO PROJECT MODAL */}
      {assignModalUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold flex items-center">
                <Shield className="w-4 h-4 mr-2 text-amber-500" />
                {isId ? 'Tugaskan ke Proyek' : 'Assign to Project'}
              </h2>
              <button
                type="button"
                onClick={() => setAssignModalUser(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAssignToProject} className="p-5 space-y-4 text-xs">
              <div>
                <span className="block text-slate-500 mb-1">{isId ? 'Nama Personil:' : 'Member Name:'}</span>
                <span className="font-bold text-slate-900 text-sm">{assignModalUser.name}</span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {isId ? 'Pilih Peran Proyek' : 'Select Project Role'} *
                </label>
                <select
                  value={assignRoleId}
                  onChange={(e) => setAssignRoleId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white"
                >
                  {rolesList.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.isSystem ? '(System)' : '(Custom)'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setAssignModalUser(null)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-semibold"
                >
                  {isId ? 'Batal' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                >
                  {busy ? '...' : isId ? 'Tugaskan' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PREVIEW PERSONIL MODAL */}
      {previewUser && (() => {
        const previewProjRole = selectedProjectId
          ? projectMembers.find((m) => m.userId === previewUser.id)
          : undefined;
        const assignedProjectNames = (projects || [])
          .filter((p) => (previewUser.assignedProjects || []).includes(p.id))
          .map((p) => p.name);
        const projectAssignmentLabel = selectedProjectId
          ? previewProjRole
            ? previewProjRole.roleName
            : (previewUser.assignedProjects || []).includes(selectedProjectId)
              ? translateRole(previewUser.role)
              : isId
                ? 'Luar Proyek'
                : 'Not Assigned'
          : assignedProjectNames.length > 0
            ? assignedProjectNames.join(', ')
            : (previewUser.assignedProjects || []).length > 0
              ? `${previewUser.assignedProjects.length} ${isId ? 'Proyek' : 'Projects'}`
              : isId
                ? 'Belum Ditugaskan'
                : 'Not Assigned';

        return (
          <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                <h2 className="text-sm font-bold flex items-center space-x-2">
                  <Eye className="w-4 h-4 text-slate-700" />
                  <span>{isId ? 'Preview Personil' : 'Member Profile'}</span>
                </h2>
                <button
                  type="button"
                  onClick={() => setPreviewUser(null)}
                  className="p-1 rounded text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs">
                <div className="flex items-center space-x-3.5">
                  {previewUser.avatar ? (
                    <img
                      src={previewUser.avatar}
                      alt={previewUser.name}
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 rounded-full border border-slate-200 object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full border border-slate-200 bg-slate-900 text-[#d4f038] font-bold flex items-center justify-center text-base shrink-0">
                      {previewUser.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-slate-900 truncate">{previewUser.name}</h3>
                    <div className="text-xs font-medium text-amber-700">
                      {previewUser.title ? `${previewUser.title} (${translateRole(previewUser.role)})` : translateRole(previewUser.role)}
                    </div>
                    <div className="text-[11px] text-slate-500">{previewUser.email}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Status Akun</span>
                    <span className={`font-semibold ${previewUser.isActive === false ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {previewUser.isActive === false ? (isId ? 'Nonaktif' : 'Inactive') : (isId ? 'Aktif' : 'Active')}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      {selectedProjectId ? (isId ? 'Peran di Proyek' : 'Project Role') : (isId ? 'Penugasan Proyek' : 'Assigned Projects')}
                    </span>
                    <span className="font-semibold text-slate-800">
                      {projectAssignmentLabel}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      {getEffectiveCategory(previewUser) === 'external' ? 'Kode Vendor' : 'NIK / ID Karyawan'}
                    </span>
                    <span className="font-mono font-semibold text-slate-800">{previewUser.employeeCode || '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      {getEffectiveCategory(previewUser) === 'external' ? 'Perusahaan / Instansi' : 'Divisi'}
                    </span>
                    <span className="font-semibold text-slate-800">{previewUser.organizationName || '-'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 block text-[11px]">No. HP / WhatsApp</span>
                    <span className="font-mono font-semibold text-slate-800">{previewUser.phone || '-'}</span>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setPreviewUser(null)}
                    className="px-4 py-1.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
                  >
                    {isId ? 'Tutup' : 'Close'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* EDIT PROFILE MODAL */}
      {editUser && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900 my-8">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="text-sm font-bold flex items-center space-x-2">
                  <Edit2 className="w-4 h-4 text-slate-700" />
                  <span>{isId ? `Edit Profil: ${editUser.name}` : `Edit Profile: ${editUser.name}`}</span>
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">@{editUser.username} · {editUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalError(null);
                  setEditUser(null);
                }}
                className="p-1 rounded text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveProfileEdit} className="p-6 space-y-4 text-xs">
              {modalError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-medium">
                  {modalError}
                </div>
              )}

              {/* Photo Upload Row */}
              <div className="flex items-center gap-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                {editForm.avatar ? (
                  <img
                    src={editForm.avatar}
                    alt={editForm.name}
                    className="w-16 h-16 rounded-full object-cover border border-slate-300 shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-slate-900 text-[#d4f038] font-bold flex items-center justify-center text-base shrink-0">
                    {(editForm.name || editUser.name).slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800 mb-1">
                    {isId ? 'Foto Profil Personil' : 'Profile Photo'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 font-semibold text-slate-700 cursor-pointer">
                      <Camera className="w-3.5 h-3.5" />
                      <span>{isId ? 'Ganti Foto' : 'Change Photo'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          handleAvatarUpload(e.target.files?.[0], (url) =>
                            setEditForm((prev) => ({ ...prev, avatar: url }))
                          );
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {editForm.avatar && (
                      <button
                        type="button"
                        onClick={() => setEditForm((prev) => ({ ...prev, avatar: '' }))}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-semibold"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{isId ? 'Hapus' : 'Remove'}</span>
                      </button>
                    )}
                    <span className="text-[11px] text-slate-500">PNG, JPG, WEBP max 1.5 MB</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{isId ? 'Nama Lengkap' : 'Full Name'} *</label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isId ? 'Peran Resmi Konstruksi' : 'Official Role'}
                  </label>
                  <select
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-semibold"
                  >
                    {[
                      'Field / QC Inspector',
                      'Action Owner / Subcontractor',
                      'Project / Site Engineer',
                      'QA/QC Lead / Owner Inspector',
                      'Project Director & Tenant Admin',
                      'Client / Vendor Viewer',
                    ].map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{isId ? 'Kategori' : 'Category'}</label>
                  <select
                    value={editForm.userCategory}
                    onChange={(e) => setEditForm({ ...editForm, userCategory: e.target.value as 'internal' | 'external' })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-semibold"
                  >
                    <option value="internal">{isId ? 'Tim Principal (Internal)' : 'Principal (Internal)'}</option>
                    <option value="external">{isId ? 'Pihak Eksternal' : 'External'}</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {editForm.userCategory === 'external' ? 'Kode Vendor' : 'NIK / ID Karyawan'}
                  </label>
                  <input
                    type="text"
                    value={editForm.employeeCode}
                    onChange={(e) => setEditForm({ ...editForm, employeeCode: e.target.value })}
                    placeholder={editForm.userCategory === 'external' ? 'VND-001' : 'EMP-001'}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {editForm.userCategory === 'external' ? 'Perusahaan / Instansi' : 'Divisi'}
                  </label>
                  <input
                    type="text"
                    value={editForm.organizationName}
                    onChange={(e) => setEditForm({ ...editForm, organizationName: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">No. HP / WhatsApp</label>
                  <input
                    type="text"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    placeholder="0812xxxxxxxx"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">{isId ? 'Jabatan' : 'Title'}</label>
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="pt-2 flex justify-end space-x-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setModalError(null);
                    setEditUser(null);
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-300 font-semibold"
                >
                  {isId ? 'Batal' : 'Cancel'}
                </button>
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-[#d4f038] text-[#0b0e14] font-bold">
                  {busy ? '...' : isId ? 'Simpan Perubahan' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* IMPORT CSV MODAL */}
      {importModalOpen && (
        <TeamImportModal
          isId={isId}
          existingUsers={users}
          defaultCategory={activeCategoryTab}
          onClose={() => setImportModalOpen(false)}
          onSuccess={(msg) => {
            setImportModalOpen(false);
            setStatusMsg(msg);
            onRefreshData?.();
          }}
        />
      )}
    </div>
  );
};
