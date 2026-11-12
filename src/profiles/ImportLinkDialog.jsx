import { useEffect, useRef, useState } from 'react';
import { backdrop } from '../ui.js';
import { store, toast } from '../store.js';
import { resolveAnyLink, saveTreeFromBundle, saveDocFromBundle } from '../share/shareApi.js';
import { createProfile, touchProfile } from './profiles.js';
import { tx } from '../i18n.js';

export const looksLikeLink = (s) =>
  /^(poeatlas:\/\/|https?:\/\/)/i.test(String(s || '').trim()) && String(s).trim().length < 2_000_000;

/**
 * Импорт по ссылке прямо из главного меню: вставили ссылку -> видно содержимое ->
 * «Импортировать и открыть» сохраняет всё в новый или выбранный профиль и сразу открывает его.
 */
export default function ImportLinkDialog({ initialLink = '', profiles, selectedProfileId, folder, onClose, onOpen }) {
  const [link, setLink] = useState(initialLink);
  const [state, setState] = useState({ status: 'idle' }); // idle | loading | ready | error
  const [target, setTarget] = useState('new');
  const [newName, setNewName] = useState('');
  const [existingId, setExistingId] = useState(selectedProfileId || profiles[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const nameTouched = useRef(false);
  const seq = useRef(0);

  // если в буфере обмена уже лежит ссылка — подставляем её сразу
  useEffect(() => {
    if (initialLink) return;
    navigator.clipboard?.readText?.().then((t) => { if (looksLikeLink(t)) setLink((cur) => cur || t.trim()); }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = link.trim();
    if (!s) return setState({ status: 'idle' });
    const my = ++seq.current;
    setState({ status: 'loading' });
    const t = setTimeout(async () => {
      try {
        const bundle = await resolveAnyLink(s);
        if (my !== seq.current) return;
        if (!bundle.trees.length && !bundle.docs.length) throw new Error(tx("В ссылке ничего нет"));
        setState({ status: 'ready', bundle });
        if (!nameTouched.current) {
          const first = bundle.docs[0]?.name || bundle.trees[0]?.name || tx("Импорт");
          setNewName(bundle.from ? tx("{0} (от {1})", [first, bundle.from]) : first);
        }
      } catch (e) {
        if (my === seq.current) setState({ status: 'error', error: e.message });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [link]);

  const doImport = async () => {
    if (state.status !== 'ready') return;
    setBusy(true);
    try {
      const { bundle } = state;
      const profile = target === 'new'
        ? await createProfile({ name: newName.trim() || tx("Импорт"), subtitle: tx("Импорт по ссылке"), folder })
        : await store.get('profiles', existingId);
      if (!profile) throw new Error(tx("Профиль не найден"));
      const trees = [];
      for (const t of bundle.trees) trees.push(await saveTreeFromBundle(t, profile.id));
      const docs = [];
      for (const d of bundle.docs) docs.push(await saveDocFromBundle(d, profile.id));
      const opened = await touchProfile(profile.id, {
        lastOpenedAt: Date.now(),
        lastTab: docs.length && !trees.length ? 'docs' : 'atlas',
        ...(trees[0] ? { lastTreeId: trees[0].id } : {}),
        ...(docs[0] ? { lastDocId: docs[0].id } : {}),
      });
      toast(tx("Импортировано: деревьев {0}, документов {1}", [trees.length, docs.length]));
      onOpen(opened || profile);
    } catch (e) {
      toast(tx("Ошибка импорта: ") + e.message, 'err');
      setBusy(false);
    }
  };

  const b = state.bundle;
  return (
    <div className="modal-back" {...backdrop(onClose)}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{tx("Импорт по ссылке")}</h3>
        <p className="muted small">
          {tx("Вставьте ссылку: короткую")} <code>https://…workers.dev/…</code>{tx(", совместную")} <code>poeatlas://b/…</code>{tx(", на дерево")} <code>poeatlas://t/…</code> {tx("или с pathofexile.com.")}
        </p>
        <textarea
          className="link-input"
          autoFocus
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder={tx("Ctrl+V — вставить ссылку")}
        />

        <div className="import-preview">
          {state.status === 'idle' && <span className="muted small">{tx("Ждём ссылку…")}</span>}
          {state.status === 'loading' && <span className="muted small">{tx("Проверяем ссылку…")}</span>}
          {state.status === 'error' && <span className="warn small">{state.error}</span>}
          {state.status === 'ready' && (
            <>
              <div className="share-label">{tx("В ссылке")}{b.from ? tx(" (от {0})", [b.from]) : ''}:</div>
              {b.trees.map((t, i) => <div key={'t' + i} className="recv-item">🗺 {t.name}{t.points != null && <span className="muted small"> · {t.points} {tx("очк.")}</span>}</div>)}
              {b.docs.map((d, i) => <div key={'d' + i} className="recv-item">{d.type === 'sheet' ? '▦' : '📝'} {d.name}</div>)}
            </>
          )}
        </div>

        <div className="import-target">
          <label className="check">
            <input type="radio" checked={target === 'new'} onChange={() => setTarget('new')} /> {tx("В новый профиль")}
          </label>
          {target === 'new' && (
            <input className="search" value={newName} onChange={(e) => { nameTouched.current = true; setNewName(e.target.value); }} placeholder={tx("Название профиля")} />
          )}
          <label className="check">
            <input type="radio" checked={target === 'existing'} onChange={() => setTarget('existing')} disabled={!profiles.length} /> {tx("Добавить в существующий")}
          </label>
          {target === 'existing' && (
            <select className="tb-select" value={existingId} onChange={(e) => setExistingId(e.target.value)}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.folder ? p.folder + ' / ' : ''}{p.name}</option>)}
            </select>
          )}
        </div>

        <div className="row end">
          <button className="btn" onClick={onClose}>{tx("Отмена")}</button>
          <button className="btn primary" disabled={state.status !== 'ready' || busy || (target === 'new' && !newName.trim())} onClick={doImport}>
            {busy ? tx("Импортируем…") : tx("Импортировать и открыть")}
          </button>
        </div>
      </div>
    </div>
  );
}
