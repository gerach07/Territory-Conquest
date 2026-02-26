/* ═══════════════════════════════════════════════════════════
   Territory Conquest – I18nContext (React)
   ═══════════════════════════════════════════════════════════ */
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import en from './en.json';
import lv from './lv.json';
import ru from './ru.json';

const locales    = { en, lv, ru };
const LANG_KEY   = 'tc-lang';
const I18nContext = createContext();

function formatString(template, ...args) {
  if (!template) return '';
  return template.replace(/\{(\d+)\}/g, (_, i) => args[+i] ?? '');
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && locales[saved]) return saved;
    const browserLang = navigator.language?.slice(0, 2);
    if (locales[browserLang]) return browserLang;
    return 'en';
  });

  useEffect(() => { localStorage.setItem(LANG_KEY, lang); }, [lang]);

  const setLang = useCallback((l) => { if (locales[l]) setLangState(l); }, []);

  const t = useCallback((key, ...args) => {
    const str = locales[lang]?.[key] || locales.en[key] || key;
    return args.length ? formatString(str, ...args) : str;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t, availableLanguages: Object.keys(locales) }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() { return useContext(I18nContext); }
export default I18nContext;
