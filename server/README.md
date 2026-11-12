# Short-link server (Cloudflare Worker)

A tiny, free Cloudflare Worker that turns long `poeatlas://b/…` packages into short links like
`https://poeatlas-links.<your-subdomain>.workers.dev/k7Qx2aB`.

- Stores **only** the encoded package (the same data that a full link already contains). No accounts, no cookies.
- Short links are clickable in Discord and Telegram; the page they open launches the app.
- Identical packages get the same short link (saves KV writes).
- Cloudflare's free tier is plenty: ~500 new links and 100,000 opens per day.

## API

| Method | Path | Result |
| --- | --- | --- |
| `POST` | `/api/links` with `{ "code": "<package>" }` | `{ "id", "url" }` |
| `GET` | `/api/links/:id` | `{ "code" }` |
| `GET` | `/:id` | HTML page that opens `poeatlas://s/<host>/<id>` in the app |

## Deploy your own (≈10 minutes, once)

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. From the `server/` folder run:

```bash
npx wrangler login
```

```bash
npx wrangler kv namespace create LINKS
```

   Put the printed `id` into `wrangler.toml` (the `[[kv_namespaces]]` section).

```bash
npx wrangler deploy
```

   On the first deploy Wrangler asks you to pick a `workers.dev` subdomain. At the end it prints your server address,
   e.g. `https://poeatlas-links.<subdomain>.workers.dev` — opening it should say *“Short link server is running.”*

3. Connect the app to your server:
   - **For everyone who downloads your build:** set `DEFAULT_SHORTENER` in `src/config.js` and rebuild (`npm run dist`);
   - **Only for yourself:** ⚙ Settings → *Short link server*.

> On Windows PowerShell, if `npx` is blocked by the execution policy, use `npx.cmd` instead.

## Run locally (no account needed)

```bash
cd server && npx wrangler dev --local --port 8787
```

Then set `http://127.0.0.1:8787` as the short link server in the app settings. `npm test` also uses this local server
for the short-link test when it is running.
