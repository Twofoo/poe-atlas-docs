import { tx } from './i18n.js';
// Обёртка над IPC-хранилищем Electron. В обычном браузере (для отладки) — localStorage.
const hasApi = typeof window !== 'undefined' && !!window.api;

const ls = {
  key: (kind) => 'poeatlasdocs:' + kind,
  all(kind) { try { return JSON.parse(localStorage.getItem(this.key(kind)) || '{}'); } catch { return {}; } },
  save(kind, all) { localStorage.setItem(this.key(kind), JSON.stringify(all)); },
};
const listeners = new Set();

export const store = {
  /** Список метаданных. У массива есть поле unreadable — файлы, которые не удалось прочитать. */
  async list(kind) {
    if (hasApi) {
      const r = await window.api.list(kind);
      const arr = Array.isArray(r) ? r : r.items;
      arr.unreadable = Array.isArray(r) ? [] : r.unreadable || [];
      return arr;
    }
    return Object.values(ls.all(kind))
      .map(({ content, sheets, ...m }) => m)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  async get(kind, id) {
    if (hasApi) return window.api.get(kind, id);
    return ls.all(kind)[id] || null;
  },
  async put(kind, obj) {
    if (hasApi) {
      try { return await window.api.put(kind, obj); }
      catch (e) { toast(tx("Ошибка сохранения: ") + e.message, 'err'); throw e; }
    }
    const all = ls.all(kind);
    obj.updatedAt = Date.now();
    all[obj.id] = obj;
    ls.save(kind, all);
    listeners.forEach((cb) => cb({ kind, id: obj.id }));
    return obj;
  },
  /** Синхронная запись — для закрытия окна, когда асинхронный IPC может не успеть. */
  putSync(kind, obj) {
    if (hasApi) return window.api.putSync(kind, obj);
    const all = ls.all(kind);
    obj.updatedAt = Date.now();
    all[obj.id] = obj;
    ls.save(kind, all);
    return obj;
  },
  async remove(kind, id) {
    if (hasApi) {
      try { return await window.api.remove(kind, id); }
      catch (e) { toast(tx('Не удалось удалить: ') + e.message, 'err'); throw e; }
    }
    const all = ls.all(kind);
    delete all[id];
    ls.save(kind, all);
    listeners.forEach((cb) => cb({ kind, id, deleted: true }));
  },
  onChanged(cb) {
    if (hasApi) return window.api.onStoreChanged(cb);
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export const settings = {
  get(key, def) { const v = localStorage.getItem('poeatlasdocs:set:' + key); return v == null ? def : JSON.parse(v); },
  set(key, val) { localStorage.setItem('poeatlasdocs:set:' + key, JSON.stringify(val)); },
};

// Простые тосты
let toastFn = null;
export const setToaster = (fn) => { toastFn = fn; };
export const toast = (msg, kind = 'ok') => toastFn && toastFn(msg, kind);

// Сохранение файлов: Electron-диалог или скачивание в браузере
export async function saveFile({ defaultName, filters, data, encoding }) {
  if (hasApi) return window.api.saveFile({ defaultName, filters, data, encoding });
  const blob = encoding === 'base64'
    ? new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))])
    : new Blob([data], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  return defaultName;
}

export async function openFile({ filters, accept }) {
  if (hasApi) return window.api.openFile({ filters });
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept || '';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return resolve(null);
      const buf = new Uint8Array(await f.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      resolve({ name: f.name, base64: btoa(s) });
    };
    input.click();
  });
}

export const isElectron = hasApi;
