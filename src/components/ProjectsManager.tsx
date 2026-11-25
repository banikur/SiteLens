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
} from 'lucide-react';
import { Project, User, ProjectSite, MasterProject } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { ProjectSetupStudio } from './ProjectSetupStudio';
import { SiteLocationMapPicker } from './SiteLocationMapPicker';
import {
  apiGetProjectMembers,
  apiGetMasterProjects,
  apiCreateMasterProject,
  apiArchiveMasterProject,
  apiGetMasterProjectSites,
  apiCreateMasterProjectSite,
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
}

const AVAILABLE_ROLES = [
  { id: 'project_manager', label: 'Project Manager (PM)', desc: 'Pengendalian penuh progress, WBS & tim' },
  { id: 'site_engineer', label: 'Site Engineer (SE)', desc: 'Pengajuan approval, detail WBS & klaim progres' },
  { id: 'field_inspector', label: 'Field Inspector', desc: 'Pelaksanaan checklist lapangan & inspeksi' },
  { id: 'qaqc_lead', label: 'QA/QC Lead', desc: 'Verifikasi kualitas & approval independen (Four-Eyes)' },
  { id: 'subcontractor', label: 'Subcontractor', desc: 'Eksekusi pekerjaan di lapangan & update RFI' },
  { id: 'client_viewer', label: 'Client Viewer', desc: 'Hak pantau read-only untuk pemilik proyek' },
];

export const ProjectsManager: React.FC<ProjectsManagerProps> = ({
  projects,
  currentUser,
  users = [],
  onAddProject,
  onUpdateProject,
}) => {
  const { t } = useLanguage();
  const [selectedProjectForStudio, setSelectedProjectForStudio] = useState<Project | null>(null);

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

  // Master Project Form Modal
  const [masterModalOpen, setMasterModalOpen] = useState(false);
  const [masterFormCode, setMasterFormCode] = useState('');
  const [masterFormName, setMasterFormName] = useState('');
  const [masterFormClient, setMasterFormClient] = useState('');
  const [masterFormDesc, setMasterFormDesc] = useState('');
  const [masterFormStartDate, setMasterFormStartDate] = useState('');
  const [masterFormEndDate, setMasterFormEndDate] = useState('');

  // Site under Master Form Modal
  const [siteModalOpen, setSiteModalOpen] = useState(false);
  const [siteFormCode, setSiteFormCode] = useState('');
  const [siteFormName, setSiteFormName] = useState('');
  const [siteFormClient, setSiteFormClient] = useState('');
  const [siteFormLocation, setSiteFormLocation] = useState('');

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

  const handleCreateMasterProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!masterFormCode.trim() || !masterFormName.trim() || !masterFormClient.trim()) {
      alert('Kode, Nama, dan Klien Master Project wajib diisi.');
      return;
    }
    try {
      setIsSubmitting(true);
      await apiCreateMasterProject({
        code: masterFormCode.trim().toUpperCase(),
        name: masterFormName.trim(),
        ownerClient: masterFormClient.trim(),
        description: masterFormDesc.trim() || null,
        startDate: masterFormStartDate || null,
        endDate: masterFormEndDate || null,
      });
      setMasterSuccess('Master Project berhasil dibuat.');
      setMasterModalOpen(false);
      setMasterFormCode('');
      setMasterFormName('');
      setMasterFormClient('');
      setMasterFormDesc('');
      setMasterFormStartDate('');
      setMasterFormEndDate('');
      await loadMasterProjects();
      setTimeout(() => setMasterSuccess(null), 3500);
    } catch (err: any) {
      alert(err?.message || 'Gagal membuat Master Project.');
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

  const handleCreateSiteUnderMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMasterProject) return;
    if (!siteFormCode.trim() || !siteFormName.trim()) {
      alert('Kode Site dan Nama Site wajib diisi.');
      return;
    }
    try {
      setIsSubmitting(true);
      await apiCreateMasterProjectSite(selectedMasterProject.id, {
        code: siteFormCode.trim().toUpperCase(),
        name: siteFormName.trim(),
        client: siteFormClient.trim() || selectedMasterProject.ownerClient,
        location: siteFormLocation.trim() || 'Site Lapangan',
      });
      setMasterSuccess(`Site ${siteFormCode.toUpperCase()} berhasil dibuat dan Anda otomatis ditugaskan sebagai PM.`);
      setSiteModalOpen(false);
      setSiteFormCode('');
      setSiteFormName('');
      setSiteFormClient('');
      setSiteFormLocation('');
      await loadMasterSites(selectedMasterProject.id);
      await loadMasterProjects();
      setTimeout(() => setMasterSuccess(null), 3500);
    } catch (err: any) {
      alert(err?.message || 'Gagal membuat Site di bawah Master Project.');
    } finally {
      setIsSubmitting(false);
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
            {viewMode === 'master' ? <Building2 className="w-4 h-4" /> : 'PRJ'}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-slate-900 leading-tight">
                {viewMode === 'master'
                  ? selectedMasterProject
                    ? `Site Lapangan: ${selectedMasterProject.name}`
                    : 'Master Project (Program Kontrak)'
                  : t.projects.title}
              </h1>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 font-semibold text-slate-600">
                {viewMode === 'master'
                  ? selectedMasterProject
                    ? `${masterSites.length} Site Lapangan`
                    : `${masterProjects.length} Master Project`
                  : `${projects.length} Total Proyek`}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden xl:block">
              {viewMode === 'master'
                ? selectedMasterProject
                  ? `Mengelola unit isolasi site di bawah kontrak ${selectedMasterProject.code} (${selectedMasterProject.ownerClient}).`
                  : 'Payung kontrak/program induk di atas beberapa site lapangan konstruksi.'
                : 'Manajemen proyek konstruksi, geofence titik site, dan penugasan tim.'}
            </p>
          </div>
        </div>

        {/* Search, Filter, Mode Switcher & Actions */}
        <div className="flex items-center space-x-2 flex-wrap">
          {/* Mode Switcher (Hidden in strict focus mode) */}
          {!isFocusMode && (
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => {
                  setViewMode('master');
                  setSelectedMasterProject(null);
                }}
                className={`px-2 py-0.5 rounded-md font-semibold transition-colors text-xs flex items-center space-x-1 ${
                  viewMode === 'master'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Building2 className="w-3 h-3 text-slate-700" />
                <span>Master Project</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('sites')}
                className={`px-2 py-0.5 rounded-md font-semibold transition-colors text-xs flex items-center space-x-1 ${
                  viewMode === 'sites'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers className="w-3 h-3 text-slate-700" />
                <span>Semua Site</span>
              </button>
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
                  className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors flex items-center shadow-2xs"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1 text-slate-600" />
                  <span>Daftar Master</span>
                </button>
                <button
                  type="button"
                  disabled={isLoadingPerms || !can(PERMISSIONS.PROJECT_CREATE, selectedMasterProject.id)}
                  onClick={() => {
                    setSiteFormCode('');
                    setSiteFormName('');
                    setSiteFormClient(selectedMasterProject.ownerClient);
                    setSiteFormLocation('');
                    setSiteModalOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-xs font-bold transition-colors flex items-center shadow-2xs disabled:opacity-50"
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
                onClick={() => {
                  setMasterFormCode('');
                  setMasterFormName('');
                  setMasterFormClient('');
                  setMasterFormDesc('');
                  setMasterFormStartDate('');
                  setMasterFormEndDate('');
                  setMasterModalOpen(true);
                }}
                className="px-2.5 py-1 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-xs font-bold transition-colors flex items-center shadow-2xs disabled:opacity-50"
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
                      const q = searchQuery.toLowerCase();
                      return (
                        !q ||
                        mp.name.toLowerCase().includes(q) ||
                        mp.code.toLowerCase().includes(q) ||
                        mp.ownerClient.toLowerCase().includes(q)
                      );
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
                              onClick={() => setSelectedMasterProject(mp)}
                              className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold text-[11px] shadow-2xs transition-colors flex items-center space-x-1"
                            >
                              <span>Buka Site</span>
                              <ExternalLink className="w-3 h-3 text-[#d4f038]" />
                            </button>
                            {mp.status === 'active' && can(PERMISSIONS.MASTERPROJECT_MANAGE) && (
                              <button
                                type="button"
                                onClick={() => handleArchiveMaster(mp.id, mp.name)}
                                className="p-1 rounded-md text-slate-400 hover:text-amber-700 hover:bg-amber-50 transition-colors"
                                title="Arsipkan Master Project ini"
                              >
                                <Archive className="w-3.5 h-3.5" />
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
                            <button
                              type="button"
                              onClick={() => setSelectedProjectForStudio(site)}
                              className="px-2.5 py-1 rounded-md bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-[11px] shadow-2xs transition-colors inline-flex items-center space-x-1"
                            >
                              <span>Setup Site (Tim & WBS)</span>
                              <ExternalLink className="w-3 h-3 text-[#0b0e14]" />
                            </button>
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
      {/* Modal: Create Master Project */}
      {masterModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <Building2 className="w-4 h-4 text-slate-800" />
                <h3 className="font-bold text-slate-900 text-sm">Buat Master Project Baru</h3>
              </div>
              <button
                type="button"
                onClick={() => setMasterModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateMasterProject} className="p-5 space-y-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Kode Master Project *</label>
                <input
                  type="text"
                  required
                  value={masterFormCode}
                  onChange={(e) => setMasterFormCode(e.target.value)}
                  placeholder="mis. MP-IKN-001"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs uppercase font-mono focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nama Program / Kontrak *</label>
                <input
                  type="text"
                  required
                  value={masterFormName}
                  onChange={(e) => setMasterFormName(e.target.value)}
                  placeholder="mis. Proyek Pembangunan Gedung & Infrastruktur IKN"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Pemilik Kontrak / Klien *</label>
                <input
                  type="text"
                  required
                  value={masterFormClient}
                  onChange={(e) => setMasterFormClient(e.target.value)}
                  placeholder="mis. Kementerian PUPR / Otorita IKN"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Deskripsi Singkat Program</label>
                <textarea
                  rows={2}
                  value={masterFormDesc}
                  onChange={(e) => setMasterFormDesc(e.target.value)}
                  placeholder="Keterangan lingkup kontrak dan pengawasan..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
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

              <div className="pt-2 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setMasterModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold shadow-xs transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Menyimpan...' : 'Buat Master Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Site under Selected Master Project */}
      {siteModalOpen && selectedMasterProject && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <MapPin className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-sm">Buat Site Lapangan Baru</h3>
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

            <form onSubmit={handleCreateSiteUnderMaster} className="p-5 space-y-4">
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

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600">
                <span className="font-bold text-slate-800 block mb-0.5">Auto-Assignment Pembuat Site:</span>
                Anda akan otomatis ditugaskan sebagai Project Manager (PM) pada site ini secara transaksional.
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setSiteModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold shadow-xs transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Membuat...' : 'Buat Site'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
