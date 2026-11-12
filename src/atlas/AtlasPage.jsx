import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backdrop } from '../ui.js';
import AtlasCanvas from './AtlasCanvas.jsx';
import { loadSprites } from './sprites.js';
import { tree, shareLink, parseLink } from './atlasModel.js';
import { normalizeAllocation, summarizeStats } from './tree.js';
import { store, uid, copyText, toast, isElectron } from '../store.js';
import { touchProfile } from '../profiles/profiles.js';
import { tx, locale } from '../i18n.js';

const newTree = (profileId, name = tx("Новое дерево")) => ({ id: uid(), profileId, name, nodes: [tree.startId], choices: {}, notes: '', createdAt: Date.now() });

export default function AtlasPage({ openRequest, standalone, initialTreeId, onOpenLink, onShare, profileId, lastTreeId, onCurrentChange }) {
  const listMine = useCallback(async () => (await store.list('trees')).filter((t) => t.profileId === profileId), [profileId]);
  const [sprites, setSprites] = useState(null);
  const [library, setLibrary] = useState([]);
  const [current, setCurrent] = useState(null); // объект дерева
  const [search, setSearch] = useState('');
  const [sideTab, setSideTab] = useState('trees');
  const [choiceFor, setChoiceFor] = useState(null); // nodeId для выбора варианта
  const [shareOpts, setShareOpts] = useState({ withName: false, robust: false });
  const saveTimer = useRef(0);

  useEffect(() => { loadSprites(tree.raw).then(setSprites); }, []);

  const refresh = useCallback(() => listMine().then(setLibrary), [listMine]);
  useEffect(() => {
    refresh();
    return store.onChanged((p) => {
      if (p.kind !== 'trees') return;
      refresh();
      // синхронизация между окнами: перечитать открытое дерево, если изменено в другом окне
      setCurrent((cur) => {
        if (cur && cur.id === p.id && !cur.temp) {
          if (p.deleted) return null;
          store.get('trees', p.id).then((t) => t && setCurrent((c2) => (c2 && c2.id === t.id && t.updatedAt > (c2.updatedAt || 0) ? t : c2)));
        }
        return cur;
      });
    });
  }, [refresh]);

  // открытие дерева при старте
  useEffect(() => {
    // если за время загрузки уже открыли дерево (например, по ссылке) — не перезаписываем его
    const setIfEmpty = (t) => setCurrent((c) => c || t);
    (async () => {
      for (const id of [initialTreeId, lastTreeId]) {
        if (!id) continue;
        const t = await store.get('trees', id);
        if (t && t.profileId === profileId) return setIfEmpty(t);
      }
      const list = await listMine();
      if (list.length) setIfEmpty(await store.get('trees', list[0].id));
      else {
        const t = newTree(profileId, tx("Моё дерево атласа"));
        await store.put('trees', t);
        setIfEmpty(t);
      }
    })();
  }, [initialTreeId, profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onCurrentChange?.(current); }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  // запомнить последнее открытое дерево профиля
  useEffect(() => {
    if (current && !current.temp && profileId) touchProfile(profileId, { lastTreeId: current.id });
  }, [current?.id, profileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // открытие по ссылке (из App)
  useEffect(() => {
    if (!openRequest) return;
    openFromLink(openRequest.link, openRequest.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  function openFromLink(link, nameOverride) {
    try {
      const parsed = parseLink(link);
      const nodes = [...normalizeAllocation(tree, parsed.nodeIds)];
      const t = {
        id: uid(),
        name: parsed.name || nameOverride || tx("Дерево по ссылке"),
        nodes,
        choices: parsed.choices || {},
        notes: '',
        temp: true,
        sourceLink: link,
        createdAt: Date.now(),
      };
      setCurrent(t);
      const lost = parsed.nodeIds.length - (nodes.length - 1);
      if (parsed.versionMismatch) toast(tx("Ссылка создана для другой версии дерева — проверьте узлы"), 'warn');
      else if (lost > 0) toast(tx("Открыто. {0} узл. не найдено в текущей версии дерева", [lost]), 'warn');
      else toast(tx("Дерево открыто по ссылке (только просмотр, можно сохранить к себе)"));
    } catch (e) {
      toast(tx("Не удалось открыть ссылку: ") + e.message, 'err');
    }
  }

  const allocated = useMemo(() => new Set(current?.nodes || [tree.startId]), [current]);
  const used = allocated.size - 1;
  const total = tree.totalPoints;

  const update = (patch) => {
    setCurrent((cur) => {
      const next = { ...cur, ...patch };
      if (!next.temp) {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => store.put('trees', next), 300);
      }
      return next;
    });
  };

  const onAllocate = (path, target) => {
    if (current.temp) return toast(tx("Это дерево по ссылке. Нажмите «Сохранить к себе», чтобы редактировать"), 'warn');
    if (used + path.length > total) toast(tx("Превышен лимит очков ({0}/{1})", [used + path.length, total]), 'warn');
    const choices = { ...current.choices };
    let ask = null;
    for (const id of path) {
      const n = tree.nodes.get(id);
      if (n.variants && choices[id] == null) { choices[id] = n.variants[0].effect; if (!ask) ask = id; }
    }
    update({ nodes: [...current.nodes, ...path], choices });
    if (ask) setChoiceFor(ask);
    void target;
  };
  const onRemove = (ids) => {
    if (current.temp) return toast(tx("Это дерево по ссылке. Нажмите «Сохранить к себе», чтобы редактировать"), 'warn');
    const rm = new Set(ids);
    const choices = { ...current.choices };
    ids.forEach((id) => delete choices[id]);
    update({ nodes: current.nodes.filter((id) => !rm.has(id)), choices });
  };
  const onContext = (n) => {
    if (n.variants && allocated.has(n.id) && !current.temp) setChoiceFor(n.id);
  };

  const searchHits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return null;
    const s = new Set();
    for (const n of tree.nodes.values()) {
      if (n.type === 'mastery') continue;
      const hay = (n.name + ' ' + n.stats.join(' ') + ' ' + (n.variants || []).map((v) => v.stats.join(' ')).join(' ')).toLowerCase();
      if (hay.includes(q)) s.add(n.id);
    }
    return s;
  }, [search]);

  const stats = useMemo(() => (current ? summarizeStats(tree, allocated, current.choices) : []), [allocated, current]);
  const pickedNotables = useMemo(
    () => [...allocated].map((id) => tree.nodes.get(id)).filter((n) => n && (n.type === 'notable' || n.type === 'keystone')),
    [allocated],
  );

  // ---------- действия ----------
  const createTree = async () => { const t = newTree(profileId); await store.put('trees', t); setCurrent(t); };
  const openTree = async (id) => { const t = await store.get('trees', id); if (t) setCurrent(t); };
  const duplicate = async () => {
    const t = { ...current, id: uid(), profileId, name: current.name + tx(" (копия)"), temp: undefined, createdAt: Date.now() };
    await store.put('trees', t); setCurrent(t); toast(tx("Копия сохранена"));
  };
  const saveTemp = async () => {
    const { temp, sourceLink, ...rest } = current;
    const t = { ...rest, profileId };
    await store.put('trees', t); setCurrent(t); toast(tx("Дерево сохранено в вашу библиотеку"));
  };
  const removeTree = async (id) => {
    if (!confirm(tx("Удалить дерево? Это действие нельзя отменить."))) return;
    await store.remove('trees', id);
    if (current?.id === id) { const list = await listMine(); setCurrent(list[0] ? await store.get('trees', list[0].id) : newTree(profileId)); }
  };
  const reset = () => { if (confirm(tx("Сбросить все очки этого дерева?"))) update({ nodes: [tree.startId], choices: {} }); };
  const copyShare = async () => {
    const link = shareLink(current, shareOpts);
    if (await copyText(link)) toast(tx("Ссылка скопирована: ") + (link.length > 70 ? link.slice(0, 70) + '…' : link));
  };

  if (!current) return <div className="loading">{tx("Загрузка дерева…")}</div>;
  const choiceNode = choiceFor ? tree.nodes.get(choiceFor) : null;

  return (
    <div className="atlas-page">
      <aside className="atlas-side">
        <div className="side-tabs">
          <button className={sideTab === 'trees' ? 'on' : ''} onClick={() => setSideTab('trees')}>{tx("Деревья")}</button>
          <button className={sideTab === 'stats' ? 'on' : ''} onClick={() => setSideTab('stats')}>{tx("Сводка")}</button>
        </div>

        {sideTab === 'trees' && (
          <div className="side-body">
            <button className="btn primary wide" onClick={createTree}>{tx("＋ Новое дерево")}</button>
            <div className="tree-list">
              {library.map((t) => (
                <div key={t.id} className={'tree-item' + (t.id === current.id ? ' on' : '')} onClick={() => openTree(t.id)}>
                  <div className="tree-item-name">{t.name}</div>
                  <div className="tree-item-meta">{(t.nodes?.length || 1) - 1} {tx("очк. ·")} {new Date(t.updatedAt).toLocaleDateString(locale())}</div>
                  <button className="icon-btn" title={tx("Удалить")} onClick={(e) => { e.stopPropagation(); removeTree(t.id); }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {sideTab === 'stats' && (
          <div className="side-body">
            <h4>{tx("Ключевые и значимые (")}{pickedNotables.length})</h4>
            <div className="notable-list">
              {pickedNotables.map((n) => <span key={n.id} className={'chip chip-' + n.type}>{n.name}</span>)}
            </div>
            <h4>{tx("Все бонусы")}</h4>
            <div className="stat-list">
              {stats.length === 0 && <div className="muted">{tx("Пока ничего не выбрано")}</div>}
              {stats.map((s, i) => <div key={i} className={'stat-line stat-' + s.type}>{s.text}</div>)}
            </div>
            <h4>{tx("Заметки")}</h4>
            <textarea className="notes" value={current.notes || ''} placeholder={tx("Стратегия фарма, порядок взятия, предметы…")} onChange={(e) => update({ notes: e.target.value })} disabled={current.temp} />
          </div>
        )}

      </aside>

      <section className="atlas-main">
        <div className="atlas-toolbar">
          <input className="tree-name" value={current.name} onChange={(e) => update({ name: e.target.value })} disabled={current.temp} />
          <div className={'points' + (used > total ? ' over' : '')} title={tx("Использовано очков атласа")}>
            <b>{used}</b> / {total}
          </div>
          <input className="search" placeholder={tx("Поиск узлов (напр. Expedition, Delirium)…")} value={search} onChange={(e) => setSearch(e.target.value)} />
          {searchHits && <span className="muted small">{searchHits.size} {tx("найдено")}</span>}
          <div className="spacer" />
          {current.temp ? (
            <button className="btn primary" onClick={saveTemp}>{tx("Сохранить к себе")}</button>
          ) : (
            <>
              {standalone && <button className="btn" onClick={copyShare} title={tx("Скопировать ссылку на дерево")}>{tx("🔗 Ссылка")}</button>}
              <button className="btn" onClick={duplicate}>{tx("Копия")}</button>
              <button className="btn" onClick={reset}>{tx("Сброс")}</button>
            </>
          )}
          {!standalone && isElectron && !current.temp && (
            <button className="btn" onClick={() => window.api.openAtlasWindow(current.id, profileId)} title={tx("Открыть дерево в отдельном окне")}>{tx("⧉ Окно")}</button>
          )}
        </div>
        {current.temp && <div className="temp-banner">{tx("Просмотр дерева по ссылке")}{current.name ? `: «${current.name}»` : ''}{tx(". Изменения недоступны, пока вы не сохраните его к себе.")}</div>}
        <AtlasCanvas
          tree={tree}
          sprites={sprites}
          allocated={allocated}
          choices={current.choices}
          onAllocate={onAllocate}
          onRemove={onRemove}
          onContext={onContext}
          searchHits={searchHits}
          readOnly={!!current.temp}
          pointsLeft={total - used}
        />
        <div className="atlas-help">{tx("ЛКМ — взять путь / снять узел · ПКМ — выбрать вариант · колесо — масштаб · перетаскивание — сдвиг")}</div>
      </section>

      {choiceNode && (
        <div className="modal-back" {...backdrop(() => setChoiceFor(null))}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{choiceNode.name}</h3>
            <p className="muted">{choiceNode.stats.join(' ') || tx("Выберите вариант:")}</p>
            {choiceNode.variants.map((v) => (
              <button
                key={v.effect}
                className={'variant-btn' + (String(current.choices[choiceNode.id]) === String(v.effect) ? ' on' : '')}
                onClick={() => { update({ choices: { ...current.choices, [choiceNode.id]: v.effect } }); setChoiceFor(null); }}
              >
                {v.stats.join(' ')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
