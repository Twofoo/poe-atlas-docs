// Перевод интерфейса. Ключ — русский текст, словарь en — английский перевод.
// Без DOM-зависимостей при импорте: модуль используется и в node-тестах (там всегда русский).
import en from './i18n-en.js';

const KEY = 'poeatlasdocs:set:lang';
const hasLS = typeof localStorage !== 'undefined';
const listeners = new Set();

function readLang() {
  try {
    const v = hasLS ? JSON.parse(localStorage.getItem(KEY) || 'null') : null;
    return v === 'en' || v === 'ru' ? v : 'ru';
  } catch {
    return 'ru';
  }
}

let lang = readLang();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const LANGS = { ru: 'Русский', en: 'English' };
export const getLang = () => lang;
export const locale = () => (lang === 'en' ? 'en-GB' : 'ru-RU');

export function setLang(l) {
  if (l !== 'ru' && l !== 'en') return;
  lang = l;
  if (hasLS) localStorage.setItem(KEY, JSON.stringify(l));
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  listeners.forEach((cb) => cb(l));
}

export function onLangChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Язык, выбранный в другом окне приложения (например, в отдельном окне атласа)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      const l = readLang();
      if (l !== lang) { lang = l; document.documentElement.lang = l; listeners.forEach((cb) => cb(l)); }
    }
  });
}

/**
 * Перевод строки. Подстановки: {0}, {1}… (массив) или {name} (объект).
 * Нет перевода — возвращается русский текст.
 */
export function tx(s, vars) {
  let out = lang === 'en' && en[s] != null ? en[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return out;
}
