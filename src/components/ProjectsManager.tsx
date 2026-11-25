import React, { useState, useEffect, useCallback } from 'react';
import {
  MapPin,
  Plus,
  X,
  FolderTree,
  Edit2,
  Users,
  Compass,
  CheckCircle2,
  Trash2,
  UserPlus,
  Shield,
  Layers,
  ChevronDown,
  ChevronUp,
  Search,
  ArrowLeft,
  Building2,
  Archive,
  Calendar,
  AlertCircle,
  ExternalLink,
  RotateCcw,
} from 'lucide-react';
import { Project, User, ProjectSite, MasterProject } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { ProjectSetupStudio } from './ProjectSetupStudio';
import { SiteLocationMapPicker } from './SiteLocationMapPicker';
import {
  apiGetProjectMembers,
  apiGetMasterProjects,
  apiCreateMasterProject,
  apiUpdateMasterProject,
  apiArchiveMasterProject,
  apiDeleteMasterProject,
  apiGetMasterProjectSites,
  apiCreateMasterProjectSite,
  apiUpdateProject,
  apiDeleteProject,
  apiGetProjectAssignments,
  apiAddProjectAssignment,
  apiUpdateProjectAssignment,
  apiDeleteProjectAssignment,
  apiSearchUsers,
} from '../services/api';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';

interface TeamAssignment {
  userId: string;
  roleId: string;
}

interface ProjectsManagerProps {
  projects: Project[];
  currentUser?: User;
  users?: User[];
  onAddProject: (
    project: Project & { teamMembers?: TeamAssignment[] }
  ) => Promise<void> | void;
  onUpdateProject?: (
    projectId: string,
    data: Partial<Project> & { teamMembers?: TeamAssignment[] }
  ) => Promise<void> | void;
  initialStudioSite?: Project | null;
  onClearInitialStudioSite?: () => void;
}

const AVAILABLE_ROLES = [
  { id: 'pso', label: 'Project Support Officer (PSO)', desc: 'Koordinasi proyek, monitoring progres WBS & pelaporan' },
  { id: 'project_admin', label: 'Admin Project', desc: 'Administrasi proyek, dokumen, jadwal & dukungan operasional site' },
  { id: 'project_manager', label: 'Site Manager', desc: 'Pengendalian penuh progress, WBS & tim di site' },
  { id: 'site_engineer', label: 'Site Engineer (SE)', desc: 'Pengajuan approval, detail WBS & klaim progres' },
  { id: 'qaqc_lead', label: 'QA/QC Lead', desc: 'Verifikasi kualitas & approval independen (Four-Eyes)' },
  { id: 'field_inspector', label: 'Field Inspector', desc: 'Pelaksanaan checklist lapangan & inspeksi' },
  { id: 'subcontractor', label: 'Subcontractor', desc: 'Eksekusi pekerjaan di lapangan & update RFI' },
  { id: 'client_viewer', label: 'Client Viewer', desc: 'Hak pantau read-only untuk pemilik proyek' },
];

export const ProjectsManager: React.FC<ProjectsManagerProps> = ({
  projects,
  currentUser,
  users = [],
  onAddProject,
  onUpdateProject,
  initialStudioSite,
  onClearInitialStudioSite,
}) => {
  const { t } = useLanguage();
  const [selectedProjectForStudio, setSelectedProjectForStudio] = useState<Project | null>(
    initialStudioSite || null
  );

  useEffect(() => {
    if (initialStudioSite) {
      setSelectedProjectForStudio(initialStudioSite);
      onClearInitialStudioSite?.();
    }
  }, [initialStudioSite, onClearInitialStudioSite]);

  const isFocusMode = (currentUser as any)?.focusMode === 'setup-flow';
  const { can, isLoading: isLoadingPerms } = usePermission();

  // Mode: Master Project vs Legacy Sites view
  const [viewMode, setViewMode] = useState<'master' | 'sites'>('master');

  // Master Project State
  const [masterProjects, setMasterProjects] = useState<MasterProject[]>([]);
  const [selectedMasterProject, setSelectedMasterProject] = useState<MasterProject | null>(null);
  const [masterSites, setMasterSites] = useState<Project[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [loadingSites, setLoadingSites] = useState(false);
  const [masterError, setMasterError] = useState<string | null>(null);
  const [masterSuccess, setMasterSuccess] = useState<string | null>(null);

  // Unified Project + Site Form Modal (Create & Edit, Large Modal)
  const [masterModalOpen, setMasterModalOpen] = useState(false);
  const [editingMasterId, setEditingMasterId] = useState<string | null>(null);
  const [masterStatusFilter, setMasterStatusFilter] = useState<'all' | 'active' | 'archived'>('active');
  const [masterFormCode, setMasterFormCode] = useState('');
  const [masterFormName, setMasterFormName] = useState('');
  const [masterFormClient, setMasterFormClient] = useState('');
  const [masterFormDesc, setMasterFormDesc] = useState('');
  const [masterFormStartDate, setMasterFormStartDate] = useState('');
  const [masterFormEndDate, setMasterFormEndDate] = useState('');
  const [masterFormPmoUserId, setMasterFormPmoUserId] = useState('');
  const [teamModalPmoSaving, setTeamModalPmoSaving] = useState(false);
  const [masterFormSites, setMasterFormSites] = useState<
    Array<{
      id?: string;
      code: string;
      name: string;
      location: string;
      status: 'active' | 'on_hold' | 'completed';
    }>
  >([{ code: '', name: '', location: '', status: 'active' }]);

  // Site under Master Form Modal (Quick Add/Edit individual site)
  const [siteModalOpen, setSiteModalOpen] = useState(false);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [siteFormCode, setSiteFormCode] = useState('');
  const [siteFormName, setSiteFormName] = useState('');
  const [siteFormClient, setSiteFormClient] = useState('');
  const [siteFormLocation, setSiteFormLocation] = useState('');
  const [siteFormStatus, setSiteFormStatus] = useState<'active' | 'on_hold' | 'completed'>('active');
  const [siteFormLeadManagerUserId, setSiteFormLeadManagerUserId] = useState<string>('');
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);

  // Unified Team Assignment Modal (Project-wide or Per-Site, accessible from Project list & Site list)
  const [teamModalMaster, setTeamModalMaster] = useState<MasterProject | null>(null);
  const [teamModalSites, setTeamModalSites] = useState<Project[]>([]);
  const [teamScopeMode, setTeamScopeMode] = useState<'project' | 'site'>('project');
  const [teamTargetSiteIds, setTeamTargetSiteIds] = useState<string[]>([]);
  const [teamSiteFilterId, setTeamSiteFilterId] = useState<string>('all');
  const [quickAssignments, setQuickAssignments] = useState<any[]>([]);
  const [loadingQuickTeam, setLoadingQuickTeam] = useState(false);
  const [quickTeamError, setQuickTeamError] = useState<string | null>(null);
  const [quickTeamSuccess, setQuickTeamSuccess] = useState<string | null>(null);
  const [quickUserSearch, setQuickUserSearch] = useState('');
  const [quickSearchResults, setQuickSearchResults] = useState<User[]>([]);
  const [quickSelectedUserId, setQuickSelectedUserId] = useState('');
  const [quickSelectedRoleId, setQuickSelectedRoleId] = useState('site_engineer');
  const [quickEditAssignment, setQuickEditAssignment] = useState<any | null>(null);
  const [quickEditRoleId, setQuickEditRoleId] = useState('');
  const [quickTeamSubmitting, setQuickTeamSubmitting] = useState(false);

  // Quick Site Picker when clicking "Rincian Pekerjaan" on a multi-site Project
  const [wbsSitePickerMaster, setWbsSitePickerMaster] = useState<{
    master: MasterProject;
    sites: Project[];
  } | null>(null);

  const handleOpenProjectWbs = async (mp: MasterProject) => {
    try {
      setMasterError(null);
      const res = await apiGetMasterProjectSites(mp.id);
      const sitesList = res.sites || [];
      if (sitesList.length === 0) {
        setMasterError(
          `Project "${mp.name}" belum memiliki Site Lapangan. Tambahkan minimal 1 Site melalui tombol Edit terlebih dahulu.`
        );
        return;
      }
      if (sitesList.length === 1) {
        setSelectedProjectForStudio(sitesList[0]);
        return;
      }
      setWbsSitePickerMaster({ master: mp, sites: sitesList });
    } catch (err: any) {
      setMasterError(err?.message || 'Gagal membuka Rincian Pekerjaan project.');
    }
  };

  const loadMasterProjects = useCallback(async () => {
    try {
      setLoadingMaster(true);
      setMasterError(null);
      const res = await apiGetMasterProjects();
      setMasterProjects(res.masterProjects || []);
    } catch (err: any) {
      setMasterError(err?.message || 'Gagal memuat Master Project.');
    } finally {
      setLoadingMaster(false);
    }
  }, []);

  const loadMasterSites = useCallback(async (masterId: string) => {
    try {
      setLoadingSites(true);
      setMasterError(null);
      const res = await apiGetMasterProjectSites(masterId);
      setMasterSites(res.sites || []);
    } catch (err: any) {
      setMasterError(err?.message || 'Gagal memuat Site proyek.');
    } finally {
      setLoadingSites(false);
    }
  }, []);

  useEffect(() => {
    loadMasterProjects();
  }, [loadMasterProjects]);

  useEffect(() => {
    if (selectedMasterProject?.id) {
      loadMasterSites(selectedMasterProject.id);
    }
  }, [selectedMasterProject?.id, loadMasterSites]);

  useEffect(() => {
    if (siteModalOpen) {
      apiSearchUsers('')
        .then((res) => setAvailableUsers(res.users || []))
        .catch(() => setAvailableUsers(users));
    }
  }, [siteModalOpen, users]);

  useEffect(() => {
    if (teamModalMaster) {
      let active = true;
      apiSearchUsers(quickUserSearch)
        .then((res) => {
          if (active) setQuickSearchResults(res.users || []);
        })
        .catch(() => {
          if (active) setQuickSearchResults(users);
        });
      return () => {
        active = false;
      };
    }
  }, [teamModalMaster, quickUserSearch, users]);

  const handleOpenCreateMaster = () => {
    setEditingMasterId(null);
    setMasterFormCode('');
    setMasterFormName('');
    setMasterFormClient('');
    setMasterFormDesc('');
    setMasterFormStartDate('');
    setMasterFormEndDate('');
    setMasterFormPmoUserId(currentUser?.id || '');
    setMasterFormSites([{ code: '', name: '', location: '', status: 'active' }]);
    setMasterModalOpen(true);
  };

  const handleOpenEditMaster = async (mp: MasterProject) => {
    setEditingMasterId(mp.id);
    setMasterFormCode(mp.code);
    setMasterFormName(mp.name);
    setMasterFormClient(mp.ownerClient);
    setMasterFormDesc(mp.description || '');
    setMasterFormStartDate(mp.startDate ? String(mp.startDate).slice(0, 10) : '');
    setMasterFormEndDate(mp.endDate ? String(mp.endDate).slice(0, 10) : '');
    setMasterFormPmoUserId(mp.pmoUserId || mp.createdBy || currentUser?.id || '');
    setMasterFormSites([{ code: '', name: '', location: '', status: 'active' }]);
    setMasterModalOpen(true);
    try {
      const res = await apiGetMasterProjectSites(mp.id);
      const existingSites = (res.sites || []).map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        location: s.location || '',
        status: (s.status as 'active' | 'on_hold' | 'completed') || 'active',
      }));
      if (existingSites.length > 0) {
        setMasterFormSites(existingSites);
      }
    } catch {
      // Keep default empty row if fetch fails
    }
  };

  const handleSaveMasterProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterFormCode.trim() || !masterFormName.trim() || !masterFormClient.trim()) {
      alert('Kode, Nama, dan Klien Project wajib diisi.');
      return;
    }
    const validSites = masterFormSites.filter((s) => s.code.trim() || s.name.trim());
    if (validSites.length === 0) {
      alert('Minimal harus ada 1 Site Lapangan di dalam Project ini.');
      return;
    }
    for (const s of validSites) {
      if (!s.code.trim() || !s.name.trim()) {
        alert('Setiap baris Site wajib memiliki Kode Site dan Nama Site.');
        return;
      }
    }
    const upperCodes = validSites.map((s) => s.code.trim().toUpperCase());
    if (new Set(upperCodes).size !== upperCodes.length) {
      alert('Kode Site dalam satu Project tidak boleh duplikat.');
      return;
    }

    try {
      setIsSubmitting(true);
      if (editingMasterId) {
        await apiUpdateMasterProject(editingMasterId, {
          name: masterFormName.trim(),
          ownerClient: masterFormClient.trim(),
          description: masterFormDesc.trim() || null,
          startDate: masterFormStartDate || null,
          endDate: masterFormEndDate || null,
          pmoUserId: masterFormPmoUserId || currentUser?.id || undefined,
        });
        for (const s of validSites) {
          if (s.id) {
            await apiUpdateProject(s.id, {
              code: s.code.trim().toUpperCase(),
              name: s.name.trim(),
              location: s.location.trim() || 'Site Lapangan',
              client: masterFormClient.trim(),
              status: s.status,
            });
          } else {
            await apiCreateMasterProjectSite(editingMasterId, {
              code: s.code.trim().toUpperCase(),
              name: s.name.trim(),
              location: s.location.trim() || 'Site Lapangan',
              client: masterFormClient.trim(),
            });
          }
        }
        setMasterSuccess(`Project "${masterFormName.trim()}" beserta ${validSites.length} site berhasil diperbarui.`);
      } else {
        const created = await apiCreateMasterProject({
          code: masterFormCode.trim().toUpperCase(),
          name: masterFormName.trim(),
          ownerClient: masterFormClient.trim(),
          description: masterFormDesc.trim() || null,
          startDate: masterFormStartDate || null,
          endDate: masterFormEndDate || null,
          pmoUserId: masterFormPmoUserId || currentUser?.id || undefined,
        });
        const newMasterId = created.masterProject.id;
        for (const s of validSites) {
          await apiCreateMasterProjectSite(newMasterId, {
            code: s.code.trim().toUpperCase(),
            name: s.name.trim(),
            location: s.location.trim() || 'Site Lapangan',
            client: masterFormClient.trim(),
          });
        }
        setMasterSuccess(`Project "${masterFormName.trim()}" dengan ${validSites.length} site berhasil dibuat.`);
      }
      setMasterModalOpen(false);
      setEditingMasterId(null);
      await loadMasterProjects();
      if (selectedMasterProject?.id) {
        await loadMasterSites(selectedMasterProject.id);
      }
      setTimeout(() => setMasterSuccess(null), 4000);
    } catch (err: any) {
      alert(err?.message || 'Gagal menyimpan Project & Site.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchiveMaster = async (masterId: string, name: string) => {
    if (!confirm(`Arsipkan Master Project "${name}"? Master project yang diarsipkan akan berstatus non-aktif.`)) return;
    try {
      await apiArchiveMasterProject(masterId);
      setMasterSuccess(`Master Project "${name}" berhasil diarsipkan.`);
      await loadMasterProjects();
      if (selectedMasterProject?.id === masterId) {
        setSelectedMasterProject(null);
      }
      setTimeout(() => setMasterSuccess(null), 3500);
    } catch (err: any) {
      alert(err?.message || 'Gagal mengarsipkan Master Project.');
    }
  };

  const handleRestoreMaster = async (mp: MasterProject) => {
    try {
      await apiUpdateMasterProject(mp.id, { status: 'active' });
      setMasterSuccess(`Master Project "${mp.name}" berhasil dipulihkan menjadi Aktif.`);
      await loadMasterProjects();
      setTimeout(() => setMasterSuccess(null), 3500);
    } catch (err: any) {
      alert(err?.message || 'Gagal memulihkan Master Project.');
    }
  };

  const handleOpenCreateSiteUnderMaster = () => {
    if (!selectedMasterProject) return;
    setEditingSiteId(null);
    setSiteFormCode('');
    setSiteFormName('');
    setSiteFormClient(selectedMasterProject.ownerClient);
    setSiteFormLocation('');
    setSiteFormStatus('active');
    setSiteFormLeadManagerUserId(currentUser?.id || '');
    setSiteModalOpen(true);
  };

  const handleOpenEditSiteUnderMaster = (site: Project) => {
    setEditingSiteId(site.id);
    setSiteFormCode(site.code);
    setSiteFormName(site.name);
    setSiteFormClient(site.client);
    setSiteFormLocation(site.location || '');
    setSiteFormStatus((site.status as 'active' | 'on_hold' | 'completed') || 'active');
    setSiteFormLeadManagerUserId('');
    setSiteModalOpen(true);
  };

  const handleSaveSiteUnderMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMasterProject) return;
    if (!siteFormCode.trim() || !siteFormName.trim()) {
      alert('Kode Site dan Nama Site wajib diisi.');
      return;
    }
    try {
      setIsSubmitting(true);
      if (editingSiteId) {
        const chosenUser = availableUsers.find((u) => u.id === siteFormLeadManagerUserId);
        await apiUpdateProject(editingSiteId, {
          code: siteFormCode.trim().toUpperCase(),
          name: siteFormName.trim(),
          client: siteFormClient.trim() || selectedMasterProject.ownerClient,
          location: siteFormLocation.trim() || 'Site Lapangan',
          status: siteFormStatus,
          ...(chosenUser ? { leadManager: chosenUser.name } : {}),
        });
        setMasterSuccess(`Site ${siteFormCode.toUpperCase()} berhasil diperbarui.`);
      } else {
        await apiCreateMasterProjectSite(selectedMasterProject.id, {
          code: siteFormCode.trim().toUpperCase(),
          name: siteFormName.trim(),
          client: siteFormClient.trim() || selectedMasterProject.ownerClient,
          location: siteFormLocation.trim() || 'Site Lapangan',
          leadManagerUserId: siteFormLeadManagerUserId || undefined,
        });
        const appointedPm = availableUsers.find((u) => u.id === siteFormLeadManagerUserId);
        setMasterSuccess(
          appointedPm && appointedPm.id !== currentUser?.id
            ? `Site ${siteFormCode.toUpperCase()} berhasil dibuat & ${appointedPm.name} ditunjuk sebagai PM.`
            : `Site ${siteFormCode.toUpperCase()} berhasil dibuat dan Anda otomatis ditugaskan sebagai PM.`
        );
      }
      setSiteModalOpen(false);
      setEditingSiteId(null);
      await loadMasterSites(selectedMasterProject.id);
      await loadMasterProjects();
      setTimeout(() => setMasterSuccess(null), 4000);
    } catch (err: any) {
      alert(err?.message || 'Gagal menyimpan Site di bawah Master Project.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleSiteStatus = async (site: Project) => {
    if (!selectedMasterProject) return;
    const nextStatus = site.status === 'active' ? 'on_hold' : 'active';
    const label = nextStatus === 'on_hold' ? 'menonaktifkan (On Hold)' : 'mengaktifkan kembali';
    if (!confirm(`Yakin ingin ${label} site "${site.name}"?`)) return;
    try {
      await apiUpdateProject(site.id, { status: nextStatus });
      setMasterSuccess(`Status site "${site.name}" diperbarui menjadi ${nextStatus === 'active' ? 'Aktif' : 'On Hold'}.`);
      await loadMasterSites(selectedMasterProject.id);
      setTimeout(() => setMasterSuccess(null), 3500);
    } catch (err: any) {
      alert(err?.message || 'Gagal mengubah status site.');
    }
  };

  const handleDeleteMaster = async (mp: MasterProject) => {
    if (
      !confirm(
        `Hapus permanen Project "${mp.name}" (${mp.code})? Tindakan ini tidak dapat dibatalkan.`
      )
    )
      return;
    try {
      setMasterError(null);
      await apiDeleteMasterProject(mp.id);
      setMasterSuccess(`Project "${mp.name}" berhasil dihapus permanen.`);
      if (selectedMasterProject?.id === mp.id) {
        setSelectedMasterProject(null);
      }
      await loadMasterProjects();
      setTimeout(() => setMasterSuccess(null), 3500);
    } catch (err: any) {
      setMasterError(err?.message || 'Gagal menghapus Project.');
    }
  };

  const handleDeleteSite = async (site: Project) => {
    if (!selectedMasterProject) return;
    if (
      !confirm(
        `Hapus permanen Site "${site.name}" (${site.code}) beserta seluruh WBS & penugasan tim di dalamnya?`
      )
    )
      return;
    try {
      setMasterError(null);
      await apiDeleteProject(site.id);
      setMasterSuccess(`Site "${site.name}" berhasil dihapus permanen.`);
      await loadMasterSites(selectedMasterProject.id);
      await loadMasterProjects();
      setTimeout(() => setMasterSuccess(null), 3500);
    } catch (err: any) {
      setMasterError(err?.message || 'Gagal menghapus Site.');
    }
  };

  const loadProjectTeamAssignments = useCallback(async (sitesList: Project[]) => {
    try {
      setLoadingQuickTeam(true);
      setQuickTeamError(null);
      const results = await Promise.all(
        sitesList.map(async (s) => {
          const res = await apiGetProjectAssignments(s.id);
          return (res.assignments || []).map((a: any) => ({
            ...a,
            siteId: s.id,
            siteCode: s.code,
            siteName: s.name,
          }));
        })
      );
      setQuickAssignments(results.flat());
    } catch (err: any) {
      setQuickTeamError(err?.message || 'Gagal memuat penugasan tim.');
    } finally {
      setLoadingQuickTeam(false);
    }
  }, []);

  const handleOpenProjectTeamModal = async (mp: MasterProject, initialSiteId?: string) => {
    setTeamModalMaster(mp);
    setQuickTeamError(null);
    setQuickTeamSuccess(null);
    setQuickUserSearch('');
    setQuickSelectedUserId('');
    setQuickSelectedRoleId('site_engineer');
    setQuickEditAssignment(null);
    setTeamSiteFilterId(initialSiteId || 'all');
    try {
      setLoadingQuickTeam(true);
      const res = await apiGetMasterProjectSites(mp.id);
      const sitesList = res.sites || [];
      setTeamModalSites(sitesList);
      if (initialSiteId) {
        setTeamScopeMode('site');
        setTeamTargetSiteIds([initialSiteId]);
      } else {
        setTeamScopeMode('project');
        setTeamTargetSiteIds(sitesList.map((s) => s.id));
      }
      await loadProjectTeamAssignments(sitesList);
    } catch (err: any) {
      setQuickTeamError(err?.message || 'Gagal memuat daftar site untuk penugasan tim.');
      setLoadingQuickTeam(false);
    }
  };

  const handleOpenQuickTeamModal = (site: Project) => {
    if (selectedMasterProject) {
      void handleOpenProjectTeamModal(selectedMasterProject, site.id);
    }
  };

  const handleQuickAddMember = async () => {
    if (!teamModalMaster || !quickSelectedUserId || !quickSelectedRoleId) return;
    const targetIds =
      teamScopeMode === 'project'
        ? teamModalSites.map((s) => s.id)
        : teamTargetSiteIds;
    if (targetIds.length === 0) {
      setQuickTeamError('Pilih minimal 1 site tujuan penugasan.');
      return;
    }
    try {
      setQuickTeamSubmitting(true);
      setQuickTeamError(null);
      let addedCount = 0;
      let skippedCount = 0;
      for (const sId of targetIds) {
        try {
          await apiAddProjectAssignment(sId, {
            userId: quickSelectedUserId,
            roleId: quickSelectedRoleId,
          });
          addedCount++;
        } catch (err: any) {
          if (String(err?.message || '').toLowerCase().includes('sudah') || String(err?.message || '').includes('409')) {
            skippedCount++;
          } else {
            throw err;
          }
        }
      }
      setQuickTeamSuccess(
        teamScopeMode === 'project'
          ? `Anggota ditugaskan ke ${addedCount} site (Project-wide)${skippedCount > 0 ? `, ${skippedCount} site sudah terdaftar` : ''}.`
          : `Anggota berhasil ditugaskan ke ${addedCount} site terpilih.`
      );
      setQuickSelectedUserId('');
      await loadProjectTeamAssignments(teamModalSites);
    } catch (err: any) {
      setQuickTeamError(err?.message || 'Gagal menambahkan anggota tim.');
    } finally {
      setQuickTeamSubmitting(false);
    }
  };

  const handleQuickUpdateMemberRole = async () => {
    if (!quickEditAssignment || !quickEditRoleId) return;
    try {
      setQuickTeamSubmitting(true);
      setQuickTeamError(null);
      await apiUpdateProjectAssignment(quickEditAssignment.siteId, quickEditAssignment.id, {
        roleId: quickEditRoleId,
      });
      setQuickTeamSuccess('Peran anggota berhasil diperbarui.');
      setQuickEditAssignment(null);
      await loadProjectTeamAssignments(teamModalSites);
    } catch (err: any) {
      setQuickTeamError(err?.message || 'Gagal mengubah peran anggota.');
    } finally {
      setQuickTeamSubmitting(false);
    }
  };

  const handleQuickRemoveMember = async (siteId: string, assignmentId: string, memberName: string) => {
    if (!confirm(`Nonaktifkan penugasan untuk ${memberName} di site ini?`)) return;
    try {
      setQuickTeamError(null);
      await apiDeleteProjectAssignment(siteId, assignmentId);
      setQuickTeamSuccess(`Penugasan ${memberName} berhasil dinonaktifkan.`);
      await loadProjectTeamAssignments(teamModalSites);
    } catch (err: any) {
      setQuickTeamError(err?.message || 'Gagal menonaktifkan penugasan anggota.');
    }
  };

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info_sites' | 'team'>('info_sites');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [client, setClient] = useState('');
  const [status, setStatus] = useState<'active' | 'completed' | 'on_hold'>('active');
  const [leadManager, setLeadManager] = useState('');
  const [sites, setSites] = useState<ProjectSite[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamAssignment[]>([]);

  // Member assignment row form state
  const [selectedAddUserId, setSelectedAddUserId] = useState<string>('');
  const [selectedAddRoleId, setSelectedAddRoleId] = useState<string>('site_engineer');

  // Expanded site details state in project cards
  const [expandedSitesProjectId, setExpandedSitesProjectId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');

  const filteredProjects = projects.filter((p) => {
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q) ||
      p.client.toLowerCase().includes(q) ||
      (p.location && p.location.toLowerCase().includes(q));
    return matchesStatus && matchesSearch;
  });

  if (selectedProjectForStudio && currentUser) {
    return (
      <ProjectSetupStudio
        project={selectedProjectForStudio}
        currentUser={currentUser}
        onBack={() => setSelectedProjectForStudio(null)}
      />
    );
  }

  const handleOpenCreateModal = () => {
    setEditingProjectId(null);
    setName('');
    setCode('');
    setClient('');
    setStatus('active');
    setLeadManager(currentUser?.name || 'Arthur Sterling');
    setActiveTab('info_sites');

    // Default primary site in Balikpapan / East Kalimantan
    setSites([
      {
        id: `site-${Date.now()}`,
        name: 'Sector 4 Wharf & Staging Yard',
        code: 'SIT-01',
        latitude: -1.265386,
        longitude: 116.8312,
        isPrimary: true,
        radiusMeters: 250,
        address: 'Jl. Minyak No. 1, Pelabuhan Semayang, Balikpapan',
      },
    ]);

    // Pre-assign current user as project manager if available
    if (currentUser?.id) {
      setTeamMembers([{ userId: currentUser.id, roleId: 'project_manager' }]);
    } else {
      setTeamMembers([]);
    }

    setModalOpen(true);
  };

  const handleOpenEditModal = async (prj: Project) => {
    setEditingProjectId(prj.id);
    setName(prj.name);
    setCode(prj.code);
    setClient(prj.client);
    setStatus(prj.status || 'active');
    setLeadManager(prj.leadManager || currentUser?.name || '');
    setActiveTab('info_sites');

    // Load existing sites or initialize from location string
    if (prj.sites && prj.sites.length > 0) {
      setSites(prj.sites);
    } else {
      setSites([
        {
          id: `site-${Date.now()}`,
          name: prj.location || 'Site Utama Proyek',
          code: 'SIT-01',
          latitude: -1.265386,
          longitude: 116.8312,
          isPrimary: true,
          radiusMeters: 300,
          address: prj.location || 'Balikpapan, Kalimantan Timur',
        },
      ]);
    }

    // Fetch existing team assignments
    try {
      const res = await apiGetProjectMembers(prj.id);
      if (res && Array.isArray(res.members)) {
        setTeamMembers(
          res.members.map((m) => ({
            userId: m.userId,
            roleId: m.roleId,
          }))
        );
      } else {
        setTeamMembers([]);
      }
    } catch {
      setTeamMembers([]);
    }

    setModalOpen(true);
  };

  const handleAddTeamMember = () => {
    if (!selectedAddUserId) return;
    // Don't add duplicate user
    if (teamMembers.some((m) => m.userId === selectedAddUserId)) {
      setTeamMembers((prev) =>
        prev.map((m) =>
          m.userId === selectedAddUserId ? { ...m, roleId: selectedAddRoleId } : m
        )
      );
    } else {
      setTeamMembers((prev) => [
        ...prev,
        { userId: selectedAddUserId, roleId: selectedAddRoleId },
      ]);
    }
    setSelectedAddUserId('');
  };

  const handleRemoveTeamMember = (userId: string) => {
    setTeamMembers((prev) => prev.filter((m) => m.userId !== userId));
  };

  const handleUpdateMemberRole = (userId: string, newRoleId: string) => {
    setTeamMembers((prev) =>
      prev.map((m) => (m.userId === userId ? { ...m, roleId: newRoleId } : m))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;

    setIsSubmitting(true);
    try {
      const primarySite = sites.find((s) => s.isPrimary) || sites[0];
      const derivedLocation =
        primarySite?.name || 'Central Industrial Sector';

      if (editingProjectId) {
        // Update existing project
        if (onUpdateProject) {
          await onUpdateProject(editingProjectId, {
            name: name.trim(),
            code: code.trim().toUpperCase(),
            client: client.trim() || 'Enterprise Developer Corp',
            location: derivedLocation,
            status,
            sites,
            leadManager: leadManager || currentUser?.name || 'Arthur Sterling',
            teamMembers,
          });
        }
      } else {
        // Create new project
        const newProject: Project = {
          id: `prj-${Date.now().toString().slice(-4)}`,
          name: name.trim(),
          code: code.trim().toUpperCase(),
          client: client.trim() || 'Enterprise Developer Corp',
          location: derivedLocation,
          status,
          leadManager: leadManager || currentUser?.name || 'Arthur Sterling',
          activeInspectionsCount: 0,
          openIssuesCount: 0,
          complianceRate: 100,
          sites,
          zones: [
            {
              id: `z-${Date.now()}-1`,
              name: 'Main Structure & Grid A-D',
              description: 'Primary structural framing and crane pick zone',
              safetyLevel: 'High Risk',
            },
            {
              id: `z-${Date.now()}-2`,
              name: 'Perimeter Access & Material Depot',
              description: 'Security gate, PPE checkpoint, and staging yard',
              safetyLevel: 'Standard',
            },
          ],
        };

        await onAddProject({
          ...newProject,
          teamMembers,
        });
      }

      setModalOpen(false);
    } catch (err) {
      console.error('Failed to save project:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-2 overflow-hidden">
      {/* Toast Messages */}
      {masterSuccess && (
        <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2 shadow-xs shrink-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{masterSuccess}</span>
        </div>
      )}
      {masterError && (
        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center space-x-2 shadow-xs shrink-0">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{masterError}</span>
        </div>
      )}

      {/* =========================================================================
          TOP UNIFIED TOOLBAR: Master vs Sites Toggle, Search, Filter & Actions
          ========================================================================= */}
      <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-[#d4f038] flex items-center justify-center font-bold font-mono text-xs shrink-0">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-slate-900 leading-tight">
                {selectedMasterProject
                  ? `Site Lapangan: ${selectedMasterProject.name}`
                  : 'Daftar Project (Kontrak)'}
              </h1>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 font-semibold text-slate-600">
                {selectedMasterProject
                  ? `${masterSites.length} Site Lapangan`
                  : `${masterProjects.length} Project`}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden xl:block">
              {selectedMasterProject
                ? `Mengelola unit site di bawah kontrak ${selectedMasterProject.code} (${selectedMasterProject.ownerClient}).`
                : '1 Project mewakili 1 kontrak. Tambahkan 1 atau beberapa Site Lapangan terpisah di dalamnya.'}
            </p>
          </div>
        </div>

        {/* Search, Filter & Actions */}
        <div className="flex items-center space-x-2 flex-wrap">

          {/* Status Filter for Master Projects */}
          {viewMode === 'master' && !selectedMasterProject && (
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[11px]">
              {(['active', 'archived', 'all'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setMasterStatusFilter(st)}
                  className={`px-2 py-0.5 rounded-md font-semibold transition-colors cursor-pointer ${
                    masterStatusFilter === st
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st === 'active' ? 'Aktif' : st === 'archived' ? 'Arsip' : 'Semua'}
                </button>
              ))}
            </div>
          )}

          {/* Search bar */}
          <div className="relative w-44 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari kode, nama, klien..."
              className="w-full pl-8 pr-3 py-1 text-xs border border-slate-200 rounded-md bg-white text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Action button based on current view */}
          {viewMode === 'master' ? (
            selectedMasterProject ? (
              <div className="flex items-center space-x-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedMasterProject(null)}
                  className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors flex items-center shadow-2xs cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1 text-slate-600" />
                  <span>Daftar Master</span>
                </button>
                <button
                  type="button"
                  disabled={isLoadingPerms || !can(PERMISSIONS.PROJECT_CREATE, selectedMasterProject.id)}
                  onClick={handleOpenCreateSiteUnderMaster}
                  className="px-2.5 py-1 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-xs font-bold transition-colors flex items-center shadow-2xs disabled:opacity-50 cursor-pointer"
                  title="Buat Site Lapangan Baru di Bawah Master Project Ini"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  <span>+ Site Lapangan</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isLoadingPerms || !can(PERMISSIONS.MASTERPROJECT_MANAGE)}
                onClick={handleOpenCreateMaster}
                className="px-2.5 py-1 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-xs font-bold transition-colors flex items-center shadow-2xs disabled:opacity-50 cursor-pointer"
                title="Buat Program / Master Project Baru"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                <span>+ Master Project</span>
              </button>
            )
          ) : (
            <button
              onClick={handleOpenCreateModal}
              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-2xs whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              <span>+ Proyek</span>
            </button>
          )}
        </div>
      </div>

      {/* =========================================================================
          MAIN WORKSPACE: Master Projects or Sites Matrix Table
          ========================================================================= */}
      <div className="flex-1 min-h-0 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
        {/* VIEW 1: Master Projects List */}
        {viewMode === 'master' && !selectedMasterProject && (
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3.5">Kode & Nama Master Project</th>
                  <th className="py-2.5 px-3">Pemilik Kontrak (Klien)</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-center">Jumlah Site</th>
                  <th className="py-2.5 px-3">Periode Kontrak</th>
                  <th className="py-2.5 px-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingMaster ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-slate-400">
                      Memuat daftar Master Project...
                    </td>
                  </tr>
                ) : masterProjects.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-slate-400">
                      <Building2 className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                      <p className="font-semibold text-slate-600">Belum ada Master Project.</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Buat Master Project pertama untuk mulai mengorganisasi site lapangan konstruksi.
                      </p>
                    </td>
                  </tr>
                ) : (
                  masterProjects
                    .filter((mp) => {
                      const matchesStatus =
                        masterStatusFilter === 'all' || mp.status === masterStatusFilter;
                      const q = searchQuery.toLowerCase();
                      const matchesQuery =
                        !q ||
                        mp.name.toLowerCase().includes(q) ||
                        mp.code.toLowerCase().includes(q) ||
                        mp.ownerClient.toLowerCase().includes(q);
                      return matchesStatus && matchesQuery;
                    })
                    .map((mp) => (
                      <tr key={mp.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-3.5">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-900 text-[#d4f038] shrink-0">
                              {mp.code}
                            </span>
                            <div className="truncate">
                              <span className="font-bold text-slate-900 block truncate">{mp.name}</span>
                              {mp.description && (
                                <span className="text-[10px] text-slate-400 block truncate">
                                  {mp.description}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 text-slate-700 font-medium truncate max-w-[180px]">
                          {mp.ownerClient}
                        </td>

                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border inline-block ${
                              mp.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {mp.status === 'active' ? 'Aktif' : 'Arsip'}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 text-center">
                          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold font-mono text-[10px] border border-blue-200">
                            {mp.sitesCount || 0} Site
                          </span>
                        </td>

                        <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                          {mp.startDate ? String(mp.startDate).slice(0, 10) : '-'} s/d{' '}
                          {mp.endDate ? String(mp.endDate).slice(0, 10) : '-'}
                        </td>

                        <td className="py-2.5 px-3.5 text-right">
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              type="button"
                              onClick={() => void handleOpenProjectWbs(mp)}
                              className="px-2.5 py-1 rounded-md bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-[11px] shadow-2xs transition-colors flex items-center space-x-1 cursor-pointer"
                              title="Isi atau kelola Rincian Pekerjaan (WBS) untuk Project ini"
                            >
                              <FolderTree className="w-3 h-3 text-[#0b0e14]" />
                              <span>Rincian Pekerjaan</span>
                            </button>
                            {can(PERMISSIONS.MASTERPROJECT_MANAGE) && (
                              <button
                                type="button"
                                onClick={() => void handleOpenProjectTeamModal(mp)}
                                className="px-2 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-[11px] shadow-2xs transition-colors flex items-center space-x-1 cursor-pointer"
                                title="Kelola penugasan tim (Per Project / Per Site)"
                              >
                                <Users className="w-3 h-3 text-blue-600" />
                                <span>Tim</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setSelectedMasterProject(mp)}
                              className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold text-[11px] shadow-2xs transition-colors flex items-center space-x-1 cursor-pointer"
                            >
                              <span>Buka Site</span>
                              <ExternalLink className="w-3 h-3 text-[#d4f038]" />
                            </button>
                            {can(PERMISSIONS.MASTERPROJECT_MANAGE) && (
                              <button
                                type="button"
                                onClick={() => handleOpenEditMaster(mp)}
                                className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                                title="Edit Master Project ini"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {mp.status === 'active' && can(PERMISSIONS.MASTERPROJECT_MANAGE) && (
                              <button
                                type="button"
                                onClick={() => handleArchiveMaster(mp.id, mp.name)}
                                className="p-1.5 rounded-md border border-slate-200 text-slate-400 hover:text-amber-700 hover:bg-amber-50 hover:border-amber-200 transition-colors cursor-pointer"
                                title="Arsipkan Master Project ini"
                              >
                                <Archive className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {mp.status === 'archived' && can(PERMISSIONS.MASTERPROJECT_MANAGE) && (
                              <button
                                type="button"
                                onClick={() => handleRestoreMaster(mp)}
                                className="p-1.5 rounded-md border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer"
                                title="Pulihkan Master Project ini menjadi Aktif"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {can(PERMISSIONS.MASTERPROJECT_MANAGE) && (
                              <button
                                type="button"
                                onClick={() => handleDeleteMaster(mp)}
                                className="p-1.5 rounded-md border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer"
                                title="Hapus permanen Project ini"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* VIEW 2: Sites under Selected Master Project */}
        {viewMode === 'master' && selectedMasterProject && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Master Project Context Banner */}
            <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-900 text-[#d4f038]">
                  {selectedMasterProject.code}
                </span>
                <span className="font-bold text-slate-900 text-xs">{selectedMasterProject.name}</span>
                <span className="text-slate-400 text-xs">&bull;</span>
                <span className="text-xs text-slate-600">Klien: {selectedMasterProject.ownerClient}</span>
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                {masterSites.length} Site Lapangan Terdaftar
              </div>
            </div>

            {/* Sites Table */}
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-left text-xs font-sans">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-3.5">Kode & Nama Site</th>
                    <th className="py-2.5 px-3">Lokasi Proyek</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    <th className="py-2.5 px-3">Lead Manager (PM)</th>
                    <th className="py-2.5 px-3.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingSites ? (
                    <tr>
                      <td colSpan={5} className="py-16 text-center text-slate-400">
                        Memuat site proyek...
                      </td>
                    </tr>
                  ) : masterSites.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-16 text-center text-slate-400">
                        <MapPin className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                        <p className="font-semibold text-slate-600">
                          Belum ada site lapangan di bawah Master Project ini.
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Klik "+ Site Lapangan" untuk menambahkan site pertama.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    masterSites
                      .filter((s) => {
                        const q = searchQuery.toLowerCase();
                        return (
                          !q ||
                          s.name.toLowerCase().includes(q) ||
                          s.code.toLowerCase().includes(q) ||
                          (s.location && s.location.toLowerCase().includes(q))
                        );
                      })
                      .map((site) => (
                        <tr key={site.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-3.5">
                            <div className="flex items-center space-x-2">
                              <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-900 text-white shrink-0">
                                {site.code}
                              </span>
                              <div className="truncate">
                                <span className="font-bold text-slate-900 block truncate">{site.name}</span>
                                <span className="text-[10px] text-slate-400 block truncate">
                                  {site.client}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="py-2.5 px-3 text-slate-600">
                            <div className="flex items-center space-x-1">
                              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="truncate">{site.location || 'Site Lapangan'}</span>
                            </div>
                          </td>

                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border inline-block ${
                                site.status === 'active'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                            >
                              {site.status || 'Aktif'}
                            </span>
                          </td>

                          <td className="py-2.5 px-3 text-slate-700 font-medium">
                            {site.leadManager || 'Belum ditugaskan'}
                          </td>

                          <td className="py-2.5 px-3.5 text-right">
                            <div className="flex items-center justify-end space-x-1.5">
                              {(can(PERMISSIONS.PROJECT_MANAGE_MEMBERS, site.id) || can(PERMISSIONS.MASTERPROJECT_MANAGE)) && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenQuickTeamModal(site)}
                                  className="px-2 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-[11px] shadow-2xs transition-colors inline-flex items-center space-x-1 cursor-pointer"
                                  title="Kelola penugasan tim site ini secara cepat"
                                >
                                  <Users className="w-3 h-3 text-blue-600" />
                                  <span>Tim</span>
                                </button>
                              )}
                              {(can(PERMISSIONS.PROJECT_EDIT, site.id) || can(PERMISSIONS.PROJECT_CREATE)) && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditSiteUnderMaster(site)}
                                    className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                                    title="Edit metadata site ini"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleSiteStatus(site)}
                                    className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
                                      site.status === 'active'
                                        ? 'border-slate-200 text-slate-400 hover:text-amber-700 hover:bg-amber-50 hover:border-amber-200'
                                        : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                                    }`}
                                    title={site.status === 'active' ? 'Nonaktifkan (On Hold) site ini' : 'Aktifkan kembali site ini'}
                                  >
                                    {site.status === 'active' ? (
                                      <Archive className="w-3.5 h-3.5" />
                                    ) : (
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSite(site)}
                                    className="p-1.5 rounded-md border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer"
                                    title="Hapus permanen site ini"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => setSelectedProjectForStudio(site)}
                                className="px-2.5 py-1 rounded-md bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-[11px] shadow-2xs transition-colors inline-flex items-center space-x-1 cursor-pointer"
                              >
                                <span>Setup WBS</span>
                                <ExternalLink className="w-3 h-3 text-[#0b0e14]" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* VIEW 3: Legacy All Sites Matrix Table */}
        {viewMode === 'sites' && (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold sticky top-0 z-10">
              <tr>
                <th className="py-2.5 px-3.5">Kode & Nama Proyek</th>
                <th className="py-2.5 px-3">Klien Pemilik</th>
                <th className="py-2.5 px-3">Titik Site & Lokasi</th>
                <th className="py-2.5 px-2.5 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Kepatuhan</th>
                <th className="py-2.5 px-3 text-center">Inspeksi / Isu</th>
                <th className="py-2.5 px-3.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400 text-xs">
                    {searchQuery ? 'Tidak ada proyek yang sesuai pencarian.' : 'Belum ada proyek yang terdaftar.'}
                  </td>
                </tr>
              ) : (
                filteredProjects.map((prj) => {
                  const prjSites = prj.sites && prj.sites.length > 0 ? prj.sites : [];
                  const primarySite = prjSites.find((s) => s.isPrimary) || prjSites[0];
                  const isSitesExpanded = expandedSitesProjectId === prj.id;

                  return (
                    <React.Fragment key={prj.id}>
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-3.5">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-900 text-[#d4f038] shrink-0">
                              {prj.code}
                            </span>
                            <div className="truncate">
                              <span className="font-bold text-slate-900 block truncate">
                                {prj.name}
                              </span>
                              <span className="text-[10px] text-slate-400 block truncate">
                                PM: {prj.leadManager || 'Arthur Sterling'}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 text-slate-600 truncate max-w-[160px]">
                          {prj.client}
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="flex items-center space-x-1.5">
                            <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                            <span className="truncate max-w-[150px] font-medium text-slate-700">
                              {primarySite ? primarySite.name : prj.location}
                            </span>
                            {prjSites.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedSitesProjectId(isSitesExpanded ? null : prj.id)
                                }
                                className="inline-flex items-center gap-0.5 text-[9px] font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 px-1 py-0.2 rounded cursor-pointer transition-colors shrink-0"
                              >
                                <span>+{prjSites.length - 1}</span>
                                {isSitesExpanded ? (
                                  <ChevronUp className="w-2.5 h-2.5" />
                                ) : (
                                  <ChevronDown className="w-2.5 h-2.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>

                        <td className="py-2.5 px-2.5 text-center">
                          <span
                            className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border inline-block ${
                              prj.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : prj.status === 'completed'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {prj.status}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 tabular-nums">
                          {prj.complianceRate}%
                        </td>

                        <td className="py-2.5 px-3 text-center font-mono text-[11px] tabular-nums">
                          <span className="font-semibold text-slate-800">{prj.activeInspectionsCount}</span>
                          <span className="text-slate-300 mx-1">/</span>
                          <span className={prj.openIssuesCount > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}>
                            {prj.openIssuesCount}
                          </span>
                        </td>

                        <td className="py-2.5 px-3.5 text-right">
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedProjectForStudio(prj)}
                              className="px-2.5 py-1 rounded-md bg-[#0b0e14] hover:bg-[#1b2230] text-[#d4f038] border border-slate-800 text-[11px] font-bold transition-colors flex items-center space-x-1 cursor-pointer shadow-2xs"
                              title="Buka Rincian Pekerjaan, Jadwal & Tahapan Mutu"
                            >
                              <FolderTree className="w-3 h-3 text-[#d4f038]" />
                              <span>Rincian Pekerjaan</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(prj)}
                              className="p-1 rounded-md border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-600 transition-colors"
                              title="Edit parameter & lokasi site"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Sites Detail Row */}
                      {isSitesExpanded && prjSites.length > 1 && (
                        <tr className="bg-blue-50/30">
                          <td colSpan={7} className="py-2 px-6">
                            <div className="flex flex-wrap gap-2 text-[11px]">
                              {prjSites.map((site) => (
                                <span
                                  key={site.id}
                                  className="inline-flex items-center space-x-1 bg-white border border-blue-200 rounded-md px-2 py-0.5 text-slate-700 shadow-2xs"
                                >
                                  <span>{site.isPrimary ? '🌟' : '📍'}</span>
                                  <strong className="font-semibold">{site.name}</strong>
                                  <span className="font-mono text-[9px] text-slate-400">
                                    ({site.latitude.toFixed(3)}, {site.longitude.toFixed(3)})
                                  </span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Unified Project Modal: Information, Multiple Sites (Leaflet), & Merged Employee Assignment */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-800">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {editingProjectId ? 'Edit Data Proyek & Site' : 'Buat Proyek Baru'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Konfigurasi parameter proyek, multi-lokasi geografis Leaflet, dan penugasan personel.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-md transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs Navigation */}
            <div className="flex border-b border-slate-200 px-6 bg-slate-50/50">
              <button
                type="button"
                onClick={() => setActiveTab('info_sites')}
                className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                  activeTab === 'info_sites'
                    ? 'border-amber-500 text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <MapPin className="w-4 h-4 text-blue-600" />
                <span>Informasi Dasar & Titik Site ({sites.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('team')}
                className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
                  activeTab === 'team'
                    ? 'border-amber-500 text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Users className="w-4 h-4 text-emerald-600" />
                <span>Penugasan Tim Proyek ({teamMembers.length})</span>
              </button>
            </div>

            {/* Modal Form Body (Scrollable) */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
              {activeTab === 'info_sites' ? (
                <div className="space-y-5">
                  {/* General Info Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Nama Proyek <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Contoh: Balikpapan Coastal Highway Package 2"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Kode Proyek <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="Contoh: BPN-CW-02"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Klien / Pemilik Proyek
                      </label>
                      <input
                        type="text"
                        value={client}
                        onChange={(e) => setClient(e.target.value)}
                        placeholder="Contoh: Balai Besar Pelaksanaan Jalan Nasional"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Status Proyek
                      </label>
                      <select
                        value={status}
                        onChange={(e) =>
                          setStatus(e.target.value as 'active' | 'completed' | 'on_hold')
                        }
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="active">Active (Sedang Berjalan)</option>
                        <option value="on_hold">On Hold (Ditangguhkan)</option>
                        <option value="completed">Completed (Selesai)</option>
                      </select>
                    </div>
                  </div>

                  {/* Leaflet Multiple Sites Section */}
                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                          <Compass className="w-4 h-4 text-blue-600" />
                          <span>Titik Lokasi Proyek & Multi-Site (Leaflet Map)</span>
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          1 proyek dapat mencakup beberapa titik site/pos (klik pada peta untuk menambah titik, geser pin, atau pilih preset).
                        </p>
                      </div>
                    </div>

                    <SiteLocationMapPicker
                      sites={sites}
                      onChange={(updatedSites) => setSites(updatedSites)}
                    />
                  </div>
                </div>
              ) : (
                /* Tab 2: Employee / Team Assignment */
                <div className="space-y-6">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                    <h4 className="font-bold text-slate-900 flex items-center gap-1.5 text-xs">
                      <UserPlus className="w-4 h-4 text-emerald-600" />
                      <span>Tugaskan Karyawan / Personel ke Proyek Ini</span>
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Pilih personel dari database pengguna dan tetapkan peran fungsional spesifik mereka pada proyek ini.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1">
                      <div className="sm:col-span-6">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Pilih Personel
                        </label>
                        <select
                          value={selectedAddUserId}
                          onChange={(e) => setSelectedAddUserId(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs text-slate-900 bg-white"
                        >
                          <option value="">-- Pilih Anggota Tim --</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.email}) - {u.title || u.role}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Peran Proyek (Role)
                        </label>
                        <select
                          value={selectedAddRoleId}
                          onChange={(e) => setSelectedAddRoleId(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-2 text-xs text-slate-900 bg-white"
                        >
                          {AVAILABLE_ROLES.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2 flex items-end">
                        <button
                          type="button"
                          onClick={handleAddTeamMember}
                          disabled={!selectedAddUserId}
                          className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Tugaskan</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* List of Assigned Members */}
                  <div>
                    <h5 className="font-bold text-slate-800 text-xs mb-2">
                      Daftar Anggota Tim Ditugaskan ({teamMembers.length} Orang)
                    </h5>

                    {teamMembers.length === 0 ? (
                      <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-xl text-slate-400">
                        <Users className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                        <p className="font-semibold text-xs text-slate-600">Belum ada anggota tim yang ditugaskan</p>
                        <p className="text-[11px]">Tambahkan Site Engineer, QA/QC Lead, atau Inspector di atas.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                        {teamMembers.map((member) => {
                          const userObj = users.find((u) => u.id === member.userId);
                          const roleObj = AVAILABLE_ROLES.find((r) => r.id === member.roleId);

                          return (
                            <div
                              key={member.userId}
                              className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
                            >
                              <div className="flex items-center space-x-3 truncate mr-2">
                                <div className="w-8 h-8 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0">
                                  {userObj ? userObj.name.slice(0, 2).toUpperCase() : 'US'}
                                </div>
                                <div className="truncate">
                                  <div className="font-bold text-slate-900 truncate">
                                    {userObj ? userObj.name : member.userId}
                                  </div>
                                  <div className="text-[11px] text-slate-400 truncate">
                                    {userObj ? userObj.email : 'Unknown email'}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center space-x-2 shrink-0">
                                <select
                                  value={member.roleId}
                                  onChange={(e) =>
                                    handleUpdateMemberRole(member.userId, e.target.value)
                                  }
                                  className="border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-800 bg-white font-medium"
                                >
                                  {AVAILABLE_ROLES.map((role) => (
                                    <option key={role.id} value={role.id}>
                                      {role.label}
                                    </option>
                                  ))}
                                </select>

                                <button
                                  type="button"
                                  onClick={() => handleRemoveTeamMember(member.userId)}
                                  className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Hapus penugasan"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Modal Footer */}
              <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  {sites.length} Titik Site &bull; {teamMembers.length} Anggota Tim
                </span>
                <div className="flex items-center space-x-2.5">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    {t.common.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting
                      ? 'Menyimpan...'
                      : editingProjectId
                      ? 'Simpan Perubahan'
                      : 'Simpan Proyek & Tim'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Modal: Unified Project + Site Large Modal (Create & Edit) */}
      {masterModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <Building2 className="w-4 h-4 text-slate-800" />
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    {editingMasterId ? 'Edit Project & Daftar Site' : 'Buat Project & Site Baru'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    1 Project = 1 Kontrak. Input 1 site jika kontrak tunggal, atau tambah beberapa site terpisah.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMasterModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMasterProject} className="p-5 space-y-5 max-h-[82vh] overflow-y-auto">
              {/* Section 1: Project / Contract Info */}
              <div className="space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-1">
                  1. Informasi Project (Kontrak)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Kode Project *</label>
                    <input
                      type="text"
                      required
                      disabled={Boolean(editingMasterId)}
                      value={masterFormCode}
                      onChange={(e) => setMasterFormCode(e.target.value)}
                      placeholder="mis. PRJ-IKN-001"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs uppercase font-mono focus:ring-1 focus:ring-slate-800 focus:outline-hidden disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">Nama Project / Kontrak *</label>
                    <input
                      type="text"
                      required
                      value={masterFormName}
                      onChange={(e) => setMasterFormName(e.target.value)}
                      placeholder="mis. Proyek Pembangunan Gedung & Infrastruktur IKN"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Pemilik Kontrak / Klien *</label>
                    <input
                      type="text"
                      required
                      value={masterFormClient}
                      onChange={(e) => setMasterFormClient(e.target.value)}
                      placeholder="mis. Kementerian PUPR"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Tanggal Mulai</label>
                    <input
                      type="date"
                      value={masterFormStartDate}
                      onChange={(e) => setMasterFormStartDate(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Tanggal Target Selesai</label>
                    <input
                      type="date"
                      value={masterFormEndDate}
                      onChange={(e) => setMasterFormEndDate(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kepala Project / PMO (1 Orang — Default Pembuat)
                  </label>
                  <select
                    value={masterFormPmoUserId || currentUser?.id || ''}
                    onChange={(e) => setMasterFormPmoUserId(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Deskripsi Singkat Kontrak</label>
                  <textarea
                    rows={2}
                    value={masterFormDesc}
                    onChange={(e) => setMasterFormDesc(e.target.value)}
                    placeholder="Keterangan lingkup kontrak dan pengawasan..."
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Section 2: Site List inside this Project */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    2. Daftar Site Lapangan ({masterFormSites.length})
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setMasterFormSites((prev) => [
                        ...prev,
                        { code: '', name: '', location: '', status: 'active' },
                      ])
                    }
                    className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold text-[11px] flex items-center space-x-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3 text-[#d4f038]" />
                    <span>+ Tambah Site</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {masterFormSites.map((s, idx) => (
                    <div
                      key={s.id || `new-site-${idx}`}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-2 items-end"
                    >
                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                          Kode Site #{idx + 1} *
                        </label>
                        <input
                          type="text"
                          required
                          value={s.code}
                          onChange={(e) =>
                            setMasterFormSites((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, code: e.target.value } : item))
                            )
                          }
                          placeholder="mis. SITE-A"
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs uppercase font-mono bg-white"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                          Nama Site Lapangan *
                        </label>
                        <input
                          type="text"
                          required
                          value={s.name}
                          onChange={(e) =>
                            setMasterFormSites((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, name: e.target.value } : item))
                            )
                          }
                          placeholder="mis. Seksi 3A - Jembatan"
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                        />
                      </div>
                      <div className={masterFormSites.length > 1 && !s.id ? 'sm:col-span-4' : 'sm:col-span-5'}>
                        <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                          Lokasi / Alamat Site
                        </label>
                        <input
                          type="text"
                          value={s.location}
                          onChange={(e) =>
                            setMasterFormSites((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, location: e.target.value } : item))
                            )
                          }
                          placeholder="mis. Penajam Paser Utara"
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white"
                        />
                      </div>
                      {masterFormSites.length > 1 && !s.id && (
                        <div className="sm:col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              setMasterFormSites((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1.5 rounded-lg border border-rose-200 text-rose-500 hover:bg-rose-50 cursor-pointer"
                            title="Hapus baris site ini"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  {masterFormSites.length} Site akan disimpan di bawah Project ini
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setMasterModalOpen(false)}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isSubmitting
                      ? 'Menyimpan...'
                      : editingMasterId
                      ? 'Simpan Perubahan Project & Site'
                      : 'Simpan Project & Site'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create or Edit Site under Selected Master Project */}
      {siteModalOpen && selectedMasterProject && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <MapPin className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-sm">
                  {editingSiteId ? 'Edit Metadata Site Lapangan' : 'Buat Site Lapangan Baru'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSiteModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-2.5 bg-blue-50/60 border-b border-blue-100 flex items-center space-x-2 text-[11px] text-blue-800 font-medium">
              <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span className="truncate">Di bawah Master: {selectedMasterProject.name}</span>
            </div>

            <form onSubmit={handleSaveSiteUnderMaster} className="p-5 space-y-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Kode Site *</label>
                <input
                  type="text"
                  required
                  value={siteFormCode}
                  onChange={(e) => setSiteFormCode(e.target.value)}
                  placeholder="mis. SITE-IKN-A"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs uppercase font-mono focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nama Site Lapangan *</label>
                <input
                  type="text"
                  required
                  value={siteFormName}
                  onChange={(e) => setSiteFormName(e.target.value)}
                  placeholder="mis. Seksi 3A - Jembatan Pulau Balang & Pier P14"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Lokasi / Alamat Site</label>
                <input
                  type="text"
                  value={siteFormLocation}
                  onChange={(e) => setSiteFormLocation(e.target.value)}
                  placeholder="mis. Penajam Paser Utara, Kalimantan Timur"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Klien Lapangan</label>
                  <input
                    type="text"
                    value={siteFormClient}
                    onChange={(e) => setSiteFormClient(e.target.value)}
                    placeholder={selectedMasterProject.ownerClient}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                  />
                </div>
                {editingSiteId && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Status Site</label>
                    <select
                      value={siteFormStatus}
                      onChange={(e) => setSiteFormStatus(e.target.value as any)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                    >
                      <option value="active">Aktif</option>
                      <option value="on_hold">On Hold / Nonaktif</option>
                      <option value="completed">Selesai</option>
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tunjuk Project Manager Lapangan (PM)
                </label>
                <select
                  value={siteFormLeadManagerUserId}
                  onChange={(e) => setSiteFormLeadManagerUserId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                >
                  <option value="">
                    {editingSiteId
                      ? '-- Pertahankan Lead PM Saat Ini --'
                      : `-- Otomatis: ${currentUser?.name || 'Pembuat Site'} --`}
                  </option>
                  {availableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
                {!editingSiteId && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    Personel terpilih akan langsung mendapat role Project Manager pada site ini secara transaksional.
                  </p>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setSiteModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting
                    ? 'Menyimpan...'
                    : editingSiteId
                    ? 'Simpan Perubahan'
                    : 'Buat Site'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Unified Team Assignment (Per Project or Per Site) */}
      {teamModalMaster && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2.5">
                <Users className="w-4 h-4 text-blue-600" />
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    Penugasan Tim Project: {teamModalMaster.code}
                  </h3>
                  <p className="text-[11px] text-slate-500 truncate max-w-md">
                    {teamModalMaster.name} ({teamModalSites.length} Site)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTeamModalMaster(null)}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[78vh] overflow-y-auto">
              {quickTeamError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{quickTeamError}</span>
                </div>
              )}
              {quickTeamSuccess && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{quickTeamSuccess}</span>
                </div>
              )}

              {/* Kepala Project / PMO (1 Orang per Project) */}
              <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                <div>
                  <div className="text-[11px] font-bold text-indigo-950">
                    Kepala Project / PMO (1 Orang per Project)
                  </div>
                  <p className="text-[10px] text-indigo-700">
                    Default adalah PMO pembuat project dan dapat diganti bila diperlukan.
                  </p>
                </div>
                <select
                  disabled={teamModalPmoSaving}
                  value={teamModalMaster.pmoUserId || teamModalMaster.createdBy || currentUser?.id || ''}
                  onChange={async (e) => {
                    const nextPmoId = e.target.value;
                    try {
                      setTeamModalPmoSaving(true);
                      setQuickTeamError(null);
                      const res = await apiUpdateMasterProject(teamModalMaster.id, { pmoUserId: nextPmoId });
                      setTeamModalMaster((prev) => (prev ? { ...prev, pmoUserId: res.masterProject.pmoUserId } : prev));
                      setQuickTeamSuccess('Kepala Project / PMO berhasil diperbarui.');
                      await loadMasterProjects();
                    } catch (err: any) {
                      setQuickTeamError(err?.message || 'Gagal mengganti Kepala Project / PMO.');
                    } finally {
                      setTeamModalPmoSaving(false);
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-white text-xs font-semibold text-slate-900 min-w-[220px]"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* Add New Member Form */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="font-bold text-slate-800 flex items-center space-x-1.5">
                  <UserPlus className="w-3.5 h-3.5 text-blue-600" />
                  <span>Tugaskan Personel</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Kepala Project tetap 1 PMO di atas; penugasan tim per site di bawah mulai dari PSO, Admin Project, Site Manager (bisa berbeda tiap site), dan peran site lainnya.
                </p>

                {teamModalSites.length === 0 ? (
                  <div className="text-amber-700 bg-amber-50 border border-amber-200 p-2.5 rounded-lg">
                    Project ini belum memiliki Site Lapangan. Tambahkan minimal 1 Site terlebih dahulu.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                      <div className="sm:col-span-5">
                        <input
                          type="text"
                          value={quickUserSearch}
                          onChange={(e) => setQuickUserSearch(e.target.value)}
                          placeholder="Cari nama/email personel..."
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs mb-1.5"
                        />
                        <select
                          value={quickSelectedUserId}
                          onChange={(e) => setQuickSelectedUserId(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                        >
                          <option value="">-- Pilih Personel ({quickSearchResults.length}) --</option>
                          {quickSearchResults.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.email})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-4 flex flex-col justify-end">
                        <label className="text-[10px] font-semibold text-slate-500 mb-1">
                          Role Penugasan
                        </label>
                        <select
                          value={quickSelectedRoleId}
                          onChange={(e) => setQuickSelectedRoleId(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                        >
                          {AVAILABLE_ROLES.filter((r) =>
                            !isFocusMode ||
                            ['project_manager', 'site_engineer', 'client_viewer'].includes(r.id)
                          ).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-3 flex items-end">
                        <button
                          type="button"
                          disabled={quickTeamSubmitting || !quickSelectedUserId}
                          onClick={handleQuickAddMember}
                          className="w-full py-1.5 px-3 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs disabled:opacity-50 cursor-pointer"
                        >
                          {quickTeamSubmitting ? 'Menyimpan...' : '+ Tugaskan'}
                        </button>
                      </div>
                    </div>

                    {/* Scope Picker: Per Project (All Sites) vs Per Site */}
                    {teamModalSites.length > 1 && (
                      <div className="pt-2 border-t border-slate-200/80 space-y-2">
                        <div className="flex flex-wrap items-center gap-4 text-[11px]">
                          <span className="font-semibold text-slate-600">Lingkup Penugasan:</span>
                          <label className="inline-flex items-center space-x-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="teamScopeMode"
                              checked={teamScopeMode === 'project'}
                              onChange={() => {
                                setTeamScopeMode('project');
                                setTeamTargetSiteIds(teamModalSites.map((s) => s.id));
                              }}
                              className="accent-slate-900"
                            />
                            <span className="font-semibold text-slate-800">
                              Per Project (Berlaku untuk semua {teamModalSites.length} Site)
                            </span>
                          </label>
                          <label className="inline-flex items-center space-x-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="teamScopeMode"
                              checked={teamScopeMode === 'site'}
                              onChange={() => setTeamScopeMode('site')}
                              className="accent-slate-900"
                            />
                            <span className="font-semibold text-slate-800">
                              Per Site Spesifik
                            </span>
                          </label>
                        </div>

                        {teamScopeMode === 'site' && (
                          <div className="flex flex-wrap gap-2 pl-2">
                            {teamModalSites.map((s) => {
                              const checked = teamTargetSiteIds.includes(s.id);
                              return (
                                <label
                                  key={s.id}
                                  className={`px-2.5 py-1 rounded-lg border text-[11px] flex items-center space-x-1.5 cursor-pointer transition-colors ${
                                    checked
                                      ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setTeamTargetSiteIds((prev) => [...prev, s.id]);
                                      } else {
                                        setTeamTargetSiteIds((prev) =>
                                          prev.filter((id) => id !== s.id)
                                        );
                                      }
                                    }}
                                    className="hidden"
                                  />
                                  <span className="font-mono">{s.code}</span>
                                  <span>- {s.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Site Filter Tabs for Assignments List */}
              {teamModalSites.length > 1 && (
                <div className="flex items-center space-x-1.5 flex-wrap">
                  <span className="text-[11px] text-slate-500 font-semibold mr-1">Filter Site:</span>
                  <button
                    type="button"
                    onClick={() => setTeamSiteFilterId('all')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                      teamSiteFilterId === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Semua Site ({quickAssignments.length})
                  </button>
                  {teamModalSites.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setTeamSiteFilterId(s.id)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                        teamSiteFilterId === s.id
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {s.code} ({quickAssignments.filter((a) => a.siteId === s.id).length})
                    </button>
                  ))}
                </div>
              )}

              {/* Assignments List */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="py-2 px-3">Site</th>
                      <th className="py-2 px-3">Personel</th>
                      <th className="py-2 px-3">Peran</th>
                      <th className="py-2 px-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingQuickTeam ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-400">
                          Memuat daftar tim project...
                        </td>
                      </tr>
                    ) : quickAssignments.filter(
                        (a) => teamSiteFilterId === 'all' || a.siteId === teamSiteFilterId
                      ).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-400">
                          Belum ada anggota yang ditugaskan.
                        </td>
                      </tr>
                    ) : (
                      quickAssignments
                        .filter((a) => teamSiteFilterId === 'all' || a.siteId === teamSiteFilterId)
                        .map((a) => (
                          <tr key={`${a.siteId}-${a.id}`} className="hover:bg-slate-50">
                            <td className="py-2 px-3">
                              <span className="px-1.5 py-0.5 rounded bg-slate-900 text-[#d4f038] font-mono text-[10px] font-bold">
                                {a.siteCode}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <div className="font-bold text-slate-900">
                                {a.name || a.userName || users.find((u) => u.id === a.userId)?.name || a.userId}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {a.email || a.userEmail || users.find((u) => u.id === a.userId)?.email || ''}
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              {quickEditAssignment?.id === a.id && quickEditAssignment?.siteId === a.siteId ? (
                                <div className="flex items-center space-x-1">
                                  <select
                                    value={quickEditRoleId}
                                    onChange={(e) => setQuickEditRoleId(e.target.value)}
                                    className="px-2 py-1 rounded border border-slate-300 text-xs bg-white"
                                  >
                                    {AVAILABLE_ROLES.filter((r) =>
                                      !isFocusMode ||
                                      ['project_manager', 'site_engineer', 'client_viewer'].includes(r.id)
                                    ).map((r) => (
                                      <option key={r.id} value={r.id}>
                                        {r.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={quickTeamSubmitting}
                                    onClick={handleQuickUpdateMemberRole}
                                    className="px-2 py-1 rounded bg-slate-900 text-white text-[10px] font-bold cursor-pointer"
                                  >
                                    Simpan
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setQuickEditAssignment(null)}
                                    className="px-2 py-1 rounded border border-slate-300 text-slate-600 text-[10px] cursor-pointer"
                                  >
                                    Batal
                                  </button>
                                </div>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 font-semibold text-[10px]">
                                  {a.roleName || a.roleId}
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right">
                              {a.source !== 'legacy_sync' && (
                                <div className="flex items-center justify-end space-x-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setQuickEditAssignment(a);
                                      setQuickEditRoleId(a.roleId);
                                    }}
                                    className="p-1 rounded border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                                    title="Ubah peran"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleQuickRemoveMember(
                                        a.siteId,
                                        a.id,
                                        a.name || a.userName || users.find((u) => u.id === a.userId)?.name || a.userId
                                      )
                                    }
                                    className="p-1 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                                    title="Nonaktifkan penugasan"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setTeamModalMaster(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Site Picker for Rincian Pekerjaan (when Project has > 1 Site) */}
      {wbsSitePickerMaster && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <FolderTree className="w-4 h-4 text-slate-800" />
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Pilih Site untuk Rincian Pekerjaan</h3>
                  <p className="text-[11px] text-slate-500 truncate max-w-[260px]">
                    {wbsSitePickerMaster.master.code} - {wbsSitePickerMaster.master.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWbsSitePickerMaster(null)}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
              {wbsSitePickerMaster.sites.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setWbsSitePickerMaster(null);
                    setSelectedProjectForStudio(s);
                  }}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-slate-900 hover:bg-slate-50 transition-all flex items-center justify-between gap-2 cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 text-[#d4f038] font-mono text-[10px] font-bold">
                        {s.code}
                      </span>
                      <span className="font-bold text-slate-900 truncate">{s.name}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 flex items-center space-x-1">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate">{s.location || 'Site Lapangan'}</span>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setWbsSitePickerMaster(null)}
                className="px-4 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
