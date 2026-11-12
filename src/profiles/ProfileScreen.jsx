import { useEffect, useMemo, useRef, useState } from 'react';
import { backdrop } from '../ui.js';
import { store, toast } from '../store.js';
import ImportLinkDialog, { looksLikeLink } from './ImportLinkDialog.jsx';
import { tx, locale } from '../i18n.js';
import LangSwitch from '../LangSwitch.jsx';
import {
  ensureProfiles, countsByProfile, createProfile, createFolder, renameFolder, copyProfile, deleteProfile,
  touchProfile, joinPath, folderIsEmpty, allFolderPaths,
} from './profiles.js';

const SORTS = { name: "По имени", recent: "По последнему открытию", created: "По дате создания" };
const fmtDate = (t) => (t ? new Date(t).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) : tx("не открывался"));

function EditDialog({ title, initial, folders, withSubtitle, withFolder, onSave, onClose }) {
  const [name, setName] = useState(initial.name || '');
  const [subtitle, setSubtitle] = useState(initial.subtitle || '');
  const [folder, setFolder] = useState(initial.folder || '');
  const submit = (e) => { e.preventDefault(); if (name.trim()) onSave({ name: name.trim(), subtitle: subtitle.trim(), folder }); };
  return (
    <div className="modal-back" {...backdrop(onClose)}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        <label className="field"><span>{tx("Название")}</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={tx("Например: Settlers SSF — Expedition")} />
        </label>
        {withSubtitle && (
          <label className="field"><span>{tx("Подпись (лига, билд, заметка)")}</span>
            <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder={tx("Например: Лига Settlers · Elementalist")} />
          </label>
        )}
        {withFolder && (
          <label className="field"><span>{tx("Папка")}</span>
            <select className="tb-select" value={folder} onChange={(e) => setFolder(e.target.value)}>
              {folders.map((f) => <option key={f} value={f}>{f || tx("— корень —")}</option>)}
            </select>
          </label>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>{tx("Отмена")}</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>{tx("Сохранить")}</button>
        </div>
      </form>
    </div>
  );
}

/** Стартовый экран выбора профиля (в духе списка сборок Path of Building). */
export default function ProfileScreen({ onOpen, lastProfileId }) {
  const [all, setAll] = useState(null);
  const [counts, setCounts] = useState({});
  const [path, setPath] = useState('');
  const [selected, setSelected] = useState(lastProfileId || null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(() => localStorage.getItem('poeatlasdocs:profileSort') || 'recent');
  const [dialog, setDialog] = useState(null);
  const [importLink, setImportLink] = useState(null); // null — закрыто, строка — открыт с этой ссылкой
  const listRef = useRef(null);

  const reload = async () => {
    const list = await store.list('profiles');
    setAll(list);
    setCounts(await countsByProfile());
    return list;
  };

  useEffect(() => {
    ensureProfiles().catch((e) => { toast(e.message, 'err'); return store.list('profiles'); }).then(async (list) => {
      await reload();
      // выделить последний открытый профиль и показать его папку
      const profiles = list.filter((p) => !p.isFolder);
      const last = profiles.find((p) => p.id === lastProfileId) || [...profiles].sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))[0];
      if (last) { setSelected(last.id); setPath(last.folder || ''); }
    });
    return store.onChanged((p) => { if (p.kind === 'profiles') reload(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { localStorage.setItem('poeatlasdocs:profileSort', sort); }, [sort]);

  const rows = useMemo(() => {
    if (!all) return [];
    const q = search.trim().toLowerCase();
    const cmp = {
      name: (a, b) => a.name.localeCompare(b.name, 'ru'),
      recent: (a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0) || a.name.localeCompare(b.name, 'ru'),
      created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    }[sort];
    if (q) {
      return all.filter((p) => !p.isFolder && (p.name + ' ' + (p.subtitle || '') + ' ' + p.folder).toLowerCase().includes(q)).sort(cmp);
    }
    const here = all.filter((p) => (p.folder || '') === path);
    const folders = here.filter((p) => p.isFolder).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return [...folders, ...here.filter((p) => !p.isFolder).sort(cmp)];
  }, [all, path, search, sort]);

  const sel = rows.find((r) => r.id === selected) || null;
  const folders = useMemo(() => (all ? allFolderPaths(all) : ['']), [all]);

  const open = async (row) => {
    if (!row) return;
    if (row.isFolder) { setPath(joinPath(row.folder, row.name)); setSelected(null); setSearch(''); return; }
    const p = await touchProfile(row.id, { lastOpenedAt: Date.now() });
    onOpen(p || row);
  };

  const doNew = () => setDialog({
    title: tx("Новый профиль"), initial: { folder: path }, withSubtitle: true, withFolder: true,
    onSave: async (v) => { const p = await createProfile(v); setDialog(null); await reload(); setPath(v.folder); setSelected(p.id); },
  });
  const doNewFolder = () => setDialog({
    title: tx("Новая папка"), initial: {}, onSave: async (v) => {
      if (all.some((p) => p.isFolder && p.folder === path && p.name === v.name)) return toast(tx("Такая папка уже есть"), 'warn');
      if (v.name.includes('/')) return toast(tx("Имя папки не может содержать «/»"), 'warn');
      await createFolder(v.name, path); setDialog(null); reload();
    },
  });
  const doRename = () => {
    if (!sel) return;
    if (sel.isFolder) {
      setDialog({ title: tx("Переименовать папку"), initial: sel, onSave: async (v) => { await renameFolder(sel, v.name.replace(/\//g, '-')); setDialog(null); reload(); } });
    } else {
      setDialog({
        title: tx("Изменить профиль"), initial: sel, withSubtitle: true, withFolder: true,
        onSave: async (v) => { await touchProfile(sel.id, v); setDialog(null); await reload(); setPath(v.folder); },
      });
    }
  };
  const doCopy = async () => {
    if (!sel || sel.isFolder) return;
    const p = await copyProfile(sel);
    await reload(); setSelected(p.id);
    toast(tx("Профиль скопирован вместе с деревьями и документами"));
  };
  const doDelete = async () => {
    if (!sel) return;
    if (sel.isFolder) {
      if (!folderIsEmpty(all, sel)) return toast(tx("Папка не пуста — сначала перенесите или удалите профили в ней"), 'warn');
      await store.remove('profiles', sel.id);
      return reload();
    }
    const c = counts[sel.id] || { trees: 0, docs: 0 };
    if (!confirm(tx("Удалить профиль «{0}»?\nВместе с ним будут удалены деревья ({1}) и документы ({2}). Это нельзя отменить.", [sel.name, c.trees, c.docs]))) return;
    try {
      await deleteProfile(sel);
    } catch (e) {
      toast(tx('Не удалось удалить профиль: ') + e.message, 'err');
    }
    setSelected(null);
    reload();
  };

  const onKey = (e) => {
    if (dialog || importLink !== null || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const i = rows.findIndex((r) => r.id === selected);
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(rows[Math.min(rows.length - 1, i + 1)]?.id); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(rows[Math.max(0, i - 1)]?.id); }
    else if (e.key === 'Enter') open(sel);
    else if (e.key === 'F2') doRename();
    else if (e.key === 'Delete') doDelete();
    else if (e.key === 'Backspace' && path) setPath(path.split('/').slice(0, -1).join('/'));
  };
  // Ctrl+V в любом месте экрана (не в поле ввода) — сразу импорт вставленной ссылки
  const onPaste = (e) => {
    if (dialog || importLink !== null || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const text = e.clipboardData?.getData('text') || '';
    if (looksLikeLink(text)) { e.preventDefault(); setImportLink(text.trim()); }
  };
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  });
  useEffect(() => { listRef.current?.querySelector('.prof-row.on')?.scrollIntoView({ block: 'nearest' }); }, [selected]);

  const crumbs = path ? path.split('/') : [];

  return (
    <div className="profile-screen">
      <div className="prof-lang"><LangSwitch /></div>
      <div className="prof-brand"><img className="logo-img" src="./icon.png" alt="" /> {tx("PoE Atlas Docs — выберите профиль")}</div>
      <div className="prof-panel">
        <div className="prof-actions">
          <button className="btn import-btn" onClick={() => setImportLink('')} title={tx("Вставить ссылку на дерево/документы — сразу сохранить и открыть (или Ctrl+V)")}>{tx("⇣ Импорт по ссылке")}</button>
          <button className="btn" onClick={doNew}>{tx("Новый")}</button>
          <button className="btn" onClick={doNewFolder}>{tx("Новая папка")}</button>
          <button className="btn primary" onClick={() => open(sel)} disabled={!sel}>{tx("Открыть")}</button>
          <button className="btn" onClick={doCopy} disabled={!sel || sel.isFolder}>{tx("Копировать")}</button>
          <button className="btn" onClick={doRename} disabled={!sel}>{tx("Изменить")}</button>
          <button className="btn danger" onClick={doDelete} disabled={!sel}>{tx("Удалить")}</button>
          <select className="tb-select" value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{tx(v)}</option>)}
          </select>
        </div>
        <label className="prof-search">
          <span>{tx("Поиск:")}</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx("название, лига, билд…")} />
        </label>
        <div className="prof-crumbs">
          <button className="crumb" onClick={() => { setPath(''); setSearch(''); }}>{tx("Профили")}</button>
          {crumbs.map((c, i) => (
            <span key={i}>
              <span className="crumb-sep">▸</span>
              <button className="crumb" onClick={() => { setPath(crumbs.slice(0, i + 1).join('/')); setSearch(''); }}>{c}</button>
            </span>
          ))}
          {search && <span className="muted small"> {tx("· результаты поиска по всем папкам")}</span>}
        </div>
        <div className="prof-list" ref={listRef}>
          {!all && <div className="muted pad">{tx("Загрузка…")}</div>}
          {all && rows.length === 0 && <div className="muted pad">{search ? tx("Ничего не найдено") : tx("Папка пуста. Нажмите «Новый», чтобы создать профиль.")}</div>}
          {rows.map((r) => {
            const c = counts[r.id] || { trees: 0, docs: 0 };
            return (
              <div
                key={r.id}
                className={'prof-row' + (r.id === selected ? ' on' : '') + (r.isFolder ? ' folder' : '')}
                onClick={() => setSelected(r.id)}
                onDoubleClick={() => open(r)}
              >
                <div className="prof-name">{r.isFolder ? '📁 ' : ''}{r.name}</div>
                {!r.isFolder && (
                  <div className="prof-meta">
                    {r.subtitle && <span className="prof-sub">{r.subtitle}</span>}
                    {search && r.folder && <span className="muted">📁 {r.folder}</span>}
                    <span className="muted">🗺 {c.trees} · 📄 {c.docs}</span>
                    <span className="muted prof-date">{fmtDate(r.lastOpenedAt)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="prof-hint muted small">{tx("Двойной клик или Enter — открыть · Ctrl+V — импорт по ссылке · F2 — изменить · Delete — удалить · Backspace — на папку выше")}</div>
      </div>
      {dialog && <EditDialog {...dialog} folders={folders} onClose={() => setDialog(null)} />}
      {importLink !== null && (
        <ImportLinkDialog
          initialLink={importLink}
          profiles={(all || []).filter((p) => !p.isFolder)}
          selectedProfileId={sel && !sel.isFolder ? sel.id : null}
          folder={path}
          onClose={() => setImportLink(null)}
          onOpen={(p) => { setImportLink(null); onOpen(p); }}
        />
      )}
    </div>
  );
}
