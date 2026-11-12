import React, { useState } from 'react';
import {
  MapPin,
  Plus,
  X,
} from 'lucide-react';
import { Project } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface ProjectsManagerProps {
  projects: Project[];
  onAddProject: (project: Project) => void;
}

export const ProjectsManager: React.FC<ProjectsManagerProps> = ({
  projects,
  onAddProject,
}) => {
  const { t } = useLanguage();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [client, setClient] = useState('');
  const [location, setLocation] = useState('');
  const [leadManager] = useState('Arthur Sterling');

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) {
      return;
    }

    const newProject: Project = {
      id: `prj-${Date.now().toString().slice(-4)}`,
      name,
      code: code.toUpperCase(),
      client: client || 'Enterprise Developer Corp',
      location: location || 'Central Industrial Sector',
      status: 'active',
      leadManager,
      activeInspectionsCount: 0,
      openIssuesCount: 0,
      complianceRate: 100,
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

    onAddProject(newProject);
    setModalOpen(false);
    setName('');
    setCode('');
    setClient('');
    setLocation('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            {t.projects.title}
          </h1>
          <p className="text-xs text-slate-500 mt-1">{t.projects.subtitle}</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          {t.projects.addProjectBtn}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map((prj) => (
          <div
            key={prj.id}
            className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col justify-between shadow-xs hover:border-slate-300 transition-all"
          >
            <div>
              <div className="flex items-center justify-between mb-2 text-xs">
                <span className="font-mono font-bold text-amber-700">
                  {prj.code}
                </span>
                <span className="text-[11px] font-semibold uppercase text-emerald-700">
                  {prj.status}
                </span>
              </div>

              <h2 className="text-base font-bold text-slate-900 leading-snug">
                {prj.name}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">{prj.client}</p>

              <div className="flex items-center text-xs text-slate-500 mt-2">
                <MapPin className="w-3.5 h-3.5 mr-1 text-slate-400 shrink-0" />
                <span className="truncate">{prj.location}</span>
              </div>

              {/* Zones */}
              <div className="mt-5 pt-4 border-t border-slate-100">
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block mb-2">
                  {t.projects.designatedZones.replace(
                    '{count}',
                    String(prj.zones.length)
                  )}
                </span>
                <div className="space-y-1.5">
                  {prj.zones.map((zone) => (
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
            <div className="mt-6 pt-4 border-t border-slate-100 grid grid-cols-3 gap-2 text-center text-xs">
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
          </div>
        ))}
      </div>

      {/* New Project Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-base font-bold text-slate-900">
                {t.projects.modalTitle}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateProject} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  {t.projects.projectTitleLabel}
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Bayfront Logistics Hub"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    {t.projects.siteCodeLabel}
                  </label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. BLH-01"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    {t.projects.clientAuthorityLabel}
                  </label>
                  <input
                    type="text"
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                    placeholder="e.g. Regional Port Trust"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  {t.projects.locationLabel}
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. East Industrial Wharf, Berth 7"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                >
                  {t.projects.createSiteBtn}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
