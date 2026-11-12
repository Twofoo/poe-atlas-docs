import { useEffect, useRef, useState } from 'react';
import { backdrop } from './ui.js';
import DocsPage from './docs/DocsPage.jsx';
import AtlasPage from './atlas/AtlasPage.jsx';
import { setToaster, settings, isElectron, toast, store } from './store.js';
import ProfileScreen from './profiles/ProfileScreen.jsx';
import { ensureProfiles, touchProfile } from './profiles/profiles.js';
import { classifyLink } from './share/bundle.js';
import { resolveIncoming, shortenerUrl, makeShareLinks, treeLinkFromCode } from './share/shareApi.js';
import { shareLink } from './atlas/atlasModel.js';
import { copyText } from './store.js';
import { DEFAULT_SHORTENER } from './config.js';
import ShareDialog from './share/ShareDialog.jsx';
import ReceiveDialog from './share/ReceiveDialog.jsx';
import { tx, getLang, onLangChange } from './i18n.js';
import LangSwitch from './LangSwitch.jsx';

function useRoute() {
  const parse = () => {
    const h = window.location.hash.replace(/^#/, '') || '/';
    const [path, query] = h.split('?');
    return { path, params: new URLSearchParams(query || '') };
  };
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    setToaster((msg, kind) => {
      const id = Math.random();
      setItems((x) => [...x, { id, msg, kind }]);
      setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4200);
    });
  }, []);
  return (
    <div className="toasts">
      {items.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}
    </div>
  );
}

function SettingsModal({ onClose }) {
  const [base, setBase] = useState(settings.get('linkBase', ''));
  const [short, setShort] = useState(settings.get('shortener', ''));
  return (
    <div className="modal-back" {...backdrop(onClose)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{tx("Настройки")}</h3>
        <label className="field">
          <span>{tx("Сервер коротких ссылок")}</span>
          <input value={short} onChange={(e) => setShort(e.target.value)} placeholder={DEFAULT_SHORTENER || tx("https://poeatlas-links.ваш-поддомен.workers.dev")} />
        </label>
        <p className="muted small">
          {DEFAULT_SHORTENER ? <>{tx("По умолчанию используется встроенный сервер")} <code>{DEFAULT_SHORTENER}</code>{tx(". Оставьте поле пустым, чтобы использовать его.")}</> : <>{tx("Адрес вашего Cloudflare Worker (см.")} <code>server/README.md</code>{tx("). Без сервера работают полные ссылки — они длиннее, но не зависят ни от какого сайта.")}</>}
        </p>
        <label className="field">
          <span>{tx("Веб-адрес для ссылок на деревья (необязательно)")}</span>
          <input value={base} onChange={(e) => setBase(e.target.value)} placeholder={tx("https://ваш-ник.github.io/poeatlas/open.html")} />
        </label>
        <p className="muted small">
          {tx("По умолчанию ссылки имеют вид")} <code>poeatlas://t/…</code> {tx("и открываются установленным приложением. Discord и Telegram не делают такие ссылки кликабельными — если нужно, разместите файл")} <code>web/open.html</code>
          {tx("(например, на GitHub Pages) и укажите его адрес здесь: ссылки станут вида")} <code>{tx("https://…/open.html#код")}</code>
          {tx("и будут перенаправлять в приложение.")}
        </p>
        <div className="row end">
          <button className="btn" onClick={onClose}>{tx("Отмена")}</button>
          <button className="btn primary" onClick={() => { settings.set('linkBase', base.trim()); settings.set('shortener', short.trim().replace(/\/+$/, '')); onClose(); }}>{tx("Сохранить")}</button>
        </div>
      </div>
    </div>
  );
}

function OpenAtlasDialog({ onOpen, onClose }) {
  const [link, setLink] = useState('');
  useEffect(() => {
    navigator.clipboard?.readText?.().then((t) => {
      if (/^(poeatlas:\/\/|https?:\/\/)/i.test((t || '').trim())) setLink((cur) => cur || t.trim());
    }).catch(() => {});
  }, []);
  const submit = (e) => { e.preventDefault(); if (link.trim()) { onOpen(link.trim()); onClose(); } };
  return (
    <div className="modal-back" {...backdrop(onClose)}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{tx("Открыть другой атлас")}</h3>
        <p className="muted small">
          {tx("Вставьте ссылку на атлас: короткую")} <code>https://…workers.dev/…</code>, <code>poeatlas://…</code> {tx("или с pathofexile.com. Дерево откроется для просмотра — его можно сохранить к себе.")}
        </p>
        <textarea className="link-input" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder={tx("Ctrl+V — вставить ссылку")}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }} />
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>{tx("Отмена")}</button>
          <button type="submit" className="btn primary" disabled={!link.trim()}>{tx("Открыть")}</button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const standalone = route.path === '/atlas-window';
  const [profile, setProfile] = useState(null); // открытый профиль; null — экран выбора
  const [standaloneProfileId, setStandaloneProfileId] = useState(route.params.get('profile'));
  const [tab, setTab] = useState('atlas');
  const [openRequest, setOpenRequest] = useState(null);
  const [docRequest, setDocRequest] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [incoming, setIncoming] = useState(null); // пакет из совместной ссылки
  const [share, setShare] = useState(null); // {docIds, treeIds}
  const [, setLangState] = useState(getLang());
  useEffect(() => onLangChange(setLangState), []);
  const profileRef = useRef(null);
  const currentTreeRef = useRef(null); // дерево, открытое во вкладке атласа
  const [showOpenAtlas, setShowOpenAtlas] = useState(false);
  const [copying, setCopying] = useState(false);
  profileRef.current = profile;

  const openProfile = (p) => {
    setProfile(p);
    setTab(p.lastTab === 'docs' ? 'docs' : 'atlas');
    setOpenRequest(null);
    setDocRequest(null);
    settings.set('lastProfileId', p.id);
  };
  const openProfileById = async (id) => {
    if (profileRef.current?.id === id) return profileRef.current;
    const p = (id && (await store.get('profiles', id))) || null;
    if (p) {
      const fresh = (await touchProfile(p.id, { lastOpenedAt: Date.now() })) || p;
      openProfile(fresh);
      profileRef.current = fresh;
    }
    return p;
  };
  /** Для входящей ссылки на дерево нужен открытый профиль: если его нет — открываем последний. */
  const ensureOpenProfile = async () => {
    if (profileRef.current) return profileRef.current;
    const list = (await ensureProfiles()).filter((p) => !p.isFolder);
    const last =
      list.find((p) => p.id === settings.get('lastProfileId', '')) ||
      list.sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))[0];
    return openProfileById(last.id);
  };
  const copyAtlas = async (withDocs) => {
    const t = currentTreeRef.current;
    if (!t) return toast(tx("Дерево ещё не загружено"), 'warn');
    setCopying(true);
    try {
      let docIds = [];
      if (withDocs) {
        await window.__poeFlushDocs?.(); // дописать несохранённые правки документов
        docIds = (await store.list('docs')).filter((d) => d.profileId === profileRef.current?.id).map((d) => d.id);
        if (!docIds.length) toast(tx("В профиле нет документов — копирую только атлас"), 'warn');
      }
      const r = await makeShareLinks({ docIds, treeObjects: [t] });
      // короткая https-ссылка кликабельна в Discord/Telegram; без сервера — запасные варианты
      const link = r.short || (docIds.length ? r.full : shareLink(t, { withName: true }));
      if (await copyText(link)) {
        toast(r.short
          ? (docIds.length ? tx("Скопировано (атлас + документов: {0}): {1}", [docIds.length, link]) : tx("Скопировано: {0}", [link]))
          : tx("Сервер ссылок недоступен — скопирована полная ссылка ({0} симв.)", [link.length]), r.short ? 'ok' : 'warn');
      } else toast(tx("Не удалось скопировать в буфер обмена"), 'err');
    } catch (e) {
      toast(tx("Не удалось создать ссылку: ") + e.message, 'err');
    } finally {
      setCopying(false);
    }
  };

  const changeTab = (t) => {
    setTab(t);
    if (profileRef.current) touchProfile(profileRef.current.id, { lastTab: t });
  };

  // Любая ссылка: дерево -> вкладка атласа; совместная/короткая -> окно «Получено»
  const handleLink = async (link, name) => {
    const kind = classifyLink(link).kind;
    if (kind === 'bundle' || kind === 'short') {
      try {
        if (kind === 'short') toast(tx("Загружаем по короткой ссылке…"));
        const b = await resolveIncoming(link);
        // ссылка только на один атлас — сразу открываем дерево, без промежуточного окна
        if (b.trees.length === 1 && !b.docs.length) {
          if (!standalone) await ensureOpenProfile();
          setTab('atlas');
          setOpenRequest({ link: treeLinkFromCode(b.trees[0].code), name: b.trees[0].name, at: Date.now() });
          return;
        }
        setIncoming(b);
      } catch (e) {
        toast(tx("Не удалось открыть ссылку: ") + e.message, 'err');
      }
      return;
    }
    if (!standalone) await ensureOpenProfile();
    setTab('atlas');
    setOpenRequest({ link, name, at: Date.now() });
  };
  const handleRef = useRef(handleLink);
  handleRef.current = handleLink;

  // Ссылки poeatlas:// — из ОС (клик в браузере/мессенджере), из документов, из буфера
  useEffect(() => {
    const handle = (link) => handleRef.current(link);
    let off = () => {};
    if (isElectron && !standalone) {
      window.api.pendingLink().then((l) => l && handle(l));
      off = window.api.onOpenLink(handle);
    }
    const onClick = (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      const inEditor = !!a.closest('.ProseMirror');
      if (inEditor && !(e.ctrlKey || e.metaKey)) return; // в редакторе — Ctrl+клик, как в Word
      if (/^poeatlas:/i.test(href)) { e.preventDefault(); handle(href); }
      else if (/^https?:/i.test(href) && (inEditor || isElectron)) {
        e.preventDefault();
        const kind = classifyLink(href).kind;
        const ours = kind === 'tree' || (kind === 'short' && shortenerUrl() && href.startsWith(shortenerUrl()));
        if (ours) handle(href);
        else if (isElectron) window.api.openExternal(href); else window.open(href, '_blank');
      }
    };
    document.addEventListener('click', onClick);
    const p = new URLSearchParams(window.location.hash.split('?')[1] || '');
    if (p.get('link')) handle(p.get('link'));
    return () => { off(); document.removeEventListener('click', onClick); };
  }, [standalone]);

  // Отдельное окно атласа без profile в адресе: профиль берём у дерева
  useEffect(() => {
    if (!standalone || standaloneProfileId) return;
    const tid = route.params.get('tree');
    (async () => {
      const t = tid && (await store.get('trees', tid));
      if (t?.profileId) return setStandaloneProfileId(t.profileId);
      const list = (await ensureProfiles()).filter((x) => !x.isFolder);
      setStandaloneProfileId(list[0]?.id);
    })();
  }, [standalone]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentProfileId = standalone ? standaloneProfileId : profile?.id;

  const dialogs = (
    <>
      {incoming && (
        <ReceiveDialog
          bundle={incoming}
          profileId={currentProfileId}
          onClose={() => setIncoming(null)}
          onOpenTree={async (link, name, target) => {
            if (!standalone) await openProfileById(target);
            setTab('atlas');
            setOpenRequest({ link, name, at: Date.now() });
          }}
          onOpenDoc={async (id, target) => {
            await openProfileById(target);
            setTab('docs');
            setDocRequest({ id, at: Date.now() });
          }}
        />
      )}
      {share && (
        <ShareDialog profileId={currentProfileId} initialDocIds={share.docIds} initialTreeIds={share.treeIds} onClose={() => setShare(null)} />
      )}
      <Toasts />
    </>
  );

  if (standalone) {
    return (
      <div className="app standalone">
        {standaloneProfileId && (
          <AtlasPage standalone profileId={standaloneProfileId} initialTreeId={route.params.get('tree')} openRequest={openRequest} onOpenLink={handleLink} onShare={setShare} />
        )}
        {dialogs}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="app">
        <ProfileScreen onOpen={openProfile} lastProfileId={settings.get('lastProfileId', '')} />
        {dialogs}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><img className="logo-img" src="./icon.png" alt="" /><span className="brand-text">PoE Atlas Docs</span></div>
        <button className="profile-chip" onClick={() => setProfile(null)} title={tx("Сменить профиль")}>
          👤 {profile.name} <span className="muted">▾</span>
        </button>
        <nav className="tabs">
          <button className={tab === 'atlas' ? 'on' : ''} onClick={() => changeTab('atlas')}>{tx("🗺 Дерево атласа")}</button>
          <button className={tab === 'docs' ? 'on' : ''} onClick={() => changeTab('docs')}>{tx("📄 Документы и таблицы")}</button>
        </nav>
        <div className="spacer" />
        <div className="top-actions">
          <button className="btn primary" disabled={copying} onClick={() => copyAtlas(false)} title={tx("Ссылка на открытое дерево атласа")}>
            {tx("🔗 Скопировать Атлас")}
          </button>
          <button className="btn primary" disabled={copying} onClick={() => copyAtlas(true)} title={tx("Одна ссылка: открытое дерево + все документы и таблицы профиля")}>
            {tx("🔗 Скопировать Атлас + Текстовые документы")}
          </button>
          <button className="btn import-btn" onClick={() => setShowOpenAtlas(true)} title={tx("Вставить ссылку и открыть чужой атлас")}>
            {tx("⇣ Открыть другой атлас")}
          </button>
        </div>
        <LangSwitch />
        <button className="btn ghost" onClick={() => setShowSettings(true)} title={tx("Настройки")}>⚙</button>
      </header>
      <main className="content" key={profile.id}>
        <div style={{ display: tab === 'atlas' ? 'contents' : 'none' }}>
          <AtlasPage profileId={profile.id} lastTreeId={profile.lastTreeId} openRequest={openRequest} onOpenLink={handleLink} onShare={setShare} onCurrentChange={(t) => { currentTreeRef.current = t; }} />
        </div>
        {tab === 'docs' && <DocsPage profileId={profile.id} lastDocId={profile.lastDocId} openRequest={docRequest} onShare={setShare} />}
      </main>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showOpenAtlas && <OpenAtlasDialog onOpen={handleLink} onClose={() => setShowOpenAtlas(false)} />}
      {dialogs}
    </div>
  );
}
