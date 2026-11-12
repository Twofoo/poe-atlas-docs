import { useCallback, useEffect, useRef, useState } from 'react';
import { store, uid, toast, saveFile, openFile, isElectron } from '../store.js';
import { touchProfile } from '../profiles/profiles.js';
import SheetEditor, { emptySheets, sheetsToXlsx, xlsxToSheets, csvToSheets } from './SheetEditor.jsx';
import TextEditor, { docToHtml } from './TextEditor.jsx';
import { tx, locale } from '../i18n.js';

const ICON = { sheet: '▦', text: '📝' };
const b64utf8 = (s) => btoa(unescape(encodeURIComponent(s)));

export default function DocsPage({ openRequest, onShare, profileId, lastDocId }) {
  const [list, setList] = useState([]);
  const [doc, setDoc] = useState(null);
  const [filter, setFilter] = useState('');
  const textApi = useRef(null);
  // Актуальная полная версия каждого открытого документа (id -> объект) и отложенные записи на диск.
  // Важно: изменения всегда сливаются с последней версией, а не с состоянием на момент открытия.
  const latest = useRef(new Map());
  const timers = useRef(new Map());
  const docRef = useRef(null);

  const writeNow = (id, sync = false) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    const obj = latest.current.get(id);
    if (!obj) return;
    return sync ? store.putSync('docs', obj) : store.put('docs', obj);
  };
  const flushAll = (sync = false) => { for (const id of [...timers.current.keys()]) writeNow(id, sync); };

  const save = (id, patch) => {
    const base = latest.current.get(id);
    if (!base) return;
    const next = { ...base, ...patch };
    latest.current.set(id, next);
    if (docRef.current?.id === id) docRef.current = next;
    if ('name' in patch) setDoc((d) => (d && d.id === id ? next : d));
    clearTimeout(timers.current.get(id));
    timers.current.set(id, setTimeout(() => writeNow(id), 300));
  };

  const show = (d) => {
    if (d) { latest.current.set(d.id, d); touchProfile(profileId, { lastDocId: d.id }); }
    docRef.current = d;
    setDoc(d);
  };

  const listMine = useCallback(async () => (await store.list('docs')).filter((d) => d.profileId === profileId), [profileId]);
  const refresh = useCallback(() => listMine().then(setList), [listMine]);
  useEffect(() => {
    refresh();
    return store.onChanged((p) => p.kind === 'docs' && refresh());
  }, [refresh]);

  useEffect(() => {
    if (!openRequest) (async () => {
      const last = lastDocId && (await store.get('docs', lastDocId));
      if (last && last.profileId === profileId) { if (!docRef.current) show(last); return; }
      const l = await listMine();
      if (l[0] && !docRef.current) show(await store.get('docs', l[0].id));
    })();
    // При закрытии окна/вкладки — синхронно дописать несохранённое
    const onUnload = () => { window.dispatchEvent(new Event('poe-flush-editors')); flushAll(true); };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); onUnload(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // «сохранить всё сейчас» — для кнопки «Скопировать Атлас + документы» в верхней панели
  useEffect(() => {
    window.__poeFlushDocs = () => leaveCurrent();
    return () => { if (window.__poeFlushDocs) delete window.__poeFlushDocs; };
  });

  // открыть документ по запросу извне (например, полученный по ссылке)
  useEffect(() => {
    if (openRequest?.id) open(openRequest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  const leaveCurrent = async () => {
    window.dispatchEvent(new Event('poe-flush-editors'));
    await Promise.all([...timers.current.keys()].map((id) => writeNow(id)));
  };

  const create = async (type, extra = {}) => {
    await leaveCurrent();
    const d = {
      id: uid(),
      profileId,
      type,
      name: type === 'sheet' ? tx("Новая таблица") : tx("Новый документ"),
      createdAt: Date.now(),
      ...(type === 'sheet' ? { sheets: emptySheets() } : { content: null }),
      ...extra,
    };
    await store.put('docs', d);
    show(d);
  };

  const open = async (id) => {
    if (docRef.current?.id === id) return;
    await leaveCurrent();
    show(await store.get('docs', id));
  };
  const remove = async (id) => {
    if (!confirm(tx("Удалить документ? Это действие нельзя отменить."))) return;
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    latest.current.delete(id);
    await store.remove('docs', id);
    if (docRef.current?.id === id) show(null);
  };

  const importFile = async () => {
    const f = await openFile({
      filters: [{ name: tx("Таблицы и документы"), extensions: ['xlsx', 'xls', 'csv', 'ods', 'txt', 'html', 'htm'] }],
      accept: '.xlsx,.xls,.csv,.ods,.txt,.html,.htm',
    });
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    const base = f.name.replace(/\.[^.]+$/, '');
    try {
      if (['xlsx', 'xls', 'ods'].includes(ext)) await create('sheet', { name: base, sheets: xlsxToSheets(f.base64) });
      else if (ext === 'csv') await create('sheet', { name: base, sheets: csvToSheets(decodeURIComponent(escape(atob(f.base64)))) });
      else {
        const text = decodeURIComponent(escape(atob(f.base64)));
        const html = ext === 'txt' ? text.split(/\r?\n/).map((l) => `<p>${l.replace(/</g, '&lt;')}</p>`).join('') : text.replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/gi, '');
        await create('text', { name: base, content: html });
      }
      toast(tx("Импортировано: ") + f.name);
    } catch (e) {
      toast(tx("Ошибка импорта: ") + e.message, 'err');
    }
  };

  const exportDoc = async (format) => {
    await leaveCurrent();
    const d = docRef.current;
    const name = (d.name || tx("документ")).replace(/[\\/:*?"<>|]/g, '_');
    if (d.type === 'sheet') {
      const r = await saveFile({ defaultName: name + '.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }], data: sheetsToXlsx(d.sheets), encoding: 'base64' });
      if (r) toast(tx("Сохранено: ") + r);
      return;
    }
    const html = docToHtml(textApi.current?.getHTML() || '', name);
    if (format === 'pdf') {
      if (!isElectron) return window.print();
      const r = await window.api.savePdf({ html, defaultName: name + '.pdf' });
      if (r) toast(tx("PDF сохранён: ") + r);
    } else if (format === 'doc') {
      const wordHtml = html.replace('<html>', '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">');
      const r = await saveFile({ defaultName: name + '.doc', filters: [{ name: 'Word', extensions: ['doc'] }], data: b64utf8('﻿' + wordHtml), encoding: 'base64' });
      if (r) toast(tx("Сохранено (открывается в Word): ") + r);
    } else {
      const r = await saveFile({ defaultName: name + '.html', filters: [{ name: 'HTML', extensions: ['html'] }], data: html });
      if (r) toast(tx("Сохранено: ") + r);
    }
  };

  const shown = list.filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="docs-page">
      <aside className="docs-side">
        <div className="docs-new">
          <button className="btn primary" onClick={() => create('text')}>{tx("📝 Документ")}</button>
          <button className="btn primary" onClick={() => create('sheet')}>{tx("▦ Таблица")}</button>
        </div>
        <button className="btn wide" onClick={importFile}>{tx("⇪ Импорт (xlsx, csv, txt, html)")}</button>
        <input className="search" placeholder={tx("Поиск…")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="tree-list">
          {shown.map((d) => (
            <div key={d.id} className={'tree-item' + (doc?.id === d.id ? ' on' : '')} onClick={() => open(d.id)}>
              <div className="tree-item-name">{ICON[d.type]} {d.name}</div>
              <div className="tree-item-meta">{d.type === 'sheet' ? tx("Таблица") : tx("Документ")} · {new Date(d.updatedAt).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })}</div>
              <button className="icon-btn" title={tx("Удалить")} onClick={(e) => { e.stopPropagation(); remove(d.id); }}>✕</button>
            </div>
          ))}
          {list.length === 0 && <div className="muted small pad">{tx("Создайте первый документ или таблицу — например, учёт дропа, расходов на карты или стратегию фарма.")}</div>}
        </div>
      </aside>
      <section className="docs-main">
        {!doc ? (
          <div className="empty">
            <h2>{tx("Документы и таблицы")}</h2>
            <p className="muted">{tx("Создавайте заметки в стиле Word и таблицы с формулами в стиле Excel. Всё сохраняется автоматически.")}</p>
            <div className="row">
              <button className="btn primary" onClick={() => create('text')}>{tx("📝 Новый документ")}</button>
              <button className="btn primary" onClick={() => create('sheet')}>{tx("▦ Новая таблица")}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="docs-header">
              <input className="tree-name" value={doc.name} onChange={(e) => save(doc.id, { name: e.target.value })} />
              <span className="muted small">{tx("Автосохранение")}</span>
              <div className="spacer" />
              <button className="btn primary" onClick={async () => { await leaveCurrent(); onShare?.({ docIds: [doc.id], treeIds: [] }); }} title={tx("Ссылка на документ (можно добавить деревья атласа)")}>{tx("🔗 Поделиться")}</button>
              {doc.type === 'sheet' ? (
                <button className="btn" onClick={() => exportDoc('xlsx')}>{tx("Экспорт .xlsx")}</button>
              ) : (
                <>
                  <button className="btn" onClick={() => exportDoc('doc')}>{tx("Экспорт Word")}</button>
                  <button className="btn" onClick={() => exportDoc('pdf')}>PDF</button>
                  <button className="btn" onClick={() => exportDoc('html')}>HTML</button>
                </>
              )}
            </div>
            {doc.type === 'sheet' ? (
              <SheetEditor key={doc.id} doc={doc} onChange={(sheets) => save(doc.id, { sheets })} />
            ) : (
              <TextEditor key={doc.id} doc={doc} apiRef={textApi} onChange={(content) => save(doc.id, { content })} />
            )}
          </>
        )}
      </section>
    </div>
  );
}
