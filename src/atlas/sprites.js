// Загрузка спрайтов дерева (локальные копии ассетов GGG из public/atlas)
const ZOOM = '0.5';
const cache = new Map();

function localUrl(remote) {
  const file = remote.split('/').pop().split('?')[0];
  return `./atlas/${file}`;
}

function loadImage(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      }),
    );
  }
  return cache.get(url);
}

/** Возвращает { get(category, key) -> {img, x, y, w, h, scale} } после загрузки всех листов. */
export async function loadSprites(raw) {
  const out = {};
  const jobs = [];
  for (const [cat, levels] of Object.entries(raw.sprites)) {
    const level = levels[ZOOM] ? ZOOM : Object.keys(levels).pop();
    const sheet = levels[level];
    const scale = Number(level);
    jobs.push(
      loadImage(localUrl(sheet.filename)).then((img) => {
        out[cat] = { img, coords: sheet.coords, scale };
      }),
    );
  }
  await Promise.all(jobs);
  return {
    get(cat, key) {
      const s = out[cat];
      if (!s || !s.img) return null;
      const c = s.coords[key];
      if (!c) return null;
      return { img: s.img, x: c.x, y: c.y, w: c.w, h: c.h, scale: s.scale };
    },
    raw: out,
  };
}
