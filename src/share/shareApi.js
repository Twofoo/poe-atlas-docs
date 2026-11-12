// Связка пакетов с данными приложения (деревья из atlasModel, документы из хранилища)
import { tree, codecCtx } from '../atlas/atlasModel.js';
import { encodeTree, makeLink } from '../atlas/codec.js';
import { parseLink } from '../atlas/atlasModel.js';
import { normalizeAllocation } from '../atlas/tree.js';
import { encodeBundle, decodeBundle, bundleLink, classifyLink, shorten, resolveShort } from './bundle.js';
import { store, uid, settings } from '../store.js';
import { DEFAULT_SHORTENER } from '../config.js';
import { tx } from '../i18n.js';

export const shortenerUrl = () => settings.get('shortener', '') || DEFAULT_SHORTENER;

const treeCode = (t) =>
  encodeTree({ nodeIds: t.nodes.filter((id) => id !== tree.startId), choices: t.choices || {} }, codecCtx, { compact: true });

/** Собирает пакет из id документов и деревьев библиотеки. */
export async function buildBundleCode({ docIds = [], treeIds = [], treeObjects = [] }) {
  const docs = (await Promise.all(docIds.map((id) => store.get('docs', id)))).filter(Boolean);
  const trees = [...treeObjects, ...(await Promise.all(treeIds.map((id) => store.get('trees', id)))).filter(Boolean)];
  return encodeBundle({
    docs: docs.map((d) => ({ type: d.type, name: d.name, content: d.content, sheets: d.sheets })),
    trees: trees.map((t) => ({ name: t.name, code: treeCode(t) })),
  });
}

export async function makeShareLinks(sel, { wantShort = true } = {}) {
  const code = await buildBundleCode(sel);
  const full = bundleLink(code);
  let short = null;
  let shortError = null;
  if (wantShort && shortenerUrl()) {
    try { short = await shorten(shortenerUrl(), code); } catch (e) { shortError = e.message; }
  }
  return { full, short, shortError };
}

/** Входящая ссылка-пакет (полная или короткая) -> {trees, docs, from} */
export async function resolveIncoming(link) {
  const c = classifyLink(link);
  if (c.kind === 'bundle') return decodeBundle(c.code);
  if (c.kind === 'short') return decodeBundle(await resolveShort(c.host, c.id));
  throw new Error(tx("Это не совместная ссылка"));
}

/**
 * Любая ссылка (совместная, короткая, на одно дерево, pathofexile.com) -> {trees, docs, from}.
 * Дерево из обычной ссылки приходит как { name, link }.
 */
export async function resolveAnyLink(link) {
  const s = String(link || '').trim();
  const kind = classifyLink(s).kind;
  if (kind === 'bundle' || kind === 'short') return resolveIncoming(s);
  const parsed = parseLink(s); // бросит понятную ошибку, если это не ссылка на дерево
  const official = parsed.source === 'official';
  return {
    trees: [{ name: parsed.name || (official ? tx("Дерево с pathofexile.com") : tx("Дерево по ссылке")), link: s, points: parsed.nodeIds.length }],
    docs: [],
    from: '',
  };
}

export const treeLinkFromCode = (code) => makeLink(code);

/** Сохраняет дерево из пакета в библиотеку, возвращает объект дерева. */
export async function saveTreeFromBundle(item, profileId) {
  const parsed = parseLink(item.link || makeLink(item.code));
  const t = {
    id: uid(),
    profileId,
    name: item.name || tx("Дерево по ссылке"),
    nodes: [...normalizeAllocation(tree, parsed.nodeIds)],
    choices: parsed.choices || {},
    notes: '',
    createdAt: Date.now(),
  };
  await store.put('trees', t);
  return t;
}

export async function saveDocFromBundle(item, profileId) {
  const d = { id: uid(), profileId, type: item.type, name: item.name, createdAt: Date.now() };
  if (item.type === 'sheet') d.sheets = item.sheets;
  else d.content = item.content;
  await store.put('docs', d);
  return d;
}
