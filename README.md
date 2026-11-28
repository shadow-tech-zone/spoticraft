# Bloomee — Desktop Music App (Windows)

Spotify desktop ki measured UI/UX par bana Electron app: JioSaavn +
YouTube Music sources, gaana kisi bhi source se mile — warna doosre
source se rescue karke bajta hai.

## Download

Har release ka portable build (bina install chalta hai):

**https://github.com/shadow-tech-zone/spoticraft/releases**

`Bloomee-Portable-<version>.exe` download karo aur run karo.
Unsigned app hai — SmartScreen par *More info → Run anyway*.

## Khaas batein

- Spotify-measured UI (Encore tokens, `docs/spotify-desktop-study.md`)
- Do sources: **JioSaavn** (tez, reliable streams) + **YouTube Music**
  (bara catalog) — ek fail to doosra rescue
- Synced lyrics (LRCLIB), queue, playlists, liked songs, radio
- System tray, media keys, last-track restore
- Library/data: `%APPDATA%\Bloomee\` (`library.json`, `bloomee.log`)

## Repo layout

- [`app/`](app/) — Electron app (`main.js`, `preload.cjs`, `renderer/`,
  `core/` = tested music API modules)
- [`music-api/`](music-api/) — unified Music API (Node, 19/19 tests) —
  app ke core ki reference implementation
- [`test/`](test/) — live playback tests: resolver E2E, Electron smoke
  (asal app mein gaana play), UI screenshot reports (`test/results/`)
- [`docs/`](docs/) — Spotify desktop study + desktop apps kaise bante
  hain (architecture research)

## Quality gates

Koi release bina test ke nahi: GitHub Actions pehle live stream tests +
Electron smoke (asal `<audio>` playback, currentTime verify) chalata
hai; pass ho tab hi Windows build + release publish hota hai.
