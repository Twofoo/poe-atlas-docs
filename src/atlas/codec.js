import { tx } from '../i18n.js';
// Кодирование деревьев в ссылки.
//
// 1) Собственный компактный формат: poeatlas://t/<код>
//    байт 0 = версия (1), далее битовый поток:
//      k (4 бита) — параметр кода Райса, n (11 бит) — число узлов,
//      n разностей отсортированных skill-id (код Райса),
//      для каждого узла с выбором варианта — индекс варианта (3 бита),
//      флаг имени (1 бит); затем (с выравниванием по байту) UTF-8 имя.
//    Skill-id в PoE стабильны между патчами, поэтому ссылки не «ломаются» после обновления данных.
//
// 2) Официальный формат GGG (pathofexile.com/fullscreen-atlas-skill-tree/<base64>) — импорт и экспорт,
//    совместим с сайтом GGG, maxroll, poe.ninja и т.п.

const FORMAT_VERSION = 1;
export const PROTOCOL = 'poeatlas';

// ---------- base64url ----------
export function toBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- битовый поток ----------
class BitWriter {
  constructor() { this.bytes = []; this.cur = 0; this.n = 0; }
  bit(b) {
    this.cur = (this.cur << 1) | (b & 1);
    if (++this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; }
  }
  bits(v, count) { for (let i = count - 1; i >= 0; i--) this.bit((v >>> i) & 1); }
  rice(v, k) {
    const q = v >>> k;
    for (let i = 0; i < q; i++) this.bit(1);
    this.bit(0);
    this.bits(v & ((1 << k) - 1), k);
  }
  finish() { if (this.n) { this.bytes.push(this.cur << (8 - this.n)); this.cur = 0; this.n = 0; } return this.bytes; }
}
class BitReader {
  constructor(bytes, offset = 0) { this.bytes = bytes; this.pos = offset * 8; }
  bit() {
    const byte = this.bytes[this.pos >> 3];
    if (byte === undefined) throw new Error(tx("Код повреждён (неожиданный конец)"));
    const b = (byte >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return b;
  }
  bits(count) { let v = 0; for (let i = 0; i < count; i++) v = (v << 1) | this.bit(); return v >>> 0; }
  rice(k) { let q = 0; while (this.bit()) { if (++q > 70000) throw new Error(tx("Код повреждён")); } return (q << k) | this.bits(k); }
  byteOffset() { return Math.ceil(this.pos / 8); }
}

const riceCost = (gaps, k) => gaps.reduce((s, g) => s + (g >>> k) + 1 + k, 0);

/**
 * Контекст кодека из построенного дерева.
 * variantsOf — варианты узла с выбором, adjOf — соседи, startId — стартовый узел, hash — отпечаток графа.
 */
export function makeCodecCtx(tree) {
  const sortedAdj = new Map();
  for (const n of tree.nodes.values()) sortedAdj.set(n.id, [...n.adj].sort((a, b) => Number(a) - Number(b)));
  let h = 2166136261;
  for (const e of [...tree.edges].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    for (let i = 0; i < e.key.length; i++) h = Math.imul(h ^ e.key.charCodeAt(i), 16777619);
  }
  return {
    variantsOf: (id) => tree.nodes.get(String(id))?.variants || null,
    adjOf: (id) => sortedAdj.get(String(id)) || [],
    startId: tree.startId,
    hash: (h >>> 0) & 255,
  };
}

const NO_CTX = { variantsOf: () => null };

function writeTail(w, ids, choices, name, ctx) {
  for (const id of ids) {
    const vars = ctx.variantsOf(String(id));
    if (!vars) continue;
    const idx = Math.max(0, vars.findIndex((v) => String(v.effect) === String(choices[id])));
    w.bits(Math.min(idx, 7), 3);
  }
  const nameBytes = name ? new TextEncoder().encode(name.slice(0, 60)) : null;
  w.bit(nameBytes ? 1 : 0);
  return nameBytes;
}

function readTail(r, bytes, ids, ctx) {
  const choices = {};
  for (const id of ids) {
    const vars = ctx.variantsOf(String(id));
    if (!vars) continue;
    const idx = r.bits(3);
    if (vars[idx]) choices[id] = vars[idx].effect;
  }
  let name = '';
  if (r.bit()) name = new TextDecoder().decode(bytes.slice(r.byteOffset()));
  return { choices, name };
}

/** Обход связного поддерева от старта: для каждого ещё не рассмотренного соседа — 1 бит «взят/не взят». */
function walk(ctx, decide) {
  const included = [ctx.startId];
  const asked = new Set([ctx.startId]);
  for (let i = 0; i < included.length; i++) {
    for (const nb of ctx.adjOf(included[i])) {
      if (asked.has(nb)) continue;
      asked.add(nb);
      if (decide(nb)) included.push(nb);
    }
  }
  return included.slice(1);
}

/**
 * Кодирует дерево.
 *  compact=true  -> версия 2: обход графа (~40–70 символов), привязан к версии дерева (hash).
 *  compact=false -> версия 1: список skill-id (код Райса, ~230 символов), не зависит от патчей.
 */
export function encodeTree({ nodeIds, choices = {}, name = '' }, ctx = NO_CTX, { compact = true } = {}) {
  if (compact && ctx.adjOf) {
    const want = new Set(nodeIds.map(String));
    const w = new BitWriter();
    const order = walk(ctx, (id) => {
      const take = want.has(id);
      w.bit(take ? 1 : 0);
      return take;
    });
    const nameBytes = writeTail(w, order, choices, name, ctx);
    const bytes = [2, ctx.hash, ...w.finish()];
    if (nameBytes) bytes.push(...nameBytes);
    return toBase64Url(Uint8Array.from(bytes));
  }

  const ids = [...new Set(nodeIds.map(Number))].filter((x) => x >= 0 && x < 65536).sort((a, b) => a - b);
  if (ids.length > 2047) throw new Error(tx("Слишком много узлов"));
  const gaps = ids.map((id, i) => (i === 0 ? id : id - ids[i - 1] - 1));
  let k = 0;
  let best = Infinity;
  for (let t = 0; t < 16; t++) { const c = riceCost(gaps, t); if (c < best) { best = c; k = t; } }

  const w = new BitWriter();
  w.bits(k, 4);
  w.bits(ids.length, 11);
  for (const g of gaps) w.rice(g, k);
  const nameBytes = writeTail(w, ids, choices, name, ctx);
  const bytes = [FORMAT_VERSION, ...w.finish()];
  if (nameBytes) bytes.push(...nameBytes);
  return toBase64Url(Uint8Array.from(bytes));
}

export function decodeTree(code, ctx = NO_CTX) {
  const bytes = fromBase64Url(code.trim());
  if (bytes[0] === 2) {
    if (!ctx.adjOf) throw new Error(tx("Нужен контекст дерева"));
    const r = new BitReader(bytes, 2);
    const ids = walk(ctx, () => r.bit() === 1);
    const tail = readTail(r, bytes, ids, ctx);
    return { nodeIds: ids, ...tail, versionMismatch: bytes[1] !== ctx.hash };
  }
  if (bytes[0] !== FORMAT_VERSION) throw new Error(tx("Неизвестная версия ссылки: ") + bytes[0]);
  const r = new BitReader(bytes, 1);
  const k = r.bits(4);
  const n = r.bits(11);
  const ids = [];
  let prev = -1;
  for (let i = 0; i < n; i++) { prev = prev + 1 + r.rice(k); ids.push(prev); }
  return { nodeIds: ids.map(String), ...readTail(r, bytes, ids, ctx) };
}

// ---------- официальный формат GGG ----------
export function encodeOfficial({ nodeIds, choices = {} }) {
  const ids = nodeIds.map(Number).filter((x) => x > 0 && x < 65536);
  const ch = Object.entries(choices).filter(([id]) => ids.includes(Number(id)));
  const out = [0, 0, 0, 6, 0, 0, Math.min(ids.length, 255)];
  for (const id of ids.slice(0, 255)) out.push(id >> 8, id & 255);
  out.push(0); // кластерные узлы
  out.push(ch.length);
  for (const [id, eff] of ch) { const e = Number(eff); out.push(e >> 8, e & 255, Number(id) >> 8, Number(id) & 255); }
  return toBase64Url(Uint8Array.from(out));
}

export function decodeOfficial(code) {
  const b = fromBase64Url(code.trim());
  const version = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  if (version < 4 || version > 6) throw new Error(tx("Неподдерживаемая версия дерева GGG: ") + version);
  let p = 6;
  const nodeIds = [];
  const choices = {};
  if (version >= 5 || version === 4) {
    const count = b[p++];
    for (let i = 0; i < count; i++, p += 2) nodeIds.push(String((b[p] << 8) | b[p + 1]));
    if (version >= 5 && p < b.length) {
      const cc = b[p++];
      p += cc * 2;
    }
    if (version >= 6 && p < b.length) {
      const mc = b[p++];
      for (let i = 0; i < mc; i++, p += 4) {
        const eff = (b[p] << 8) | b[p + 1];
        const node = (b[p + 2] << 8) | b[p + 3];
        choices[node] = eff;
      }
    }
  }
  return { nodeIds, choices, name: '' };
}

// ---------- разбор любой ссылки ----------
/**
 * Принимает: poeatlas://t/<код>, https://.../open.html#<код>, "голый" код,
 * официальную ссылку pathofexile.com/...atlas-skill-tree/<код>.
 */
export function parseAnyLink(input, ctx) {
  const s = String(input || '').trim();
  if (!s) throw new Error(tx("Пустая ссылка"));
  const official = s.match(/atlas-skill-tree\/(?:[^/?#]*\/)?([A-Za-z0-9_\-+/=]{8,})/i) ||
    s.match(/passive-skill-tree\/[^/]*\/?([A-Za-z0-9_\-+/=]{8,})/i);
  if (official && /pathofexile|maxroll|poe/i.test(s)) {
    return { ...decodeOfficial(official[1]), source: 'official' };
  }
  let code = s;
  const proto = s.match(/^poeatlas:\/\/(?:t\/)?([^?#\s]+)/i);
  if (proto) code = proto[1];
  else if (s.includes('#')) code = s.slice(s.lastIndexOf('#') + 1);
  code = code.replace(/^t\//, '').replace(/\/+$/, '');
  return { ...decodeTree(code, ctx), source: "native" };
}

export function makeLink(code, base) {
  if (base && /^https?:\/\//i.test(base)) return base.replace(/#.*$/, '') + '#' + code;
  return `${PROTOCOL}://t/${code}`;
}
