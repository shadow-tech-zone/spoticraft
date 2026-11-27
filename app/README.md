# Bloomee — Native Windows Desktop

Spotify desktop ki measured UI/UX (`docs/spotify-desktop-study.md`) par
bana **native C++ Windows app** — koi WebView/Electron nahi. Ek hi EXE.

## Build (recommended: MSVC)

Developer Command Prompt for Visual Studio kholo (Windows SDK ke saath):

```
cd app
build.cmd
```

Output: `app/build/Bloomee.exe` (icon + manifest embedded).
Montserrat font EXE ke andar embedded hai — system par install karna
zaroori nahi.

Cross-check build (zig, kisi bhi OS se compile-verify):

```
ZIG=/path/to/zig bash tools/build-zig.sh   # → build/Bloomee-zig.exe
```

## Kya-kya hai

- **Layout** — frameless titlebar (logo/back/forward/search/window
  controls), sidebar (Home, Top Charts, Your Library + playlists),
  fluid main column, optional 320px right panel (Queue/Lyrics),
  72px bottom player. 8px panel gaps, 8px corners, DPI-aware, window
  edges se resize, titlebar drag, min 940×580.
- **Design system** — Encore tokens hex-exact (`#121212`, `#1a1a1a`,
  `#242424`, `#b3b3b3`, `#1ed760`/`#1fdf64`/`#169c46`), 2–64 spacing,
  16/14/12 text sizes, embedded **Montserrat** (400/600/700/800/900,
  Spotify Circular ka open metric match).
- **Pages** — Home (greeting + sections + recently played), Search
  (filters All/Songs/Albums/Playlists/Artists + live suggestions),
  Album/Playlist/Chart detail (cover-tint hero — asl cover ka average
  color; 64% scroll par sticky condensed header), Artist (Popular +
  Albums + About), Liked Songs, user playlists, Charts, Settings,
  fullscreen synced-lyrics mode.
- **Playback** — Media Foundation se AAC/MP3 stream + WASAPI output:
  play/pause, seek (click/drag), volume (drag/mute/keys), shuffle,
  repeat/repeat-one, queue + "Next up" + Play Next, auto radio
  continuation jab queue khatam ho, last track app restart par paused
  restore.
- **Data** — JioSaavn (DES-decrypted 320kbps) aur YouTube Music
  (InnerTube + signature cipher), switchable source; LRCLIB synced
  lyrics (click-to-seek, auto-follow, active line highlight);
  covers async; library `%LOCALAPPDATA%\Bloomee\library.json`
  (liked, playlists, recents, settings). Log: `bloomee.log` wahi.
- **Windows behaviours** — tray icon (right-click: Open/Play-Pause/
  Next/Exit; double-click restore), single instance, keyboard
  (Space, Ctrl+←/→ prev/next, ←/→ seek ±5s, ↑/↓ volume, Ctrl+K/L/F
  search, Esc).

## Source layout

| File | Kaam |
|---|---|
| `main.cpp` | WndProc, layout, paint, interaction, queue/state |
| `ui.{h,cpp}` | Direct2D/DirectWrite renderer, embedded fonts, icons, image cache |
| `api.{h,cpp}` | JioSaavn + YouTube Music + LRCLIB (music-api contracts ka C++ port) |
| `des.h` | DES-ECB (JioSaavn `encrypted_media_url`) |
| `player.{h,cpp}` | Media Foundation → WASAPI playback engine |
| `net.{h,cpp}` | WinHTTP |
| `state.{h,cpp}` | Library JSON persistence |
| `model.h`, `common.h` | Unified model + helpers |
| `tools/` | Asset generation (fonts), DES test, host parser tests |

## QA (performed)

- `g++ app/tools/des_test.cpp` — FIPS DES vector + JS-encrypted fixture: **PASS**
- `g++ -I app/tools/hoststub -I app app/tools/api_test.cpp app/api.cpp` —
  fixture parsers (Saavn home/search/streams-decrypt→`_320`,
  YT search): **PASS** (JS `music-api` ke results se match)
- Zig Windows cross-compile + full link of every TU (`-Wall`): **clean**
- `music-api` Node suite (pehle se): 19/19 PASS

## Windows par verify karna baaqi

Sandbox mein Windows run nahi hota — ye items asli machine par dekhna:

1. EXE pehli launch: home load (JioSaavn), koi gaana play/pause/seek,
   volume, next/prev, queue panel, lyrics panel, fullscreen lyrics.
2. Montserrat weights alag nazar aayein (Bold headings vs Regular body);
   agar sab ek jese lagein to Settings → Logs mein `bloomee.log` dekho
   aur batao (font collection fallback hoga).
3. YouTube Music source: search → play (cipher decipher); fail ho to
   `bloomee.log` mein playability lines hain.
4. Tray: minimize/restore, tray Exit; window resize/maximize corners;
   DPI 125%/150% par layout.
5. Close → dobara kholo: last track paused state mein wapas aaye.
