// Generates the README screenshots (docs/screenshots/*.png) with English demo data.
//
// Usage:  1) start the dev server:  npx vite
//         2) node scripts/make-screenshots.mjs
//
// Uses a temporary data folder (POE_USERDATA) — your real profiles are never touched.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTree, findPath } from '../src/atlas/tree.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const UD = path.join(os.tmpdir(), 'poe-atlas-docs-screens');
const S = path.join(UD, 'storage');
const PORT = 9455;
const W = 1440, H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- demo data ----------
const tree = buildTree(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/data.json'), 'utf8')));
function allocate(targets, budget) {
  const alloc = new Set([tree.startId]);
  for (const id of targets) {
    const p = findPath(tree, alloc, id);
    if (p && alloc.size - 1 + p.length <= budget) p.forEach((x) => alloc.add(x));
  }
  return [...alloc];
}
const now = Date.now();
const put = (kind, obj) => {
  fs.mkdirSync(path.join(S, kind), { recursive: true });
  fs.writeFileSync(path.join(S, kind, obj.id + '.json'), JSON.stringify({ updatedAt: now, ...obj }));
};
fs.rmSync(UD, { recursive: true, force: true });

put('profiles', { id: 'pfolder', isFolder: true, name: 'Settlers league', folder: '', createdAt: now });
put('profiles', { id: 'pssf', name: 'SSF — Expedition & Delirium', subtitle: 'Settlers · Elementalist', folder: 'Settlers league', createdAt: now - 9e6, lastOpenedAt: now - 60e3, lastTab: 'atlas', lastTreeId: 'tmain', lastDocId: 'dplan' });
put('profiles', { id: 'ptrade', name: 'Trade — Breach farm', subtitle: 'Settlers · Juggernaut', folder: 'Settlers league', createdAt: now - 8e6, lastOpenedAt: now - 86e6 });
put('profiles', { id: 'pstd', name: 'Standard', subtitle: 'Archive', folder: '', createdAt: now - 7e6, lastOpenedAt: now - 400e6 });

const mainNodes = allocate(['5384', '13802', '60730', '15324', '42605', '3204', '14287', '19729', '21096'], 118);
put('trees', { id: 'tmain', profileId: 'pssf', name: 'Expedition + Delirium', nodes: mainNodes, choices: {}, notes: 'Run Expedition every map, Delirium mirrors on juiced maps.', createdAt: now - 5e6 });
put('trees', { id: 'tbreach', profileId: 'pssf', name: 'Breach alt', nodes: allocate(['3204', '14287', '19729', '21096', '26924', '27459'], 64), choices: {}, notes: '', createdAt: now - 4e6 });
put('trees', { id: 'tritual', profileId: 'pssf', name: 'Ritual (league start)', nodes: allocate(['11313', '12483', '13540', '17785'], 40), choices: {}, notes: '', createdAt: now - 3e6 });

put('docs', {
  id: 'dplan', profileId: 'pssf', type: 'text', name: 'Farming strategy', createdAt: now - 2e6,
  content: `<h1>Farming strategy — Expedition &amp; Delirium</h1>
<p>Atlas tree: <a href="poeatlas://t/demo">🗺 Expedition + Delirium</a> · <mark data-color="#fde68a" style="background-color:#fde68a">~110 points</mark></p>
<h2>Map routine</h2>
<ul><li><strong>Expedition</strong> in every map — place remnants on <em>Logbook</em> and <em>Artifact</em> mods.</li>
<li><strong>Delirium mirror</strong> on juiced maps only; walk to the boss before it fades.</li>
<li>Sell <u>Logbooks</u> in bulk, keep Delirium orbs for juicing.</li></ul>
<h2>Profit per hour</h2>
<table><tbody><tr><th><p>Strategy</p></th><th><p>Maps / hour</p></th><th><p>Divines / hour</p></th></tr>
<tr><td><p>Expedition only</p></td><td><p>9</p></td><td><p>1.8</p></td></tr>
<tr><td><p>Expedition + Delirium</p></td><td><p>7</p></td><td><p>2.6</p></td></tr></tbody></table>
<blockquote><p>Tip: Ctrl+click an atlas link to open the tree.</p></blockquote>`,
});
const cells = [];
const rows = [['Map', 'Tier', 'Invest (c)', 'Loot (c)', 'Profit (c)'], ['Strand', 16, 40, 155], ['Crimson Temple', 16, 55, 210], ['Tropical Island', 16, 40, 170], ['Dunes', 16, 35, 120], ['Cemetery', 16, 45, 190]];
rows.forEach((row, r) => row.forEach((v, c) => cells.push({ r, c, v: { v, m: String(v), ct: { fa: 'General', t: typeof v === 'number' ? 'n' : 'g' }, ...(r === 0 ? { bl: 1, bg: '#f3e2b8' } : {}) } })));
for (let r = 1; r < rows.length; r++) cells.push({ r, c: 4, v: { f: `=D${r + 1}-C${r + 1}`, v: rows[r][3] - rows[r][2], m: String(rows[r][3] - rows[r][2]), ct: { fa: 'General', t: 'n' } } });
cells.push({ r: 7, c: 3, v: { v: 'Total', m: 'Total', bl: 1 } });
cells.push({ r: 7, c: 4, v: { f: '=SUM(E2:E6)', v: 580, m: '580', bl: 1, ct: { fa: 'General', t: 'n' } } });
put('docs', { id: 'dloot', profileId: 'pssf', type: 'sheet', name: 'Loot log', createdAt: now - 1e6, sheets: [{ name: 'Sheet1', id: 's1', order: 0, status: 1, celldata: cells, row: 60, column: 20, config: { columnlen: { 0: 160, 1: 70, 2: 100, 3: 100, 4: 100 } } }] });

// ---------- drive the app ----------
const electron = path.join(ROOT, 'node_modules/electron/dist/electron.exe');
const app = spawn(electron, [ROOT, `--remote-debugging-port=${PORT}`], { cwd: ROOT, env: { ...process.env, VITE_DEV: '1', POE_USERDATA: UD }, stdio: 'ignore' });

let ws, msgId = 0;
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = pages.find((p) => p.type === 'page' && p.url.startsWith('http'));
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r)); return; }
    } catch {}
    await sleep(300);
  }
  throw new Error('Electron did not start (is `npx vite` running?)');
}
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', h); resolve(m.result); } };
  ws.addEventListener('message', h);
  ws.send(JSON.stringify({ id, method, params }));
});
const run = async (expr) => (await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }))?.result?.value;
async function shot(name) {
  await sleep(700);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log('  saved', name + '.png');
}
const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none' });

try {
  fs.mkdirSync(OUT, { recursive: true });
  await connect();
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await run(`localStorage.setItem('poeatlasdocs:set:lang', JSON.stringify('en')); localStorage.setItem('poeatlasdocs:set:lastProfileId', JSON.stringify('pssf')); location.reload();`);
  await sleep(3500);

  // 1. profile screen (open the Settlers folder)
  await run(`const f=[...document.querySelectorAll('.prof-row')].find(r=>r.textContent.includes('Settlers league')); f && f.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); await new Promise(r=>setTimeout(r,400)); [...document.querySelectorAll('.prof-row')].find(r=>r.textContent.includes('SSF'))?.click();`);
  await shot('profiles');

  // 2. atlas tree with a hovered node showing the path preview
  await run(`[...document.querySelectorAll('.prof-row')].find(r=>r.textContent.includes('SSF')).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));`);
  await sleep(3500);
  const target = await run(`const d=window.__atlasDebug; const c=d.canvas.current; const r=c.getBoundingClientRect();
    const n=d.tree.nodes.get('27459'); // Breach notable outside the current allocation
    return { x: r.left + (n.x - d.view.x) * d.view.zoom + c.clientWidth/2, y: r.top + (n.y - d.view.y) * d.view.zoom + c.clientHeight/2 };`);
  await mouse('mouseMoved', target.x, target.y);
  await shot('atlas-tree');

  // 3. zoomed-in tree
  await mouse('mouseMoved', 20, H - 20);
  await run(`const d=window.__atlasDebug; const n=d.tree.nodes.get('5384'); const st=d.tree.nodes.get(d.tree.startId); d.view.x=(n.x*2+st.x)/3; d.view.y=(n.y*2+st.y)/3; d.view.zoom=0.1; document.querySelector('.atlas-zoom button').click(); document.querySelectorAll('.atlas-zoom button')[1].click();`);
  await shot('atlas-zoom');

  // 4. summary tab
  await run(`[...document.querySelectorAll('.side-tabs button')][1].click();`);
  await shot('atlas-summary');
  await run(`[...document.querySelectorAll('.side-tabs button')][0].click();`);

  // 5. text document
  await run(`[...document.querySelectorAll('.tabs button')][1].click(); await new Promise(r=>setTimeout(r,1200)); [...document.querySelectorAll('.docs-side .tree-item')].find(i=>i.textContent.includes('Farming'))?.click();`);
  await sleep(1500);
  await shot('document');

  // 6. spreadsheet
  await run(`[...document.querySelectorAll('.docs-side .tree-item')].find(i=>i.textContent.includes('Loot'))?.click();`);
  await sleep(2500);
  await shot('spreadsheet');

  // 7. share dialog (combined link)
  await run(`document.querySelector('.docs-header .btn.primary').click(); await new Promise(r=>setTimeout(r,600));
    const boxes=[...document.querySelectorAll('.share-modal input[type=checkbox]')]; boxes.forEach(b=>{ if(!b.checked && /Expedition|Farming/.test(b.parentElement.textContent)) b.click(); });`);
  await shot('share');
  await run(`[...document.querySelectorAll('.share-modal .btn')].find(b=>b.textContent==='Close')?.click();`);

  // 8. import from link (profile screen)
  await run(`document.querySelector('.profile-chip').click(); await new Promise(r=>setTimeout(r,800)); document.querySelector('.prof-actions .import-btn').click(); await new Promise(r=>setTimeout(r,400));
    // combined link built from the demo data (no server needed)
    const { buildBundleCode } = await import('/src/share/shareApi.js');
    const link = 'poeatlas://b/' + await buildBundleCode({ docIds: ['dplan', 'dloot'], treeIds: ['tmain'] });
    const ta=document.querySelector('.modal .link-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(ta, link); ta.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,800)); const nm=document.querySelector('.import-target .search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(nm,'From a friend — Expedition'); nm.dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(3500);
  await shot('import');
} finally {
  try { await run(`setTimeout(()=>window.close(),100)`); } catch {}
  await sleep(1500);
  app.kill();
  fs.rmSync(UD, { recursive: true, force: true });
}
