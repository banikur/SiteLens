import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  X,
  FolderTree,
  ClipboardCheck,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  CornerDownLeft,
  Compass,
} from 'lucide-react';
import type {
  Project,
  ChecklistTemplate,
  InspectionRecord,
  CorrectiveAction,
} from '../types';
import type { ActiveTab } from './Navigation';

export interface GlobalSearchProps {
  projects: Project[];
  templates: ChecklistTemplate[];
  inspections: InspectionRecord[];
  actions: CorrectiveAction[];
  onNavigateTab: (tab: ActiveTab) => void;
  onSelectProject?: (project: Project) => void;
  onSelectTemplate?: (template: ChecklistTemplate) => void;
  onSelectInspection?: (inspection: InspectionRecord) => void;
  onSelectAction?: (action: CorrectiveAction) => void;
}

type SearchCategory = 'all' | 'projects' | 'templates' | 'inspections' | 'actions';

interface SearchResultItem {
  id: string;
  category: 'project' | 'template' | 'inspection' | 'action' | 'navigation';
  title: string;
  subtitle: string;
  badge?: string;
  badgeColor?: string;
  payload: any;
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({
  projects,
  templates,
  inspections,
  actions,
  onNavigateTab,
  onSelectProject,
  onSelectTemplate,
  onSelectInspection,
  onSelectAction,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<SearchCategory>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global hotkey Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Autofocus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      setSelectedIndex(0);
    } else {
      setQuery('');
      setActiveCategory('all');
    }
  }, [isOpen]);

  // Compute search results
  const results = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    const items: SearchResultItem[] = [];

    // 1. Navigation items (if query is empty or matches)
    const navItems: Array<{ id: string; title: string; tab: ActiveTab; hint: string }> = [
      { id: 'nav-dash', title: 'Dashboard & Ringkasan Eksekutif', tab: 'dashboard', hint: 'Overview KPI & Metrik' },
      { id: 'nav-proj', title: 'Manajemen Proyek & Multi-Site', tab: 'projects', hint: 'Daftar proyek, lokasi & tim' },
      { id: 'nav-insp', title: 'Inspeksi & Riwayat Verifikasi', tab: 'inspections', hint: 'Log approval & form digital' },
      { id: 'nav-tmpl', title: 'Katalog Template Checklist', tab: 'templates', hint: 'Template standar & kustom' },
      { id: 'nav-act', title: 'Tindakan Korektif & Punchlist (CAPA)', tab: 'actions', hint: 'Penyelesaian isu lapangan' },
      { id: 'nav-anl', title: 'Laporan & Analitik S-Curve', tab: 'analytics', hint: 'Kurva-S & Bottleneck Radar' },
      { id: 'nav-comp', title: 'Kepatuhan Ganda (SMK3 & ISO 45001)', tab: 'compliance', hint: 'Audit regulasi & profil K3' },
    ];

    if (!q) {
      // Default suggestions when query is empty
      navItems.slice(0, 3).forEach((nav) => {
        items.push({
          id: nav.id,
          category: 'navigation',
          title: nav.title,
          subtitle: nav.hint,
          badge: 'Halaman',
          badgeColor: 'bg-slate-100 text-slate-700',
          payload: nav.tab,
        });
      });

      // Show top 3 recent projects
      projects.slice(0, 3).forEach((p) => {
        items.push({
          id: `p-${p.id}`,
          category: 'project',
          title: p.name,
          subtitle: `${p.code} • ${p.client || 'Klien Proyek'} • ${p.location}`,
          badge: p.status.toUpperCase(),
          badgeColor: 'bg-blue-50 text-blue-700 border border-blue-200',
          payload: p,
        });
      });

      // Show top 3 templates
      templates.slice(0, 3).forEach((t) => {
        const codeDisplay = t.standardCode || t.documentControlNo || t.id.slice(-6).toUpperCase();
        items.push({
          id: `t-${t.id}`,
          category: 'template',
          title: t.title,
          subtitle: `${codeDisplay} • Kategori: ${t.category}`,
          badge: 'Checklist',
          badgeColor: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
          payload: t,
        });
      });

      return items;
    }

    // Filter Navigation
    if (activeCategory === 'all') {
      navItems.forEach((nav) => {
        if (nav.title.toLowerCase().includes(q) || nav.hint.toLowerCase().includes(q) || nav.tab.includes(q)) {
          items.push({
            id: nav.id,
            category: 'navigation',
            title: nav.title,
            subtitle: nav.hint,
            badge: 'Halaman',
            badgeColor: 'bg-slate-100 text-slate-700',
            payload: nav.tab,
          });
        }
      });
    }

    // Filter Projects
    if (activeCategory === 'all' || activeCategory === 'projects') {
      projects.forEach((p) => {
        const matchName = p.name.toLowerCase().includes(q);
        const matchCode = p.code.toLowerCase().includes(q);
        const matchClient = p.client?.toLowerCase().includes(q);
        const matchLoc = p.location?.toLowerCase().includes(q);
        const matchSites = p.sites?.some((s) => s.name.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q));

        if (matchName || matchCode || matchClient || matchLoc || matchSites) {
          items.push({
            id: `p-${p.id}`,
            category: 'project',
            title: p.name,
            subtitle: `${p.code} • ${p.client} • ${p.sites?.length ? `${p.sites.length} Titik Site` : p.location}`,
            badge: p.status.toUpperCase(),
            badgeColor: 'bg-blue-50 text-blue-700 border border-blue-200',
            payload: p,
          });
        }
      });
    }

    // Filter Checklist Templates
    if (activeCategory === 'all' || activeCategory === 'templates') {
      templates.forEach((t) => {
        const matchTitle = t.title.toLowerCase().includes(q);
        const codeDisplay = t.standardCode || t.documentControlNo || '';
        const matchCode = codeDisplay.toLowerCase().includes(q);
        const matchCat = t.category.toLowerCase().includes(q);
        const matchDesc = t.description?.toLowerCase().includes(q);

        if (matchTitle || matchCode || matchCat || matchDesc) {
          items.push({
            id: `t-${t.id}`,
            category: 'template',
            title: t.title,
            subtitle: `${codeDisplay || t.id.slice(-6).toUpperCase()} • Kategori: ${t.category}`,
            badge: 'Isi Form',
            badgeColor: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
            payload: t,
          });
        }
      });
    }

    // Filter Inspections
    if (activeCategory === 'all' || activeCategory === 'inspections') {
      inspections.forEach((insp) => {
        const matchTmpl = insp.templateTitle?.toLowerCase().includes(q);
        const matchPrj = insp.projectName?.toLowerCase().includes(q);
        const matchStatus = insp.status?.toLowerCase().includes(q);

        if (matchTmpl || matchPrj || matchStatus) {
          items.push({
            id: `insp-${insp.id}`,
            category: 'inspection',
            title: insp.templateTitle || 'Inspeksi Lapangan',
            subtitle: `Proyek: ${insp.projectName || 'Umum'} • Zone: ${insp.siteZone || '-'} • Oleh: ${insp.inspectorName}`,
            badge: (insp.status || 'draft').toUpperCase(),
            badgeColor:
              insp.status === 'approved'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200',
            payload: insp,
          });
        }
      });
    }

    // Filter Corrective Actions / CAPA
    if (activeCategory === 'all' || activeCategory === 'actions') {
      actions.forEach((act) => {
        const matchLabel = act.fieldLabel?.toLowerCase().includes(q);
        const matchDesc = act.issueDescription?.toLowerCase().includes(q);
        const matchPrj = act.projectName?.toLowerCase().includes(q);

        if (matchLabel || matchDesc || matchPrj) {
          items.push({
            id: `act-${act.id}`,
            category: 'action',
            title: act.fieldLabel || act.issueDescription?.slice(0, 40) || 'Temuan Lapangan',
            subtitle: `Proyek: ${act.projectName} • ${act.issueDescription?.slice(0, 60)}...`,
            badge: `${act.severity.toUpperCase()} • ${act.status}`,
            badgeColor:
              act.severity === 'critical'
                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200',
            payload: act,
          });
        }
      });
    }

    return items;
  }, [query, activeCategory, projects, templates, inspections, actions]);

  // Keep selected index in bound
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length, query]);

  // Handle keyboard list navigation
  const handleKeyDownList = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < results.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      handleSelectItem(results[selectedIndex]);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleSelectItem = (item: SearchResultItem) => {
    setIsOpen(false);
    if (item.category === 'navigation') {
      onNavigateTab(item.payload);
    } else if (item.category === 'project') {
      if (onSelectProject) {
        onSelectProject(item.payload);
      } else {
        onNavigateTab('projects');
      }
    } else if (item.category === 'template') {
      if (onSelectTemplate) {
        onSelectTemplate(item.payload);
      } else {
        onNavigateTab('templates');
      }
    } else if (item.category === 'inspection') {
      if (onSelectInspection) {
        onSelectInspection(item.payload);
      } else {
        onNavigateTab('inspections');
      }
    } else if (item.category === 'action') {
      if (onSelectAction) {
        onSelectAction(item.payload);
      } else {
        onNavigateTab('actions');
      }
    }
  };

  const getCategoryIcon = (category: SearchResultItem['category']) => {
    switch (category) {
      case 'project':
        return <FolderTree className="w-4 h-4 text-blue-600" />;
      case 'template':
        return <ClipboardCheck className="w-4 h-4 text-emerald-600" />;
      case 'inspection':
        return <ShieldCheck className="w-4 h-4 text-indigo-600" />;
      case 'action':
        return <AlertTriangle className="w-4 h-4 text-rose-600" />;
      case 'navigation':
        return <Compass className="w-4 h-4 text-amber-600" />;
    }
  };

  return (
    <>
      {/* Search Trigger Bar in Header */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="group relative flex items-center justify-between w-full max-w-md bg-slate-100/90 hover:bg-slate-200/80 border border-slate-200/90 hover:border-slate-300 rounded-lg px-3.5 py-1.5 text-xs text-slate-500 transition-all cursor-pointer shadow-2xs"
        title="Buka Global Search (Ctrl+K)"
      >
        <div className="flex items-center gap-2 truncate mr-2">
          <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 shrink-0" />
          <span className="truncate text-slate-500 group-hover:text-slate-700">
            Cari proyek, checklist, inspeksi, temuan...
          </span>
        </div>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-600 bg-white border border-slate-200 rounded shadow-2xs shrink-0">
          <span className="text-[11px]">⌘</span>K
        </kbd>
      </button>

      {/* Global Search Command Palette Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 backdrop-blur-xs flex items-start justify-center pt-12 sm:pt-20 p-4">
          <div
            className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in-50 zoom-in-95 duration-150"
            onKeyDown={handleKeyDownList}
          >
            {/* Input Bar */}
            <div className="p-4 border-b border-slate-200 flex items-center gap-3 bg-slate-50/60">
              <Search className="w-5 h-5 text-slate-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ketik nama proyek, kode checklist, isu CAPA, atau nama halaman..."
                className="w-full bg-transparent border-0 text-slate-900 placeholder:text-slate-400 text-sm focus:outline-none focus:ring-0"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-md cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white border border-slate-200 rounded">
                ESC
              </kbd>
            </div>

            {/* Category Filter Pills */}
            <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto bg-white text-xs">
              <span className="text-[11px] text-slate-400 font-semibold mr-1 shrink-0">
                Filter:
              </span>
              {[
                { id: 'all', label: 'Semua' },
                { id: 'projects', label: `Proyek (${projects.length})` },
                { id: 'templates', label: `Checklist (${templates.length})` },
                { id: 'inspections', label: `Inspeksi (${inspections.length})` },
                { id: 'actions', label: `CAPA (${actions.length})` },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id as SearchCategory)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0 cursor-pointer ${
                    activeCategory === cat.id
                      ? 'bg-amber-500 text-slate-950 font-bold'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Results List */}
            <div
              ref={listRef}
              className="flex-1 overflow-y-auto p-2 space-y-1 divide-y divide-slate-50 text-xs"
            >
              {results.length === 0 ? (
                <div className="py-12 text-center text-slate-400">
                  <Search className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="font-semibold text-slate-600 text-sm">Tidak ada hasil ditemukan</p>
                  <p className="text-xs mt-0.5">
                    Tidak ditemukan data yang cocok dengan kata kunci &ldquo;{query}&rdquo;.
                  </p>
                </div>
              ) : (
                results.map((item, idx) => {
                  const isSelected = idx === selectedIndex;

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`p-2.5 rounded-xl flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-amber-50/80 border border-amber-200/90 text-slate-900 shadow-2xs'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            isSelected ? 'bg-white border border-amber-200' : 'bg-slate-100'
                          }`}
                        >
                          {getCategoryIcon(item.category)}
                        </div>
                        <div className="truncate">
                          <div className="font-semibold text-slate-900 truncate flex items-center gap-2">
                            <span>{item.title}</span>
                            {item.badge && (
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  item.badgeColor || 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {item.badge}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            {item.subtitle}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 text-slate-400">
                        {isSelected && (
                          <span className="text-[10px] font-mono font-medium text-amber-800 flex items-center gap-1 mr-1">
                            <span>Buka</span>
                            <CornerDownLeft className="w-3 h-3" />
                          </span>
                        )}
                        <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer with shortcut tips */}
            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-400">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">
                    ↑
                  </kbd>
                  <kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">
                    ↓
                  </kbd>
                  <span>Pilih</span>
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">
                    ↵
                  </kbd>
                  <span>Buka</span>
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[9px] font-mono">
                    ESC
                  </kbd>
                  <span>Tutup</span>
                </span>
              </div>
              <span>
                {results.length} item ditemukan
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
