import React, { useState } from 'react';
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
} from 'lucide-react';
import { Project, User, ProjectSite } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { ProjectSetupStudio } from './ProjectSetupStudio';
import { SiteLocationMapPicker } from './SiteLocationMapPicker';
import { apiGetProjectMembers } from '../services/api';

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
      {/* =========================================================================
          TOP UNIFIED TOOLBAR: Title, Search, Filter, & Add Project Action (~44px)
          ========================================================================= */}
      <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-[#d4f038] flex items-center justify-center font-bold font-mono text-xs shrink-0">
            PRJ
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-slate-900 leading-tight">
                {t.projects.title}
              </h1>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 font-semibold text-slate-600">
                {projects.length} Total Proyek
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden xl:block">
              Manajemen proyek konstruksi, geofence titik site, dan penugasan tim.
            </p>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="flex items-center space-x-2 flex-wrap">
          <div className="relative w-48 sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari kode, nama, klien..."
              className="w-full pl-8 pr-3 py-1 text-xs border border-slate-200 rounded-md bg-white text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2 py-0.5 rounded-md font-semibold transition-colors text-xs ${
                statusFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Semua
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`px-2 py-0.5 rounded-md font-semibold transition-colors text-xs ${
                statusFilter === 'active'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Aktif
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('completed')}
              className={`px-2 py-0.5 rounded-md font-semibold transition-colors text-xs ${
                statusFilter === 'completed'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Selesai
            </button>
          </div>

          <button
            onClick={handleOpenCreateModal}
            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-2xs whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            <span>+ Proyek</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          MAIN WORKSPACE: Compact Projects Matrix Table (100% Locked Height)
          ========================================================================= */}
      <div className="flex-1 min-h-0 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
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
                              title="Buka Studio Setup WBS, Bobot & Workflow"
                            >
                              <FolderTree className="w-3 h-3 text-[#d4f038]" />
                              <span>Setup WBS</span>
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
    </div>
  );
};
