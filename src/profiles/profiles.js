// Профили: у каждого свои деревья атласа и документы (поле profileId у объектов).
// Папки профилей — записи { isFolder: true, name, folder } где folder — путь родителя ('' = корень).
import { store, uid } from '../store.js';
import { tx } from '../i18n.js';

export const joinPath = (folder, name) => (folder ? folder + '/' + name : name);

/**
 * Гарантирует, что есть хотя бы один профиль, и что ни одно дерево/документ не «потерялось»:
 *  - данные старых версий (без profileId) и «сироты» (их профиль исчез) переносятся в существующий профиль;
 *  - профиль по умолчанию создаётся ТОЛЬКО если файлов профилей действительно нет
 *    (если какой-то файл не прочитался — ничего не создаём, а повторяем попытку).
 */
export async function ensureProfiles() {
  let list = await store.list('profiles');
  for (let i = 0; i < 3 && list.unreadable?.length; i++) {
    await new Promise((r) => setTimeout(r, 300));
    list = await store.list('profiles');
  }
  let profiles = list.filter((p) => !p.isFolder);
  if (!profiles.length && list.unreadable?.length) {
    throw new Error(tx('Не удалось прочитать файлы профилей — попробуйте перезапустить программу'));
  }

  const [docs, trees] = [await store.list('docs'), await store.list('trees')];
  const known = new Set(profiles.map((p) => p.id));
  const orphans = [...docs.map((m) => ['docs', m]), ...trees.map((m) => ['trees', m])].filter(([, m]) => !known.has(m.profileId));

  if (!profiles.length) {
    // если у сирот был один общий профиль — восстанавливаем его с тем же id, иначе создаём «Основной»
    const ids = [...new Set(orphans.map(([, m]) => m.profileId).filter(Boolean))];
    const p = { id: ids.length === 1 ? ids[0] : uid(), name: tx('Основной'), subtitle: '', folder: '', createdAt: Date.now(), lastOpenedAt: 0 };
    await store.put('profiles', p);
    profiles = [p];
    known.add(p.id);
  }

  const target = [...profiles].sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))[0];
  for (const [kind, meta] of orphans) {
    if (known.has(meta.profileId)) continue;
    const full = await store.get(kind, meta.id);
    if (full) await store.put(kind, { ...full, profileId: target.id });
  }
  return store.list('profiles');
}

export async function countsByProfile() {
  const out = {};
  for (const kind of ['docs', 'trees']) {
    for (const m of await store.list(kind)) {
      const c = (out[m.profileId] ||= { docs: 0, trees: 0 });
      c[kind]++;
    }
  }
  return out;
}

/** Обновляет поля профиля, сливая с актуальной версией на диске. */
export async function touchProfile(id, patch) {
  if (!id) return;
  const p = await store.get('profiles', id);
  if (!p) return;
  if (Object.entries(patch).every(([k, v]) => p[k] === v)) return p;
  return store.put('profiles', { ...p, ...patch });
}

export async function createProfile({ name, subtitle = '', folder = '' }) {
  const p = { id: uid(), name, subtitle, folder, createdAt: Date.now(), lastOpenedAt: 0 };
  await store.put('profiles', p);
  return p;
}

export async function createFolder(name, folder) {
  const f = { id: uid(), isFolder: true, name, folder, createdAt: Date.now() };
  await store.put('profiles', f);
  return f;
}

/** Переименование папки: обновляет пути всех вложенных профилей и папок. */
export async function renameFolder(folderObj, newName) {
  const oldPath = joinPath(folderObj.folder, folderObj.name);
  const newPath = joinPath(folderObj.folder, newName);
  for (const p of await store.list('profiles')) {
    if (p.id === folderObj.id) continue;
    if (p.folder === oldPath || p.folder.startsWith(oldPath + '/')) {
      await store.put('profiles', { ...p, folder: newPath + p.folder.slice(oldPath.length) });
    }
  }
  await store.put('profiles', { ...folderObj, name: newName });
}

export async function copyProfile(p) {
  const copy = await createProfile({ name: p.name + tx(" (копия)"), subtitle: p.subtitle, folder: p.folder });
  const idMap = {};
  for (const kind of ['trees', 'docs']) {
    for (const m of await store.list(kind)) {
      if (m.profileId !== p.id) continue;
      const full = await store.get(kind, m.id);
      const nid = uid();
      idMap[m.id] = nid;
      await store.put(kind, { ...full, id: nid, profileId: copy.id, createdAt: Date.now() });
    }
  }
  await touchProfile(copy.id, { lastTab: p.lastTab, lastTreeId: idMap[p.lastTreeId], lastDocId: idMap[p.lastDocId] });
  return copy;
}

/**
 * Удаление профиля. Порядок важен: сначала сам профиль, потом его содержимое (в корзину).
 * Если удаление прервётся посередине, оставшиеся деревья/документы станут «сиротами»
 * и при следующем запуске вернутся в существующий профиль, а не пропадут внутри «мёртвого» профиля.
 */
export async function deleteProfile(p) {
  await store.remove('profiles', p.id);
  let busy = 0;
  for (const kind of ['trees', 'docs']) {
    const items = await store.list(kind);
    busy += items.unreadable?.length || 0;
    for (const m of items) if (m.profileId === p.id) await store.remove(kind, m.id);
  }
  if (busy) throw new Error(tx('часть файлов была занята другой программой — они не потеряны и вернутся в существующий профиль при следующем запуске'));
}

export function folderIsEmpty(all, folderObj) {
  const path = joinPath(folderObj.folder, folderObj.name);
  return !all.some((p) => p.id !== folderObj.id && (p.folder === path || p.folder.startsWith(path + '/')));
}

export function allFolderPaths(all) {
  return ['', ...all.filter((p) => p.isFolder).map((f) => joinPath(f.folder, f.name))].sort();
}
