// Построение графа дерева атласа из официального экспорта GGG (grindinggear/atlastree-export).
// Чистый модуль без DOM — используется и в приложении, и в тестах.

const ANGLES_16 = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
const ANGLES_40 = [
  0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135, 140, 150, 160, 170, 180, 190, 200, 210, 220,
  225, 230, 240, 250, 260, 270, 280, 290, 300, 310, 315, 320, 330, 340, 350,
];

export function orbitAngle(count, index) {
  if (count === 16) return (ANGLES_16[index] * Math.PI) / 180;
  if (count === 40) return (ANGLES_40[index] * Math.PI) / 180;
  return (2 * Math.PI * index) / count;
}

export function nodeType(n) {
  if (n.isMastery) return 'mastery';
  if (n.isWormhole) return 'wormhole';
  if (n.isKeystone) return 'keystone';
  if (n.isNotable) return 'notable';
  if (!n.name) return 'start';
  return 'normal';
}

/** Убирает разметку вида [Thread|Threads] -> Threads, [Mirage] -> Mirage */
export function cleanStat(s) {
  return String(s).replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]]+)\]/g, '$1');
}

export function buildTree(raw) {
  const { skillsPerOrbit, orbitRadii } = raw.constants;
  const nodes = new Map();
  let startId = null;

  for (const [id, n] of Object.entries(raw.nodes)) {
    if (id === 'root') continue;
    const g = raw.groups[n.group];
    if (!g) continue;
    const type = nodeType(n);
    const r = orbitRadii[n.orbit];
    const a = orbitAngle(skillsPerOrbit[n.orbit], n.orbitIndex);
    const node = {
      id,
      skill: n.skill,
      name: n.name || '',
      icon: n.icon,
      type,
      stats: (n.stats || []).map(cleanStat),
      reminder: (n.reminderText || []).map(cleanStat),
      flavour: n.flavourText || [],
      variants: n.isMultipleChoiceVariant
        ? (n.variantEffects || []).map((v) => ({ effect: v.effect, stats: v.stats.map(cleanStat) }))
        : null,
      group: n.group,
      orbit: n.orbit,
      angle: a,
      x: g.x + Math.sin(a) * r,
      y: g.y - Math.cos(a) * r,
      out: n.out || [],
      in: n.in || [],
      customArcs: n.connections || [],
      adj: new Set(),
    };
    nodes.set(id, node);
  }

  const rootOut = raw.nodes.root?.out || [];
  startId = rootOut.find((id) => nodes.has(id)) || null;

  // Рёбра (неориентированные). Мастерства не участвуют в графе.
  const edges = [];
  const seen = new Set();
  for (const n of nodes.values()) {
    if (n.type === 'mastery') continue;
    for (const o of [...n.out, ...n.in]) {
      const m = nodes.get(o);
      if (!m || m.type === 'mastery') continue;
      n.adj.add(o);
      m.adj.add(n.id);
      const key = n.id < o ? n.id + ':' + o : o + ':' + n.id;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a: n.id < o ? n.id : o, b: n.id < o ? o : n.id, key });
    }
  }

  // Геометрия рёбер: дуга по орбите группы, кастомная дуга или прямая.
  for (const e of edges) {
    const A = nodes.get(e.a);
    const B = nodes.get(e.b);
    e.hidden = A.type === 'wormhole' && B.type === 'wormhole'; // врата соединены «телепортом»
    const custom =
      A.customArcs.find((c) => c.to === B.id) || B.customArcs.find((c) => c.to === A.id);
    if (A.group === B.group && A.orbit === B.orbit && A.orbit > 0) {
      const g = raw.groups[A.group];
      e.arc = { cx: g.x, cy: g.y, r: orbitRadii[A.orbit] };
    } else if (custom && custom.orbitX != null) {
      const cx = custom.orbitX;
      const cy = custom.orbitY;
      const rA = Math.hypot(A.x - cx, A.y - cy);
      const rB = Math.hypot(B.x - cx, B.y - cy);
      if (Math.abs(rA - rB) < Math.max(rA, rB) * 0.05) e.arc = { cx, cy, r: (rA + rB) / 2 };
    }
  }

  const groups = new Map();
  for (const [gid, g] of Object.entries(raw.groups)) groups.set(Number(gid), g);

  return {
    raw,
    nodes,
    edges,
    groups,
    startId,
    totalPoints: raw.points?.totalPoints ?? 132,
    bounds: { minX: raw.min_x, minY: raw.min_y, maxX: raw.max_x, maxY: raw.max_y },
  };
}

// ---------------- Логика распределения очков (как в игре) ----------------

/**
 * Кратчайший путь от уже взятых узлов до target (BFS от всех взятых сразу).
 * Возвращает массив новых узлов (включая target), которые нужно взять, или null.
 */
export function findPath(tree, allocated, target) {
  if (allocated.has(target)) return [];
  const prev = new Map();
  const queue = [];
  for (const id of allocated) {
    prev.set(id, null);
    queue.push(id);
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === target) break;
    for (const nb of tree.nodes.get(cur).adj) {
      if (prev.has(nb)) continue;
      prev.set(nb, cur);
      queue.push(nb);
    }
  }
  if (!prev.has(target)) return null;
  const path = [];
  for (let c = target; c != null && !allocated.has(c); c = prev.get(c)) path.push(c);
  return path.reverse();
}

/** Какие узлы отвалятся, если снять nodeId (сам узел + всё, что потеряло связь со стартом). */
export function findRemoval(tree, allocated, nodeId) {
  if (nodeId === tree.startId || !allocated.has(nodeId)) return [];
  const reach = new Set([tree.startId]);
  const queue = [tree.startId];
  while (queue.length) {
    const cur = queue.pop();
    for (const nb of tree.nodes.get(cur).adj) {
      if (nb === nodeId || reach.has(nb) || !allocated.has(nb)) continue;
      reach.add(nb);
      queue.push(nb);
    }
  }
  return [...allocated].filter((id) => !reach.has(id));
}

/** Оставляет только узлы, связанные со стартом (чистка после импорта). */
export function normalizeAllocation(tree, ids) {
  const want = new Set(ids.filter((id) => tree.nodes.has(id) && tree.nodes.get(id).type !== 'mastery'));
  want.add(tree.startId);
  const reach = new Set([tree.startId]);
  const queue = [tree.startId];
  while (queue.length) {
    const cur = queue.pop();
    for (const nb of tree.nodes.get(cur).adj) {
      if (reach.has(nb) || !want.has(nb)) continue;
      reach.add(nb);
      queue.push(nb);
    }
  }
  return reach;
}

/** Сводка статов: одинаковые формулировки суммируются по числам. */
export function summarizeStats(tree, allocated, choices = {}) {
  const map = new Map();
  for (const id of allocated) {
    const n = tree.nodes.get(id);
    if (!n) continue;
    let stats = n.stats;
    if (n.variants) {
      const v = n.variants.find((x) => String(x.effect) === String(choices[id])) || null;
      stats = v ? v.stats : [];
    }
    for (const s of stats) {
      for (const line of s.split('\n')) {
        const nums = line.match(/-?\d+(\.\d+)?/g) || [];
        const key = line.replace(/-?\d+(\.\d+)?/g, '#');
        const cur = map.get(key);
        if (cur && cur.nums.length === nums.length) {
          cur.nums = cur.nums.map((v, i) => v + Number(nums[i]));
          cur.count++;
        } else if (!cur) {
          map.set(key, { key, nums: nums.map(Number), count: 1, type: n.type });
        }
      }
    }
  }
  return [...map.values()].map((e) => {
    let i = 0;
    const text = e.key.replace(/#/g, () => {
      const v = e.nums[i++];
      return Number.isInteger(v) ? String(v) : v.toFixed(1);
    });
    return { text, count: e.count, type: e.type };
  });
}
