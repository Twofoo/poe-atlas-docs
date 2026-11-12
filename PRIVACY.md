# Privacy policy

**This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.**

## What is stored on your computer

PoE Atlas Docs keeps all of its data locally in `%APPDATA%\PoE Atlas Docs\storage`:

- `profiles/` — profile metadata (name, folder, last open tab);
- `trees/` — atlas trees you have planned;
- `docs/` — documents and spreadsheets;
- `.backups/` — a snapshot of all data created on every launch (last 15 are kept);
- `.trash/` — deleted items, moved here instead of being erased.

The data is plain JSON and can be read or backed up at any time.

## Network requests

The application makes network requests **only** when you ask it to:

- **Short links** — when you create or open a short link, the app talks to the short-link service
  (`poeatlas-links.<subdomain>.workers.dev`). The service receives only the encoded tree or profile package
  and a random link ID. It has no accounts, no cookies and no analytics.
- **Open link in browser** — when you explicitly open a link in your browser.

There is no telemetry, no usage statistics, no crash reporting and no auto-update check. The app works fully offline.

## Third-party components

- Atlas tree data and artwork © Grinding Gear Games, from the official
  [atlastree-export](https://github.com/grindinggear/atlastree-export) repository.
- Fonts: Cormorant Garamond / Cormorant SC and Inter (SIL Open Font License).
- Open-source libraries: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Contact

Questions or requests: [open an issue](https://github.com/Twofoo/poe-atlas-docs/issues).
