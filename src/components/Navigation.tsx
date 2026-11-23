import React, { useState } from 'react';
import {
  Layers,
  ClipboardList,
  CheckSquare,
  AlertTriangle,
  Building2,
  BarChart3,
  Users,
  Plus,
  RotateCcw,
  ChevronDown,
  UserCheck,
  Menu,
  X,
  Wand2,
  Globe,
  Shield,
  LogOut,
  Wifi,
  WifiOff,
  RefreshCw,
  Settings,
  Compass,
} from 'lucide-react';
import { User } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';

export type ActiveTab =
  | 'dashboard'
  | 'builder'
  | 'templates'
  | 'inspections'
  | 'actions'
  | 'projects'
  | 'analytics'
  | 'team'
  | 'compliance'
  | 'settings';

interface NavigationProps {
  currentTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  activeUser: User;
  allUsers: User[];
  onSwitchUser: (userId: string) => void;
  onResetData: () => void;
  onNewTemplate: () => void;
  onOpenAIGenerator: () => void;
  pendingReviewsCount: number;
  openActionsCount: number;
  totalTemplatesCount: number;
  authEnabled?: boolean;
  onOpenSecurity?: () => void;
  onLogout?: () => void;
  isOnline?: boolean;
  pendingSyncCount?: number;
  onSyncNow?: () => void;
  onOpenTour?: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentTab,
  onSelectTab,
  activeUser,
  allUsers,
  onSwitchUser,
  onResetData,
  onNewTemplate,
  onOpenAIGenerator,
  pendingReviewsCount,
  openActionsCount,
  totalTemplatesCount,
  authEnabled = false,
  onOpenSecurity,
  onLogout,
  isOnline = true,
  pendingSyncCount = 0,
  onSyncNow,
  onOpenTour,
}) => {
  const { lang, setLang, t, translateRole } = useLanguage();
  const { can, isLoading: isLoadingPerms } = usePermission();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    {
      id: 'dashboard' as ActiveTab,
      label: t.nav.dashboard,
      icon: Layers,
    },
    {
      id: 'templates' as ActiveTab,
      label: t.nav.templates,
      icon: ClipboardList,
      count: totalTemplatesCount,
    },
    {
      id: 'inspections' as ActiveTab,
      label: t.nav.inspections,
      icon: CheckSquare,
      badge:
        pendingReviewsCount > 0
          ? `${pendingReviewsCount} ${t.nav.reviewBadge}`
          : undefined,
    },
    {
      id: 'actions' as ActiveTab,
      label: t.nav.actions,
      icon: AlertTriangle,
      badge:
        openActionsCount > 0 ? `${openActionsCount} ${t.nav.openBadge}` : undefined,
      badgeAlert: true,
    },
    {
      id: 'projects' as ActiveTab,
      label: t.nav.projects,
      icon: Building2,
    },
    {
      id: 'analytics' as ActiveTab,
      label: t.nav.analytics,
      icon: BarChart3,
    },
    {
      id: 'team' as ActiveTab,
      label: t.nav.team,
      icon: Users,
    },
    {
      id: 'compliance' as ActiveTab,
      label: lang === 'id' ? 'Kepatuhan & Profil' : 'Dual-Compliance',
      icon: Shield,
    },
    ...(authEnabled &&
    !isLoadingPerms &&
    (can(PERMISSIONS.ADMIN_ROLES) || can(PERMISSIONS.ADMIN_SETTINGS) || can(PERMISSIONS.ADMIN_USERS))
      ? [
          {
            id: 'settings' as ActiveTab,
            label: lang === 'id' ? 'Notifikasi & Audit' : 'Alerts & Audit',
            icon: Settings,
          },
        ]
      : []),
  ];

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="lg:hidden bg-[#0b0e14] border-b border-slate-800 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded bg-[#d4f038] flex items-center justify-center font-mono font-bold text-[#0b0e14] text-xs shadow-xs">
            SL
          </div>
          <span className="font-bold text-sm tracking-tight text-slate-100">SiteLens</span>
        </div>
        <div className="flex items-center space-x-2">
          {/* Mobile Language Toggle */}
          <div className="flex items-center bg-[#161c28] rounded p-0.5 border border-slate-700/80">
            <button
              onClick={() => setLang('en')}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                lang === 'en' ? 'bg-[#d4f038] text-[#0b0e14]' : 'text-slate-400'
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLang('id')}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                lang === 'id' ? 'bg-[#d4f038] text-[#0b0e14]' : 'text-slate-400'
              }`}
            >
              ID
            </button>
          </div>
          <button
            onClick={onOpenAIGenerator}
            className="px-2.5 py-1 rounded bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs flex items-center shadow-xs"
          >
            <Wand2 className="w-3.5 h-3.5 mr-1" />
            AI
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-slate-800"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-[#06090e]/80 backdrop-blur-xs flex flex-col">
          <div className="bg-[#0b0e14] border-b border-slate-800 p-4 flex items-center justify-between">
            <span className="text-sm font-bold text-white">SiteLens</span>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-1 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4 space-y-1 bg-[#0b0e14] flex-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-[#161c28] text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[10px] font-mono text-[#d4f038]">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Desktop Persistent Sidebar */}
      <aside className="hidden lg:flex w-64 bg-[#0b0e14] border-r border-slate-800 flex-col flex-shrink-0 select-none">
        {/* Brand Zone + Language Toggle */}
        <div className="h-16 flex items-center px-5 border-b border-slate-800/80 justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#d4f038] flex items-center justify-center font-mono font-bold text-[#0b0e14] text-sm shadow-xs">
              SL
            </div>
            <div>
              <div className="text-sm font-bold text-white tracking-tight leading-none">
                SiteLens
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {t.nav.brandSubtitle}
              </div>
            </div>
          </div>

          {/* Segmented EN / ID Switcher */}
          <div
            className="flex items-center bg-[#161c28] rounded-md p-0.5 border border-slate-700/80"
            title={t.common.languageLabel}
          >
            <button
              onClick={() => setLang('en')}
              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                lang === 'en'
                  ? 'bg-[#d4f038] text-[#0b0e14] shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLang('id')}
              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                lang === 'id'
                  ? 'bg-[#d4f038] text-[#0b0e14] shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ID
            </button>
          </div>
        </div>

        {/* Primary Navigation List */}
        <div className="flex-1 py-5 px-3 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            {t.nav.operationsHeader}
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors group ${
                  isActive
                    ? 'bg-[#161c28] text-white font-semibold'
                    : 'text-slate-300 hover:text-white hover:bg-slate-850'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      isActive
                        ? 'text-[#d4f038]'
                        : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && (
                  <span className="text-[11px] font-mono tabular-nums text-slate-400">
                    {item.count}
                  </span>
                )}
                {item.badge && (
                  <span
                    className={`text-[10px] font-mono tabular-nums font-medium ${
                      item.badgeAlert ? 'text-rose-400' : 'text-[#d4f038]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Quick Builder & AI Generator CTA Box */}
        <div className="p-3 mx-3 mb-3 rounded-lg bg-[#121722] border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              {t.nav.builderCardTitle}
            </span>
            <span className="text-[10px] text-[#d4f038] font-mono">
              {t.nav.builderCardTag}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {t.nav.builderCardDesc}
          </p>
          <div className="space-y-1.5 pt-1">
            <button
              onClick={onOpenAIGenerator}
              className="w-full inline-flex items-center justify-center px-3 py-2 rounded-md bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-xs font-bold transition-colors shadow-xs"
            >
              <Wand2 className="w-3.5 h-3.5 mr-1.5" />
              {t.nav.generateWithAI}
            </button>
            <button
              onClick={onNewTemplate}
              className="w-full inline-flex items-center justify-center px-3 py-1.5 rounded-md border border-slate-700 hover:border-slate-600 text-slate-200 hover:text-white text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              {t.nav.buildNewChecklist}
            </button>
          </div>
        </div>

        {/* Offline / Sync Status Pill */}
        {authEnabled && (
          <div className="px-3 py-2 border-t border-slate-800 bg-[#06090e]/60 flex items-center justify-between text-[11px]">
            <div className="flex items-center space-x-1.5">
              {isOnline ? (
                <Wifi className="w-3.5 h-3.5 text-[#d4f038]" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span className={isOnline ? 'text-[#d4f038] font-medium' : 'text-amber-400 font-semibold'}>
                {isOnline ? (lang === 'id' ? 'Online' : 'Online') : lang === 'id' ? 'Mode Offline' : 'Offline Mode'}
              </span>
            </div>
            {pendingSyncCount > 0 && (
              <button
                type="button"
                onClick={onSyncNow}
                disabled={!isOnline}
                className="px-2 py-0.5 rounded bg-[#d4f038]/10 text-[#d4f038] border border-[#d4f038]/30 hover:bg-[#d4f038]/20 disabled:opacity-50 flex items-center space-x-1 font-mono tabular-nums text-[10px]"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                <span>{pendingSyncCount}</span>
              </button>
            )}
          </div>
        )}

        {/* Guided Demo Tour Trigger */}
        <div className="p-3 pb-0 bg-[#06090e]">
          <button
            type="button"
            onClick={onOpenTour}
            className="w-full py-2 px-3 rounded-lg bg-[#d4f038]/15 hover:bg-[#d4f038]/25 text-[#d4f038] border border-[#d4f038]/40 text-xs font-bold transition-all flex items-center justify-center space-x-2 shadow-xs cursor-pointer"
          >
            <Compass className="w-4 h-4 text-[#d4f038]" />
            <span>{lang === 'id' ? 'Panduan Alur Demo' : 'Guided Demo Tour'}</span>
          </button>
        </div>

        {/* Active Persona & User Switcher Card */}
        <div className="p-3 border-t border-slate-800 relative bg-[#06090e]">
          <button
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            className="w-full flex items-center justify-between p-1.5 rounded-lg hover:bg-slate-800/70 transition-colors text-left"
          >
            <div className="flex items-center space-x-2.5 overflow-hidden">
              {activeUser.avatar ? (
                <img
                  src={activeUser.avatar}
                  alt={activeUser.name}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full border border-slate-700 object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full border border-slate-700 bg-[#d4f038]/15 text-[#d4f038] flex items-center justify-center text-xs font-mono font-bold flex-shrink-0">
                  {activeUser.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="overflow-hidden">
                <div className="text-xs font-semibold text-white truncate leading-tight">
                  {activeUser.name}
                </div>
                <div className="text-[10px] text-slate-400 truncate mt-0.5">
                  {translateRole(activeUser.role)}
                </div>
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 ml-1" />
          </button>

          {/* Persona Switcher or Authenticated Account Menu */}
          {userDropdownOpen && authEnabled && (
            <div className="absolute bottom-full left-3 right-3 mb-2 bg-[#0b0e14] border border-slate-700 rounded-xl shadow-2xl py-2 z-50 text-xs">
              <div className="px-3 py-1.5 border-b border-slate-800 text-[10px] font-semibold text-slate-400">
                {lang === 'id' ? 'Akun & Keamanan' : 'Account & Security'}
              </div>
              <div className="p-1.5 space-y-1">
                <button
                  onClick={() => {
                    onOpenSecurity?.();
                    setUserDropdownOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg flex items-center space-x-2 text-slate-200 hover:bg-slate-800 transition-colors"
                >
                  <Shield className="w-3.5 h-3.5 text-[#d4f038]" />
                  <span>{lang === 'id' ? 'PIN & Sidik Jari' : 'PIN & Biometrics'}</span>
                </button>
                <button
                  onClick={() => {
                    onLogout?.();
                    setUserDropdownOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg flex items-center space-x-2 text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{lang === 'id' ? 'Keluar' : 'Sign Out'}</span>
                </button>
              </div>
            </div>
          )}

          {userDropdownOpen && !authEnabled && (
            <div className="absolute bottom-full left-3 right-3 mb-2 bg-[#0b0e14] border border-slate-700 rounded-xl shadow-2xl py-2 z-50 text-xs">
              <div className="px-3 py-1.5 border-b border-slate-800 text-[10px] font-semibold text-slate-400 flex items-center justify-between">
                <span>{t.nav.switchPersona}</span>
                <UserCheck className="w-3 h-3 text-amber-400" />
              </div>
              <div className="max-h-56 overflow-y-auto py-1 divide-y divide-slate-800/50">
                {allUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => {
                      onSwitchUser(u.id);
                      setUserDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center space-x-2.5 transition-colors ${
                      u.id === activeUser.id
                        ? 'bg-slate-800 text-white font-semibold'
                        : 'text-slate-300 hover:bg-slate-850 hover:text-white'
                    }`}
                  >
                    <img
                      src={u.avatar}
                      alt={u.name}
                      referrerPolicy="no-referrer"
                      className="w-6 h-6 rounded-full object-cover border border-slate-700"
                    />
                    <div className="truncate">
                      <div className="truncate">{u.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {translateRole(u.role)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="px-3 pt-2 border-t border-slate-800 mt-1 space-y-1">
                <button
                  onClick={() => {
                    onLogout?.();
                    setUserDropdownOpen(false);
                  }}
                  className="w-full flex items-center justify-center space-x-1.5 py-1.5 text-[11px] text-[#d4f038] hover:underline transition-colors"
                >
                  <LogOut className="w-3 h-3" />
                  <span>{lang === 'id' ? 'Ganti Role / Halaman Login' : 'Switch Role / Sign Out'}</span>
                </button>
                <button
                  onClick={() => {
                    onResetData();
                    setUserDropdownOpen(false);
                  }}
                  className="w-full flex items-center justify-center space-x-1.5 py-1.5 text-[11px] text-slate-400 hover:text-amber-400 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{t.nav.resetDemoData}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
