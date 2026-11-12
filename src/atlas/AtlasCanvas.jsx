import { useEffect, useMemo, useRef, useState } from 'react';
import { findPath, findRemoval } from './tree.js';
import { tx } from '../i18n.js';

const HIT_R = { normal: 55, notable: 80, keystone: 110, wormhole: 110, start: 150, mastery: 0 };
const FRAMES = {
  normal: ['PSSkillFrame', 'PSSkillFrameHighlighted', 'PSSkillFrameActive'],
  notable: ['NotableFrameUnallocated', 'NotableFrameCanAllocate', 'NotableFrameAllocated'],
  keystone: ['KeystoneFrameUnallocated', 'KeystoneFrameCanAllocate', 'KeystoneFrameAllocated'],
  wormhole: ['WormholeFrameUnallocated', 'WormholeFrameCanAllocate', 'WormholeFrameAllocated'],
};
const ICON_CAT = { normal: 'normal', notable: 'notable', keystone: 'keystone', wormhole: 'wormhole' };

const COLORS = {
  edge: 'rgba(92, 86, 72, 0.75)',
  edgeActive: '#e2bf72',
  edgePath: '#8fd3ff',
  edgeRemove: '#ff5a4a',
  search: '#ffef5c',
};

export default function AtlasCanvas({ tree, sprites, allocated, choices, onAllocate, onRemove, onContext, searchHits, readOnly, pointsLeft }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const view = useRef({ x: 0, y: 0, zoom: 0.08 });
  const drag = useRef(null);
  const raf = useRef(0);
  const fitted = useRef(false);
  const [hover, setHover] = useState(null); // {id, sx, sy}
  const [, force] = useState(0);

  const hoverInfo = useMemo(() => {
    if (!hover) return null;
    const n = tree.nodes.get(hover.id);
    if (!n || n.type === 'mastery' || n.type === 'start') return { node: n, path: [], removal: [] };
    if (allocated.has(n.id)) return { node: n, path: [], removal: readOnly ? [] : findRemoval(tree, allocated, n.id) };
    return { node: n, path: findPath(tree, allocated, n.id) || [], removal: [] };
  }, [hover, tree, allocated, readOnly]);

  // Узлы, которые можно взять прямо сейчас (соседи взятых)
  const frontier = useMemo(() => {
    const s = new Set();
    for (const id of allocated) for (const nb of tree.nodes.get(id)?.adj || []) if (!allocated.has(nb)) s.add(nb);
    return s;
  }, [allocated, tree]);

  const activeGroups = useMemo(() => {
    const s = new Set();
    for (const id of allocated) { const n = tree.nodes.get(id); if (n && n.type !== 'start') s.add(n.group); }
    return s;
  }, [allocated, tree]);

  const fit = () => {
    const c = canvasRef.current;
    if (!c) return;
    const { minX, minY, maxX, maxY } = tree.bounds;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    fitted.current = true;
    view.current.zoom = Math.min(w / (maxX - minX + 1200), h / (maxY - minY + 1200));
    view.current.x = (minX + maxX) / 2;
    view.current.y = (minY + maxY) / 2;
    schedule();
  };

  const schedule = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(draw);
  };

  // ---------------- рисование ----------------
  const stateRef = useRef({});
  stateRef.current = { allocated, choices, hoverInfo, frontier, activeGroups, searchHits, sprites };

  function draw() {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d');
    const { allocated, hoverInfo, frontier, activeGroups, searchHits, sprites } = stateRef.current;
    const v = view.current;
    const z = v.zoom;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - v.x * z), dpr * (H / 2 - v.y * z));
    ctx.imageSmoothingQuality = 'high';

    const blit = (spr, cx, cy, mul = 1, flipY = false) => {
      if (!spr) return;
      const w = (spr.w / spr.scale) * mul, h = (spr.h / spr.scale) * mul;
      if (flipY) {
        ctx.save(); ctx.translate(cx, cy); ctx.scale(1, -1);
        ctx.drawImage(spr.img, spr.x, spr.y, spr.w, spr.h, -w / 2, -h / 2, w, h);
        ctx.restore();
      } else ctx.drawImage(spr.img, spr.x, spr.y, spr.w, spr.h, cx - w / 2, cy - h / 2, w, h);
    };

    // фон атласа
    const start = tree.nodes.get(tree.startId);
    const bg = sprites?.get('atlasBackground', 'AtlasPassiveBackground');
    if (bg) {
      const R = bg.w / bg.scale / 2;
      ctx.save();
      ctx.beginPath(); ctx.arc(start.x, start.y, R * 0.995, 0, Math.PI * 2); ctx.clip();
      blit(bg, start.x, start.y);
      const vg = ctx.createRadialGradient(start.x, start.y, R * 0.8, start.x, start.y, R);
      vg.addColorStop(0, 'rgba(7,7,10,0)'); vg.addColorStop(1, 'rgba(7,7,10,1)');
      ctx.fillStyle = vg; ctx.fillRect(start.x - R, start.y - R, R * 2, R * 2);
      ctx.restore();
    }

    // фоны групп
    if (sprites) {
      for (const g of tree.groups.values()) {
        if (!g.background) continue;
        const spr = sprites.get('groupBackground', g.background.image);
        blit(spr, g.x + (g.background.offsetX || 0), g.y + (g.background.offsetY || 0));
      }
    }

    // рёбра
    const pathSet = new Set(hoverInfo?.path || []);
    const removeSet = new Set(hoverInfo?.removal || []);
    ctx.lineCap = 'round';
    const strokeEdge = (e) => {
      const A = tree.nodes.get(e.a), B = tree.nodes.get(e.b);
      ctx.beginPath();
      if (e.arc) {
        const a1 = Math.atan2(A.y - e.arc.cy, A.x - e.arc.cx);
        const a2 = Math.atan2(B.y - e.arc.cy, B.x - e.arc.cx);
        let d = a2 - a1;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        ctx.arc(e.arc.cx, e.arc.cy, e.arc.r, a1, a1 + d, d < 0);
      } else {
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
      }
      ctx.stroke();
    };
    const layers = [[], [], [], []]; // normal, active, path, remove
    for (const e of tree.edges) {
      if (e.hidden) continue;
      const aA = allocated.has(e.a), bA = allocated.has(e.b);
      if ((removeSet.has(e.a) || removeSet.has(e.b)) && aA && bA) layers[3].push(e);
      else if (aA && bA) layers[1].push(e);
      else if ((pathSet.has(e.a) || aA) && (pathSet.has(e.b) || bA) && (pathSet.has(e.a) || pathSet.has(e.b))) layers[2].push(e);
      else layers[0].push(e);
    }
    const lw = Math.max(9, 1.1 / z);
    ctx.strokeStyle = COLORS.edge; ctx.lineWidth = lw; layers[0].forEach(strokeEdge);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = COLORS.edgeActive; ctx.lineWidth = lw * 1.5; layers[1].forEach(strokeEdge);
    ctx.strokeStyle = COLORS.edgePath; ctx.lineWidth = lw * 1.5; layers[2].forEach(strokeEdge);
    ctx.strokeStyle = COLORS.edgeRemove; ctx.lineWidth = lw * 1.5; layers[3].forEach(strokeEdge);

    // узлы
    for (const n of tree.nodes.values()) {
      if (n.type === 'mastery') {
        if (!sprites) continue;
        const active = activeGroups.has(n.group);
        if (active) {
          ctx.globalAlpha = 0.85;
          blit(sprites.get('masteryOverlay', n.icon), n.x, n.y, 0.9);
          ctx.globalAlpha = 1;
        }
        ctx.globalAlpha = active ? 1 : 0.55;
        blit(sprites.get('mastery', n.icon), n.x, n.y);
        ctx.globalAlpha = 1;
        continue;
      }
      const isAlloc = allocated.has(n.id);
      if (n.type === 'start') {
        blit(sprites?.get('startNode', 'AtlasPassiveSkillScreenStart'), n.x, n.y);
        continue;
      }
      const can = !isAlloc && (frontier.has(n.id) || pathSet.has(n.id));
      if (sprites) {
        const cat = ICON_CAT[n.type];
        const iconKey = n.type === 'wormhole' ? 'Wormhole' : n.icon;
        blit(sprites.get(cat + (isAlloc ? 'Active' : 'Inactive'), iconKey), n.x, n.y);
        blit(sprites.get('frame', FRAMES[n.type][isAlloc ? 2 : can ? 1 : 0]), n.x, n.y);
      } else {
        ctx.fillStyle = isAlloc ? COLORS.edgeActive : '#555';
        ctx.beginPath(); ctx.arc(n.x, n.y, HIT_R[n.type] * 0.7, 0, Math.PI * 2); ctx.fill();
      }
      const ring = (color, width = 14) => {
        ctx.strokeStyle = color; ctx.lineWidth = Math.max(width, 2.5 / z);
        ctx.beginPath(); ctx.arc(n.x, n.y, HIT_R[n.type] * 0.95, 0, Math.PI * 2); ctx.stroke();
      };
      if (pathSet.has(n.id)) ring(COLORS.edgePath);
      if (removeSet.has(n.id)) ring(COLORS.edgeRemove);
      if (searchHits && searchHits.has(n.id)) ring(COLORS.search, 22);
    }
  }

  // ---------------- взаимодействие ----------------
  const toWorld = (sx, sy) => {
    const c = canvasRef.current;
    const v = view.current;
    return { x: (sx - c.clientWidth / 2) / v.zoom + v.x, y: (sy - c.clientHeight / 2) / v.zoom + v.y };
  };

  const pick = (sx, sy) => {
    const p = toWorld(sx, sy);
    let best = null, bestD = Infinity;
    const minR = 9 / view.current.zoom; // минимум 9px на экране
    for (const n of tree.nodes.values()) {
      const r = Math.max(HIT_R[n.type], n.type === 'mastery' ? 0 : minR);
      if (!r) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  };

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { sx: e.clientX, sy: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
  };
  const onMouseMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (drag.current) {
      const dx = e.clientX - drag.current.sx, dy = e.clientY - drag.current.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
      if (drag.current.moved) {
        view.current.x = drag.current.vx - dx / view.current.zoom;
        view.current.y = drag.current.vy - dy / view.current.zoom;
        setHover(null);
        schedule();
        return;
      }
    }
    const n = pick(sx, sy);
    if (!n) { if (hover) setHover(null); return; }
    if (!hover || hover.id !== n.id) setHover({ id: n.id, sx, sy });
    else if (Math.abs(hover.sx - sx) + Math.abs(hover.sy - sy) > 2) setHover({ id: n.id, sx, sy });
  };
  const onMouseUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || readOnly) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const n = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (!n || n.type === 'mastery' || n.type === 'start') return;
    if (allocated.has(n.id)) onRemove(findRemoval(tree, allocated, n.id));
    else {
      const path = findPath(tree, allocated, n.id);
      if (path && path.length) onAllocate(path, n.id);
    }
  };
  const onContextMenu = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const n = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (n && onContext) onContext(n);
  };

  useEffect(() => {
    const c = canvasRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const before = toWorld(sx, sy);
      const v = view.current;
      v.zoom = Math.min(1.4, Math.max(0.02, v.zoom * Math.pow(1.0015, -e.deltaY)));
      const after = toWorld(sx, sy);
      v.x += before.x - after.x;
      v.y += before.y - after.y;
      setHover(null);
      schedule();
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(() => { if (!fitted.current) fit(); else schedule(); });
    ro.observe(c);
    fit();
    return () => { c.removeEventListener('wheel', onWheel); ro.disconnect(); cancelAnimationFrame(raf.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  useEffect(() => { schedule(); });
  if (import.meta.env.DEV) window.__atlasDebug = { view: view.current, tree, canvas: canvasRef };

  const zoomBy = (k) => {
    view.current.zoom = Math.min(1.4, Math.max(0.02, view.current.zoom * k));
    schedule();
    force((x) => x + 1);
  };

  // ---------------- подсказка ----------------
  let tooltip = null;
  if (hover && hoverInfo?.node) {
    const n = hoverInfo.node;
    const isAlloc = allocated.has(n.id);
    const chosen = n.variants?.find((v) => String(v.effect) === String(choices?.[n.id]));
    const W = wrapRef.current?.clientWidth || 1000;
    const left = hover.sx + 340 > W ? hover.sx - 340 : hover.sx + 18;
    tooltip = (
      <div className={`atlas-tip tip-${n.type}`} style={{ left, top: Math.max(8, hover.sy - 10) }}>
        <div className="tip-title">{n.name || tx("Начало атласа")}</div>
        <div className="tip-body">
          {n.stats.map((s, i) => <div key={i} className="tip-stat">{s}</div>)}
          {n.variants && (
            <div className="tip-variants">
              {n.variants.map((v) => (
                <div key={v.effect} className={'tip-variant' + (chosen && chosen.effect === v.effect ? ' chosen' : '')}>
                  {v.stats.join(' ')}
                </div>
              ))}
              {!readOnly && <div className="tip-hint">{tx("ПКМ — выбрать вариант")}</div>}
            </div>
          )}
          {n.reminder.map((s, i) => <div key={'r' + i} className="tip-reminder">{s}</div>)}
          {n.flavour.length > 0 && <div className="tip-flavour">{n.flavour.join(' ')}</div>}
          {!readOnly && n.type !== 'mastery' && n.type !== 'start' && (
            <div className="tip-cost">
              {isAlloc
                ? tx("Клик — снять ({0} очк.)", [hoverInfo.removal.length])
                : hoverInfo.path.length
                  ? <>{tx("Клик — взять:")} <b>+{hoverInfo.path.length}</b> {tx("очк.")}{pointsLeft != null && hoverInfo.path.length > pointsLeft && <span className="warn"> {tx("(не хватает очков)")}</span>}</>
                  : tx("Недоступно")}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="atlas-canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="atlas-canvas"
        style={{ cursor: hover && !readOnly ? 'pointer' : drag.current?.moved ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { drag.current = null; setHover(null); }}
        onContextMenu={onContextMenu}
      />
      {tooltip}
      <div className="atlas-zoom">
        <button onClick={() => zoomBy(1.25)} title={tx("Приблизить")}>＋</button>
        <button onClick={() => zoomBy(0.8)} title={tx("Отдалить")}>－</button>
        <button onClick={fit} title={tx("Показать всё")}>⤢</button>
      </div>
    </div>
  );
}
