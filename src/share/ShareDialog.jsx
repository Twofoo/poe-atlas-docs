import { useEffect, useState } from 'react';
import { backdrop } from '../ui.js';
import { store, copyText, toast } from '../store.js';
import { makeShareLinks, shortenerUrl } from './shareApi.js';
import { tx } from '../i18n.js';

/** Совместная ссылка: любые документы + любые деревья из библиотеки. */
export default function ShareDialog({ initialDocIds = [], initialTreeIds = [], onClose, profileId }) {
  const [docs, setDocs] = useState([]);
  const [trees, setTrees] = useState([]);
  const [selDocs, setSelDocs] = useState(new Set(initialDocIds));
  const [selTrees, setSelTrees] = useState(new Set(initialTreeIds));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const mine = (l) => l.filter((x) => x.profileId === profileId);
    store.list('docs').then((l) => setDocs(mine(l)));
    store.list('trees').then((l) => setTrees(mine(l)));
  }, [profileId]);

  const toggle = (set, setter, id) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    setter(n);
    setResult(null);
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await makeShareLinks({ docIds: [...selDocs], treeIds: [...selTrees] });
      setResult(r);
      const best = r.short || r.full;
      if (await copyText(best)) toast(r.short ? tx("Короткая ссылка скопирована") : tx("Ссылка скопирована"));
    } catch (e) {
      toast(tx("Не удалось создать ссылку: ") + e.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const count = selDocs.size + selTrees.size;
  const copy = async (s) => { if (await copyText(s)) toast(tx("Скопировано")); };

  return (
    <div className="modal-back" {...backdrop(onClose)}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{tx("Совместная ссылка")}</h3>
        <p className="muted small">{tx("Отметьте документы и деревья атласа — получатель увидит всё сразу и сможет сохранить себе.")}</p>
        <div className="share-cols">
          <div>
            <h4>{tx("Документы и таблицы")}</h4>
            <div className="share-list">
              {docs.length === 0 && <div className="muted small">{tx("Нет документов")}</div>}
              {docs.map((d) => (
                <label key={d.id} className="check">
                  <input type="checkbox" checked={selDocs.has(d.id)} onChange={() => toggle(selDocs, setSelDocs, d.id)} />
                  {d.type === 'sheet' ? '▦' : '📝'} {d.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <h4>{tx("Деревья атласа")}</h4>
            <div className="share-list">
              {trees.length === 0 && <div className="muted small">{tx("Нет деревьев")}</div>}
              {trees.map((t) => (
                <label key={t.id} className="check">
                  <input type="checkbox" checked={selTrees.has(t.id)} onChange={() => toggle(selTrees, setSelTrees, t.id)} />
                  🗺 {t.name} <span className="muted small">· {(t.nodes?.length || 1) - 1} {tx("очк.")}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {result && (
          <div className="share-result">
            {result.short && (
              <>
                <div className="share-label">{tx("Короткая ссылка")}</div>
                <div className="link-row"><div className="link-preview">{result.short}</div><button className="btn" onClick={() => copy(result.short)}>{tx("Копировать")}</button></div>
              </>
            )}
            {!result.short && (
              <div className="muted small">
                {result.shortError
                  ? <span className="warn">{tx("Сокращение не удалось:")} {result.shortError}</span>
                  : shortenerUrl() ? null : tx("Сервер коротких ссылок не настроен (⚙ Настройки) — ниже полная ссылка, она работает и без сервера.")}
              </div>
            )}
            <div className="share-label">{tx("Полная ссылка (")}{result.full.length} {tx("симв., без сервера)")}</div>
            <div className="link-row"><div className="link-preview clamp">{result.full}</div><button className="btn" onClick={() => copy(result.full)}>{tx("Копировать")}</button></div>
          </div>
        )}

        <div className="row end">
          <button className="btn" onClick={onClose}>{tx("Закрыть")}</button>
          <button className="btn primary" disabled={!count || busy} onClick={create}>
            {busy ? tx("Создаём…") : tx("Создать ссылку ({0})", [count])}
          </button>
        </div>
      </div>
    </div>
  );
}
