# Bloomee — Desktop (Electron)

Spotify desktop ki measured UI/UX (`docs/spotify-desktop-study.md`) par bana
**Electron Windows app** — Chromium UI bilkul Spotify ki apni architecture
jaisi (CEF), playback Chromium `<audio>` se, core logic main process mein.

## Architecture

| Layer | File | Kaam |
|---|---|---|
| Main process | `main.js` | Window/tray/single-instance, IPC facade, library store (`userData/library.json`), logs |
| Bridge | `preload.cjs` | Typed `window.bloomee` surface (contextIsolation, koi node renderer mein nahi) |
| Core (main) | `core/*.js` | `music-api` ke tested modules — JioSaavn + YouTube Music sources, DES decrypt, LRCLIB lyrics |
| Renderer | `renderer/*` | Spotify tokens par HTML/CSS/JS UI; state ek jagah, render functions pure-ish |

## Dev

```bash
npm install
npm start          # electron .
```

## Build (Windows)

GitHub Actions (`.github/workflows/build-windows.yml`) har push par is branch
ke liye Windows installer + portable EXE banata hai — artifact run page se
download hota hai. Local Windows par:

```bash
npm run dist       # NSIS installer + portable, dist/ mein
```

Output: `Bloomee-Setup-<version>.exe` (installer) aur
`Bloomee-Portable-<version>.exe` (bina install chalne wala).

## Notes

- Playback Chromium `<audio>` element se hota hai (Spotify desktop bhi yehi
  pattern use karta hai) — is liye system media keys / SMTC `mediaSession`
  API se free milte hain.
- Images seedha CDN se `<img>` mein load hoti hain; fail ho to letter-tile
  fallback (koi gray box nahi).
- User data: `%APPDATA%/Bloomee/library.json` + `bloomee.log`.
