import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBundle, decodeBundle, classifyLink, bundleLink, shorten, resolveShort, shortApiUrl } from '../src/share/bundle.js';

const doc = {
  type: 'text',
  name: 'Стратегия фарма',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Expedition + Harbinger, '.repeat(20) }] }] },
};
const sheet = { type: 'sheet', name: 'Дроп', sheets: [{ name: 'Лист1', celldata: [{ r: 0, c: 0, v: { v: 42, m: '42' } }, { r: 1, c: 0, v: { v: 84, f: '=A1*2' } }] }] };
const trees = [{ name: 'Основное', code: 'As5A3JFQ' }, { name: 'Запасное', code: 'Ag8xyz' }];

test('пакет: roundtrip документа, таблицы и деревьев', async () => {
  const code = await encodeBundle({ trees, docs: [doc, sheet], from: 'kiril' });
  const back = await decodeBundle(code);
  assert.deepEqual(back.trees, trees);
  assert.equal(back.docs[0].name, doc.name);
  assert.deepEqual(back.docs[0].content, doc.content);
  assert.deepEqual(back.docs[1].sheets, sheet.sheets);
  assert.equal(back.from, 'kiril');
  console.log(`  документ+таблица+2 дерева -> ${bundleLink(code).length} символов`);
});

test('пакет: мусорные поля отбрасываются', async () => {
  const code = await encodeBundle({ trees: [{ name: 'x', code: 'bad code!' }], docs: [{ type: 'evil', name: 'x' }] });
  const back = await decodeBundle(code);
  assert.equal(back.trees.length, 0);
  assert.equal(back.docs.length, 0);
});

test('распознавание ссылок', () => {
  assert.equal(classifyLink('poeatlas://b/AbC_-1').kind, 'bundle');
  assert.deepEqual(classifyLink('poeatlas://s/poeatlas-links.kiril.workers.dev/k7Qx2aB'), { kind: 'short', host: 'poeatlas-links.kiril.workers.dev', id: 'k7Qx2aB' });
  assert.deepEqual(classifyLink('https://poeatlas-links.kiril.workers.dev/k7Qx2aB'), { kind: 'short', host: 'poeatlas-links.kiril.workers.dev', id: 'k7Qx2aB' });
  assert.equal(classifyLink('poeatlas://t/As5A3JFQ').kind, 'tree');
  assert.equal(classifyLink('https://www.pathofexile.com/fullscreen-atlas-skill-tree/AAAABgAA').kind, 'tree');
  assert.equal(classifyLink('https://x.github.io/open.html#As5A3JFQ').kind, 'tree');
  assert.throws(() => shortApiUrl('evil.com/../x', 'abcd123'));
  assert.equal(shortApiUrl('localhost:8787', 'abcd123'), 'http://localhost:8787/api/links/abcd123');
  assert.equal(shortApiUrl('a.workers.dev', 'abcd123'), 'https://a.workers.dev/api/links/abcd123');
});

test('короткие ссылки через локальный сервер (wrangler dev)', async (t) => {
  const server = 'http://127.0.0.1:8787';
  try { await fetch(server + '/'); } catch { return t.skip('локальный сервер не запущен'); }
  const code = await encodeBundle({ trees, docs: [doc] });
  const url = await shorten(server, code);
  console.log('  короткая ссылка:', url);
  const c = classifyLink(url);
  assert.equal(c.kind, 'short');
  assert.equal(await resolveShort(c.host, c.id), code);
  assert.equal(await shorten(server, code), url, 'одинаковый пакет -> та же ссылка');
  const page = await (await fetch(url)).text();
  assert.match(page, /poeatlas:\/\/s\/127\.0\.0\.1:8787\//);
  await assert.rejects(resolveShort(c.host, 'zzzzzzz'), /не найдена/);
});
