import { useEffect, useState } from 'react';
import { backdrop } from '../ui.js';
import { store, toast } from '../store.js';
import { saveDocFromBundle, saveTreeFromBundle, treeLinkFromCode } from './shareApi.js';
import { tx } from '../i18n.js';

/** Что пришло по совместной ссылке: просмотр и сохранение к себе. */
export default function ReceiveDialog({ bundle, onClose, onOpenTree, onOpenDoc, profileId }) {
  const [saved, setSaved] = useState({}); // key -> id сохранённой копии
  const [profiles, setProfiles] = useState([]);
  const [target, setTarget] = useState(profileId || '');
  useEffect(() => {
    store.list('profiles').then((l) => {
      const ps = l.filter((p) => !p.isFolder).sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
      setProfiles(ps);
      setTarget((t) => t || ps[0]?.id || '');
    });
  }, []);

  const saveTree = async (t, i) => {
    const obj = await saveTreeFromBundle(t, target);
    setSaved((s) => ({ ...s, ['t' + i]: obj.id }));
    return obj;
  };
  const saveDoc = async (d, i) => {
    const obj = await saveDocFromBundle(d, target);
    setSaved((s) => ({ ...s, ['d' + i]: obj.id }));
    return obj;
  };
  const saveAll = async () => {
    let n = 0;
    for (const [i, t] of bundle.trees.entries()) if (!saved['t' + i]) { await saveTree(t, i); n++; }
    for (const [i, d] of bundle.docs.entries()) if (!saved['d' + i]) { await saveDoc(d, i); n++; }
    toast(n ? tx("Сохранено в библиотеку: {0}", [n]) : tx("Всё уже сохранено"));
  };

  const openDoc = async (d, i) => {
    const id = saved['d' + i] || (await saveDoc(d, i)).id;
    onOpenDoc(id, target);
    onClose();
  };

  return (
    <div className="modal-back" {...backdrop(onClose)}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{tx("Получено по ссылке")}{bundle.from ? tx(" от {0}", [bundle.from]) : ''}</h3>
        <p className="muted small">{tx("Ничего не сохраняется само — выберите, что оставить у себя. Сохраняются копии: ваши файлы не перезаписываются.")}</p>
        <label className="field recv-target">
          <span>{tx("Сохранять в профиль")}</span>
          <select className="tb-select" value={target} onChange={(e) => { setTarget(e.target.value); setSaved({}); }}>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.folder ? p.folder + ' / ' : ''}{p.name}</option>)}
          </select>
        </label>

        {bundle.trees.length > 0 && <h4>{tx("Деревья атласа (")}{bundle.trees.length})</h4>}
        {bundle.trees.map((t, i) => (
          <div key={'t' + i} className="recv-item">
            <span>🗺 {t.name}</span>
            <div className="spacer" />
            <button className="btn" onClick={() => { onOpenTree(treeLinkFromCode(t.code), t.name, target); onClose(); }}>{tx("Посмотреть")}</button>
            <button className="btn" disabled={!!saved['t' + i]} onClick={() => saveTree(t, i).then(() => toast(tx("Дерево сохранено")))}>
              {saved['t' + i] ? tx("✓ Сохранено") : tx("Сохранить")}
            </button>
          </div>
        ))}

        {bundle.docs.length > 0 && <h4>{tx("Документы и таблицы (")}{bundle.docs.length})</h4>}
        {bundle.docs.map((d, i) => (
          <div key={'d' + i} className="recv-item">
            <span>{d.type === 'sheet' ? '▦' : '📝'} {d.name}</span>
            <div className="spacer" />
            <button className="btn" onClick={() => openDoc(d, i)}>{tx("Открыть")}</button>
            <button className="btn" disabled={!!saved['d' + i]} onClick={() => saveDoc(d, i).then(() => toast(tx("Документ сохранён")))}>
              {saved['d' + i] ? tx("✓ Сохранено") : tx("Сохранить")}
            </button>
          </div>
        ))}

        {bundle.trees.length + bundle.docs.length === 0 && <p className="muted">{tx("Ссылка пустая.")}</p>}

        <div className="row end">
          <button className="btn" onClick={onClose}>{tx("Закрыть")}</button>
          <button className="btn primary" onClick={saveAll} disabled={bundle.trees.length + bundle.docs.length === 0}>{tx("Сохранить всё")}</button>
        </div>
      </div>
    </div>
  );
}
