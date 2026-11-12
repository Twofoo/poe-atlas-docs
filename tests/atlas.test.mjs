import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, findPath, findRemoval, normalizeAllocation, summarizeStats } from '../src/atlas/tree.js';
import { encodeTree, decodeTree, encodeOfficial, decodeOfficial, parseAnyLink, makeLink, makeCodecCtx } from '../src/atlas/codec.js';

const raw = JSON.parse(readFileSync(new URL('../data/data.json', import.meta.url), 'utf8'));
const tree = buildTree(raw);
const ctx = makeCodecCtx(tree);
const variantsOf = ctx.variantsOf;

test('дерево построено', () => {
  assert.ok(tree.nodes.size > 1000);
  assert.equal(tree.startId, '29045');
  assert.ok(tree.nodes.get(tree.startId).adj.size >= 8);
});

test('путь и снятие узлов', () => {
  const alloc = new Set([tree.startId]);
  const target = '1733'; // Arbitrary Tenets (keystone)
  const path = findPath(tree, alloc, target);
  assert.ok(path && path.length > 3);
  assert.equal(path[path.length - 1], target);
  // каждый следующий узел соседствует с предыдущим/взятым
  let prev = tree.startId;
  for (const id of path) { assert.ok(tree.nodes.get(prev).adj.has(id)); prev = id; }
  path.forEach((id) => alloc.add(id));
  const removal = findRemoval(tree, alloc, path[0]);
  assert.equal(removal.length, path.length);
  assert.deepEqual(findRemoval(tree, alloc, tree.startId), []);
});

test('врата (wormhole) дают переход', () => {
  const a = tree.nodes.get('2017');
  assert.ok(a.adj.has('54197'));
});

function randomAlloc(n, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const alloc = new Set([tree.startId]);
  const ids = [...tree.nodes.keys()].filter((id) => tree.nodes.get(id).type !== 'mastery');
  while (alloc.size < n) {
    const t = ids[Math.floor(rnd() * ids.length)];
    const p = findPath(tree, alloc, t);
    if (p && alloc.size + p.length <= n) p.forEach((x) => alloc.add(x));
    else if (p && p.length > n) continue;
    else break;
  }
  return alloc;
}

for (const compact of [true, false]) test(`нативный код (compact=${compact}): roundtrip + длина`, () => {
  for (const seed of [1, 7, 42]) {
    const alloc = randomAlloc(133, seed);
    const nodeIds = [...alloc].filter((x) => x !== tree.startId);
    const choices = {};
    for (const id of nodeIds) { const v = variantsOf(id); if (v) choices[id] = v[v.length - 1].effect; }
    const code = encodeTree({ nodeIds, choices, name: 'Мой атлас' }, ctx, { compact });
    const back = decodeTree(code, ctx);
    assert.deepEqual(new Set(back.nodeIds), new Set(nodeIds));
    assert.deepEqual(back.choices, choices);
    assert.equal(back.name, 'Мой атлас');
    assert.ok(!back.versionMismatch);
    const plain = encodeTree({ nodeIds }, ctx, { compact });
    console.log(`  ${nodeIds.length} узлов -> ${plain.length} символов`);
    assert.ok(plain.length < (compact ? 90 : 260));
    assert.deepEqual(parseAnyLink(makeLink(plain), ctx).nodeIds.sort(), nodeIds.map(String).sort());
    assert.equal(parseAnyLink(makeLink(plain, 'https://x.github.io/open.html'), ctx).nodeIds.length, nodeIds.length);
  }
});

test('официальный формат GGG: roundtrip', () => {
  const alloc = randomAlloc(60, 3);
  const nodeIds = [...alloc].filter((x) => x !== tree.startId);
  const code = encodeOfficial({ nodeIds, choices: { [nodeIds[0]]: 1234 } });
  const back = decodeOfficial(code);
  assert.deepEqual(back.nodeIds, nodeIds);
  assert.equal(back.choices[nodeIds[0]], 1234);
  const parsed = parseAnyLink('https://www.pathofexile.com/fullscreen-atlas-skill-tree/' + code);
  assert.equal(parsed.source, 'official');
  assert.equal(normalizeAllocation(tree, parsed.nodeIds).size, nodeIds.length + 1);
});

test('сводка статов суммирует', () => {
  const alloc = randomAlloc(80, 5);
  const s = summarizeStats(tree, alloc);
  assert.ok(s.length > 0);
});
