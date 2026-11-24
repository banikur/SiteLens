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
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            {t.projects.title}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Kelola proyek konstruksi, penugasan titik site geografis, dan anggota tim pelaksana.
          </p>
        </div>
        <button
          onClick={handleOpenCreateModal}
          className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs cursor-pointer"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          {t.projects.addProjectBtn}
        </button>
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map((prj) => {
          const prjSites = prj.sites && prj.sites.length > 0 ? prj.sites : [];
          const primarySite = prjSites.find((s) => s.isPrimary) || prjSites[0];
          const isSitesExpanded = expandedSitesProjectId === prj.id;

          return (
            <div
              key={prj.id}
              className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col justify-between shadow-xs hover:border-slate-300 transition-all"
            >
              <div>
                {/* Header Badge */}
                <div className="flex items-center justify-between mb-2 text-xs">
                  <span className="font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    {prj.code}
                  </span>
                  <span
                    className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded ${
                      prj.status === 'active'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : prj.status === 'completed'
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {prj.status}
                  </span>
                </div>

                <h2 className="text-base font-bold text-slate-900 leading-snug">
                  {prj.name}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">{prj.client}</p>

                {/* Multiple Sites Summary */}
                <div className="mt-3.5 bg-slate-50 rounded-lg p-3 border border-slate-200/80">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center text-xs text-slate-700 font-semibold truncate mr-2">
                      <MapPin className="w-3.5 h-3.5 mr-1.5 text-blue-600 shrink-0" />
                      <span className="truncate">
                        {primarySite ? primarySite.name : prj.location}
                      </span>
                    </div>
                    {prjSites.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSitesProjectId(
                            isSitesExpanded ? null : prj.id
                          )
                        }
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 px-1.5 py-0.5 rounded cursor-pointer transition-colors shrink-0"
                      >
                        <span>+{prjSites.length - 1} Lokasi</span>
                        {isSitesExpanded ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Coordinates pill */}
                  {primarySite && (
                    <div className="text-[10px] text-slate-500 font-mono mt-1 flex items-center gap-2">
                      <span>Lat: {primarySite.latitude.toFixed(4)}</span>
                      <span>Lng: {primarySite.longitude.toFixed(4)}</span>
                      {primarySite.radiusMeters && (
                        <span>({primarySite.radiusMeters}m geofence)</span>
                      )}
                    </div>
                  )}

                  {/* Expanded Sites Accordion */}
                  {isSitesExpanded && prjSites.length > 1 && (
                    <div className="mt-2.5 pt-2 border-t border-slate-200/80 space-y-1.5">
                      {prjSites.map((site) => (
                        <div
                          key={site.id}
                          className="flex items-center justify-between text-[11px] text-slate-600 py-1 px-1.5 rounded bg-white border border-slate-100"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="text-xs">
                              {site.isPrimary ? '🌟' : '📍'}
                            </span>
                            <span className="font-medium truncate">{site.name}</span>
                            {site.code && (
                              <span className="font-mono text-[9px] text-slate-400">
                                ({site.code})
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[10px] text-slate-500 shrink-0">
                            {site.latitude.toFixed(3)}, {site.longitude.toFixed(3)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Zones */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-2">
                    {t.projects.designatedZones.replace(
                      '{count}',
                      String(prj.zones?.length || 0)
                    )}
                  </span>
                  <div className="space-y-1.5">
                    {prj.zones?.slice(0, 2).map((zone) => (
                      <div
                        key={zone.id}
                        className="p-2 rounded bg-slate-50 border border-slate-100 text-xs flex items-center justify-between"
                      >
                        <div className="truncate mr-2">
                          <span className="font-semibold text-slate-800 block truncate">
                            {zone.name}
                          </span>
                          <span className="text-[10px] text-slate-400 block truncate">
                            {zone.description}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-bold uppercase shrink-0 ${
                            zone.safetyLevel === 'High Risk'
                              ? 'text-rose-700'
                              : zone.safetyLevel === 'Restricted'
                              ? 'text-amber-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {zone.safetyLevel}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Metrics */}
              <div className="mt-5 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block">
                    {t.projects.compliance}
                  </span>
                  <span className="font-bold text-emerald-600 font-mono tabular-nums">
                    {prj.complianceRate}%
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">
                    {t.projects.inspections}
                  </span>
                  <span className="font-bold text-slate-900 font-mono tabular-nums">
                    {prj.activeInspectionsCount}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">
                    {t.projects.openIssues}
                  </span>
                  <span
                    className={`font-bold font-mono tabular-nums ${
                      prj.openIssuesCount > 0 ? 'text-rose-600' : 'text-slate-500'
                    }`}
                  >
                    {prj.openIssuesCount}
                  </span>
                </div>
              </div>

              {/* Action Buttons: Edit Project & WBS Setup */}
              <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenEditModal(prj)}
                  className="py-2 px-3 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold transition-colors flex items-center justify-center space-x-1 cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                  <span>Edit Info & Site</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProjectForStudio(prj)}
                  className="py-2 px-3 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-bold transition-colors flex items-center justify-center space-x-1 cursor-pointer"
                >
                  <FolderTree className="w-3.5 h-3.5 text-amber-700" />
                  <span>Setup WBS</span>
                </button>
              </div>
            </div>
          );
        })}
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
