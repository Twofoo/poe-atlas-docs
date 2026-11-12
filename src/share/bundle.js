// Совместные ссылки: документ(ы) + деревья атласа в одной ссылке, плюс короткие ссылки через свой сервер.
//
//  poeatlas://b/<код>          — пакет целиком в ссылке (JSON -> deflate -> base64url), сервер не нужен
//  https://<сервер>/<id>        — короткая ссылка (сервер хранит код пакета, см. server/worker.js)
//  poeatlas://s/<хост>/<id>     — то же, в виде, который открывает приложение напрямую
//
// Чистый модуль (без DOM/React): работает и в приложении, и в node-тестах.
import { toBase64Url, fromBase64Url } from '../atlas/codec.js';
import { tx } from '../i18n.js';

const BUNDLE_VERSION = 1;
const MAX_UNPACKED = 20 * 1024 * 1024; // защита от «zip-бомб»
const SHORT_ID = /^[A-Za-z0-9]{4,12}$/;

async function pipeBytes(bytes, stream, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { reader.cancel(); throw new Error(tx("Пакет слишком большой")); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/**
 * @param {{trees?: {name:string, code:string}[], docs?: {type:'text'|'sheet', name:string, content?:any, sheets?:any}[], from?: string}} bundle
 */
export async function encodeBundle(bundle) {
  const clean = {
    v: BUNDLE_VERSION,
    trees: (bundle.trees || []).map((t) => ({ name: String(t.name || ''), code: String(t.code) })),
    docs: (bundle.docs || []).filter((d) => d && (d.type === 'text' || d.type === 'sheet')).map((d) =>
      d.type === 'sheet'
        ? { type: 'sheet', name: String(d.name || ''), sheets: d.sheets || [] }
        : { type: 'text', name: String(d.name || ''), content: d.content ?? null },
    ),
  };
  if (bundle.from) clean.from = String(bundle.from).slice(0, 60);
  const json = new TextEncoder().encode(JSON.stringify(clean));
  const packed = await pipeBytes(json, new CompressionStream('deflate-raw'));
  return toBase64Url(Uint8Array.from([BUNDLE_VERSION, ...packed]));
}

export async function decodeBundle(code) {
  const bytes = fromBase64Url(String(code).trim());
  if (bytes[0] !== BUNDLE_VERSION) throw new Error(tx("Неизвестная версия пакета: ") + bytes[0]);
  const raw = await pipeBytes(bytes.subarray(1), new DecompressionStream('deflate-raw'), MAX_UNPACKED);
  const obj = JSON.parse(new TextDecoder().decode(raw));
  // строгая проверка формы: из ссылки берём только ожидаемые поля
  const trees = (Array.isArray(obj.trees) ? obj.trees : [])
    .filter((t) => t && typeof t.code === 'string' && /^[A-Za-z0-9_-]+$/.test(t.code))
    .map((t) => ({ name: String(t.name || tx("Дерево")).slice(0, 80), code: t.code }));
  const docs = (Array.isArray(obj.docs) ? obj.docs : [])
    .filter((d) => d && (d.type === 'text' || d.type === 'sheet'))
    .map((d) =>
      d.type === 'sheet'
        ? { type: 'sheet', name: String(d.name || tx("Таблица")).slice(0, 120), sheets: Array.isArray(d.sheets) ? d.sheets : [] }
        : { type: 'text', name: String(d.name || tx("Документ")).slice(0, 120), content: d.content && typeof d.content === 'object' ? d.content : null },
    );
  return { trees, docs, from: obj.from ? String(obj.from).slice(0, 60) : '' };
}

export const bundleLink = (code) => `poeatlas://b/${code}`;

// ---------- распознавание ссылок ----------
const isLocalHost = (host) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);

/** Адрес API для короткой ссылки: только https (http — лишь для локального сервера разработки). */
export function shortApiUrl(host, id) {
  if (!SHORT_ID.test(id)) throw new Error(tx("Неверная короткая ссылка"));
  if (!/^[A-Za-z0-9.-]+(:\d+)?$|^\[::1\](:\d+)?$/.test(host)) throw new Error(tx("Неверный адрес сервера"));
  return `${isLocalHost(host) ? 'http' : 'https'}://${host}/api/links/${id}`;
}

/**
 * Определяет тип ссылки.
 * @returns {{kind:'bundle', code} | {kind:'short', host, id} | {kind:'tree'} | {kind:'unknown'}}
 */
export function classifyLink(input) {
  const s = String(input || '').trim();
  let m = s.match(/^poeatlas:\/\/b\/([A-Za-z0-9_-]+)/i);
  if (m) return { kind: 'bundle', code: m[1] };
  m = s.match(/^poeatlas:\/\/s\/([^/\s]+)\/([A-Za-z0-9]{4,12})\/?$/i);
  if (m) return { kind: 'short', host: m[1], id: m[2] };
  if (/^poeatlas:\/\/t\//i.test(s) || /atlas-skill-tree|open\.html#/i.test(s)) return { kind: 'tree' };
  m = s.match(/^https?:\/\/([^/\s?#]+)\/([A-Za-z0-9]{4,12})\/?$/i);
  if (m && !/pathofexile\.com|maxroll\.gg/i.test(m[1])) return { kind: 'short', host: m[1], id: m[2] };
  if (/^[A-Za-z0-9_-]{8,}$/.test(s)) return { kind: 'tree' }; // «голый» код дерева
  return { kind: 'unknown' };
}

// ---------- сервер коротких ссылок ----------
export async function shorten(serverUrl, code) {
  const base = String(serverUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error(tx("Не указан сервер коротких ссылок (⚙ Настройки)"));
  const res = await fetch(base + '/api/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(tx("Сервер ответил ") + res.status + ': ' + (await res.text()).slice(0, 120));
  const data = await res.json();
  if (!data.url || !SHORT_ID.test(data.id)) throw new Error(tx("Неожиданный ответ сервера"));
  return data.url;
}

export async function resolveShort(host, id) {
  const res = await fetch(shortApiUrl(host, id));
  if (res.status === 404) throw new Error(tx("Ссылка не найдена (удалена или опечатка)"));
  if (!res.ok) throw new Error(tx("Сервер ответил ") + res.status);
  const data = await res.json();
  if (typeof data.code !== 'string') throw new Error(tx("Неожиданный ответ сервера"));
  return data.code;
}
