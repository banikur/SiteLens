import React, { createContext, useContext, useState } from 'react';
import { Language, TRANSLATIONS } from './translations';
import { ChecklistCategory, UserRole, InspectionStatus, ActionStatus } from '../types';

const LANG_STORAGE_KEY = 'sitelens_lang_v1';

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: typeof TRANSLATIONS['en'];
  translateCategory: (cat: ChecklistCategory | 'All' | string) => string;
  translateRole: (role: UserRole | string) => string;
  translateStatus: (status: InspectionStatus | ActionStatus | string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{
  children: React.ReactNode;
  onLanguageChange?: (lang: Language) => void;
}> = ({ children, onLanguageChange }) => {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    return saved === 'id' || saved === 'en' ? saved : 'en';
  });

  const setLang = (newLang: Language) => {
    localStorage.setItem(LANG_STORAGE_KEY, newLang);
    setLangState(newLang);
    if (onLanguageChange) {
      onLanguageChange(newLang);
    }
  };

  const t = TRANSLATIONS[lang];

  const translateCategory = (cat: ChecklistCategory | 'All' | string): string => {
    return (t.categories as Record<string, string>)[cat] || cat;
  };

  const translateRole = (role: UserRole | string): string => {
    return (t.roles as Record<string, string>)[role] || role;
  };

  const translateStatus = (status: InspectionStatus | ActionStatus | string): string => {
    return (t.statuses as Record<string, string>)[status] || status.replace('_', ' ');
  };

  return (
    <LanguageContext.Provider
      value={{
        lang,
        setLang,
        t,
        translateCategory,
        translateRole,
        translateStatus,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
