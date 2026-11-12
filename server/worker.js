// Сервер коротких ссылок PoE Atlas Docs — Cloudflare Worker + KV (бесплатный тариф).
//
//  POST /api/links        {code}  -> {id, url}     сохранить пакет, получить короткую ссылку
//  GET  /api/links/:id            -> {code}        получить пакет по короткому коду
//  GET  /:id                      -> HTML-страница, которая открывает ссылку в приложении
//
// Хранит только код пакета (то, что и так передаётся в ссылке poeatlas://b/...). Никаких аккаунтов и cookie.

const MAX_CODE = 900_000; // ~ 0.9 МБ base64 — с запасом для больших таблиц
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // без похожих 0/O, 1/l/I
const ID_LEN = 7;
const ID_RE = /^[A-Za-z0-9]{4,12}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
const text = (msg, status) => new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LEN));
  let s = '';
  for (const b of bytes) s += ID_ALPHABET[b % ID_ALPHABET.length];
  return s;
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function openPage(host, id) {
  const appLink = escapeHtml(`poeatlas://s/${host}/${id}`);
  const webLink = escapeHtml(`https://${host}/${id}`);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PoE Atlas Docs — общая ссылка / shared link</title>
<meta property="og:title" content="PoE Atlas Docs — дерево атласа и документы / atlas tree &amp; documents">
<meta property="og:description" content="Откройте в приложении PoE Atlas Docs · Open in the PoE Atlas Docs app">
<style>body{background:#0b0b0f;color:#ddd6c8;font:15px/1.5 'Segoe UI',sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{max-width:520px;padding:28px;border:1px solid #4a4038;border-radius:10px;background:#131218;text-align:center}
h1{color:#e9c983;font-size:20px;margin-top:0}a.btn{display:inline-block;margin-top:12px;padding:10px 18px;border-radius:6px;background:#5a4520;color:#f3dfb0;text-decoration:none;border:1px solid #7a5f2c}
code{word-break:break-all;font-size:12px;color:#8fd3ff}</style></head>
<body><div class="card"><h1>Открываем в PoE Atlas Docs…<br><small style="font-size:15px;color:#c9a45c">Opening in PoE Atlas Docs…</small></h1>
<p>Если приложение установлено, оно откроется автоматически.<br><span style="color:#8b8478">If the app is installed, it will open automatically.</span></p>
<a class="btn" href="${appLink}">Открыть в приложении · Open in app</a>
<p style="margin-top:18px">Не открылось? Скопируйте ссылку и вставьте её в приложении («Импорт по ссылке»).<br><span style="color:#8b8478">Didn't open? Copy the link and paste it into the app ("Import from link").</span><br><code>${webLink}</code></p>
</div><script>location.href=${JSON.stringify(`poeatlas://s/${host}/${id}`)};</script></body></html>`;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/api/links' && req.method === 'POST') {
      const len = Number(req.headers.get('Content-Length') || 0);
      if (len > MAX_CODE + 100) return text('Слишком большой пакет', 413);
      let code;
      try { ({ code } = JSON.parse(await req.text())); } catch { return text('Неверный JSON', 400); }
      if (typeof code !== 'string' || code.length < 4 || code.length > MAX_CODE || !/^[A-Za-z0-9_-]+$/.test(code)) {
        return text('Неверный код пакета', 400);
      }
      // одинаковые пакеты получают одну и ту же ссылку (экономит лимит записей KV)
      const hashKey = 'h:' + (await sha256(code));
      let id = await env.LINKS.get(hashKey);
      if (!id) {
        for (let i = 0; i < 5 && !id; i++) {
          const candidate = randomId();
          if (!(await env.LINKS.get('l:' + candidate))) id = candidate;
        }
        if (!id) return text('Не удалось создать ссылку, попробуйте ещё раз', 503);
        await env.LINKS.put('l:' + id, code);
        await env.LINKS.put(hashKey, id);
      }
      return json({ id, url: `${url.origin}/${id}` });
    }

    let m = url.pathname.match(/^\/api\/links\/([^/]+)$/);
    if (m && req.method === 'GET') {
      if (!ID_RE.test(m[1])) return text('Неверный код', 400);
      const code = await env.LINKS.get('l:' + m[1]);
      return code ? json({ code }) : text('Не найдено', 404);
    }

    m = url.pathname.match(/^\/([^/]+)\/?$/);
    if (m && req.method === 'GET' && ID_RE.test(m[1])) {
      if (!(await env.LINKS.get('l:' + m[1]))) return text('Ссылка не найдена / Link not found', 404);
      return new Response(openPage(url.host, m[1]), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname === '/' && req.method === 'GET') {
      return text('PoE Atlas Docs — сервер коротких ссылок работает. / Short link server is running.', 200);
    }
    return text('Не найдено', 404);
  },
};
