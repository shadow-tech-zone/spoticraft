# Desktop App Kaisay Banta Hai — Study

_Pehle ki ghalti ka postmortem, asl production apps ka tareeqa, aur
Bloomee ke liye sahi stack ka faisla. Spec: `spotify-desktop-study.md`._

## 1. Saboot: asli apps kaise bane hain

| App | UI technology | Playback | Matlab |
|---|---|---|---|
| **Spotify desktop** | **CEF (Chromium Embedded Framework)** — UI asal mein HTML/CSS/JS hai jo embedded Chromium mein render hota hai (2011 se) [1](https://community.spotify.com/t5/Desktop-Windows/is-the-new-desktop-beta-based-of-off-chromium/td-p/941331) [3](https://www.anycodings.com/1questions/973814/what-language-or-technology-was-used-to-develop-the-spotify-desktop-application) | Native C++ audio engine, custom IPC bridge ("Cosmos") | Spotify khud "native C++ UI" **nahi** hai |
| **BloomeeTunes** | **Flutter** (Dart) + Rust (`flutter_rust_bridge`) — `pubspec.yaml` se verified | `media_kit` (libmpv) + `audio_service` | Isi repo jiska contract hum use kar rahe |
| VS Code, Discord, Slack | Electron (Chromium + Node) | Web/native modules | Industry default for rich desktop UI |
| Tauri apps (boht si modern utilities) | System WebView (Windows par **WebView2** = Chromium) + Rust core | Web audio / native plugins | Chhota size (~5–15MB), rendering phir bhi Chromium [1](https://www.deskifier.com/blog/electron-alternatives-2026) |
| WinUI/WPF (.NET) | XAML + DirectX composition | Windows MediaPlayer | Windows-native rasta, custom design mehenga |

**Framework kya deta hai jo hum ne haath se banaya:** scene graph,
layout engine, text shaping/fallback (HarfBuzz/DirectWrite),
GPU compositing, 60fps animation engine, image pipeline, input
routing, DPI handling, scrolling physics, accessibility. Ek mature
framework "drawing, layout, input, compositing, animation — decades
of hard refined work" pehle se hal kar chuka hai; wahan se shuru
karna hi production tareeqa hai [1](https://starling.build/why.html).

## 2. Postmortem: meri Win32/Direct2D koshish kyun rough lagi

Assignement tha "proper native, no jugaad". Maine sab se mushkil
rasta chuna: **bina framework ke poora rendering stack khud likhna**
(haath ki layout, haath ke icons, haath ki image cache, haath ke
sliders/menus/scroll physics). Nateeja wohi hona tha jo hua:

- Har chhoti cheez (cover cache race, font loading, icon shapes)
  production-quality tak pohchne se pehle hi bug ban gayi.
- UI "chal" to gayi, playback bhi theek — **lekin polish woh nahi**
  jo ek compositor/animation/layout engine muft deta hai.
- Spotify-jaisi UI/UX ki demand (sticky headers, smooth scroll,
  hover lifts, synced lyrics, blur/gradients) web rendering ke
  liye design hui hai; Spotify khud CEF use karta hai taaki yehi
  sab CSS/JS se mile.

Sabak: **"native" ka matlab "bina framework" nahi hota.** Sahi
matlab hai: platform ka proven framework + native jahan zaroorat
(playback/OS integration).

## 3. Framework faisla (Bloomee ke liye)

Constraints: Windows-only, Spotify-identical UI/UX + animations,
music playback (AAC/MP3 streams), hamari `music-api` (JS) pehle se
tested hai, single proper deliverable, messy code dobara nahi.

| | Electron | Tauri 2 | Flutter Desktop | WinUI/WPF |
|---|---|---|---|---|
| Rendering | Bundled Chromium (har machine par ek jaisa) | WebView2 (Chromium; Win11 mein built-in) | Apna renderer (Skia/Impeller), pixel-identical | XAML/DirectX |
| Spotify-jaisi UI ki aasani | **Sab se zyada** (CSS = study doc ke px 1:1) | Sab se zyada (same CSS) | Widgeton mein haath se; framework layout/anim deta hai | Custom controls mehenga |
| Playback | Chromium `<audio>` (AAC/MP3); SMTC extra kaam | WebView2 `<audio>`; Rust se SMTC mumkin | `media_kit`/libmpv — proven (Bloomee) | MediaPlayer built-in |
| Hamari `music-api` JS reuse | **Karreeb 100%** (Node main process) | Frontend JS reuse; native hisse Rust commands | Dart mein port | C# mein port |
| Size/RAM | ~100–200MB / zyada | ~5–15MB / kam [2](https://webcatalog.io/en/blog/electron-vs-tauri) | ~20–60MB | chhota |
| Packaging/update | electron-builder (NSIS) + auto-update mature | Tauri bundler (MSI/NSIS) | MSIX/manual | MSIX |
| Risk | size/RAM | WebView2 purane Win10 par bootstrapper | UI pixel-match waqt leta hai | design custom = slow |

**Meri sifarish: Electron.**
Wajah: (1) Spotify khud Chromium UI hai — CSS se study doc ke saare
measurements (jo hum ne pehle se naape hain) lafz-ba-lafz utarte
hain, animations compositor se 60fps milte hain; (2) `music-api`
ka tested JS (DES, parsers, cipher) baghair rewrite ke chalta hai;
(3) ek hi rendering target — "kisi machine par UI alag" wala risk
khatam; (4) packaging/auto-update ka rasta sab se pakka hai.
Keemat: bara download (~150MB) — music app ke liye normal
(Spotify khud ~300MB+ hai).

**Doosra number: Tauri 2** — agar size sab se aham ho. UI (HTML/CSS)
waisa hi banega, sirf backend Rust hoga aur Win10 par WebView2
runtime ka bootstrapper lagega.

## 4. Sifarish-shuda architecture (jo bhi stack chuno)

```
┌─ UI (HTML/CSS/JS, components = study doc §3) ────────────┐
│   tokens.css (Encore values) · pages · player bar ·       │
│   queue/lyrics panels · animations (transform/opacity)    │
├─ State (single store: playback, queue, library, nav) ────┤
├─ IPC bridge (sirf typed commands/events, kuch aur nahi) ──┤
├─ Core/Main ──────────────────────────────────────────────┤
│   music sources (music-api ports: JioSaavn/YTM/LRCLIB)    │
│   playback controller (engine + SMTC/media keys)          │
│   library store (JSON/SQLite) · image cache (disk)        │
│   tray, single-instance, auto-update, logs                │
└──────────────────────────────────────────────────────────┘
```

Usool: UI sirf render + events; saara logic core mein; har layer
ka apna test. Pehle wala kaam zaya nahi: `music-api` (JS
implementations + 19 tests), `docs/spotify-desktop-study.md`
(measurements = CSS values), DES/cipher ki verified logic.

## 5. Agla plan (stack final hote hi)

1. Scaffold + design tokens + window chrome (frameless, tray)
2. Pages: Home/Search/Detail/Artist/Liked/Charts (study §10 order)
3. Playback + queue model + keyboard + media keys
4. Lyrics synced + right panel + fullscreen mode
5. Library persistence + settings + logs
6. Packaging (installer), har step par screenshot QA

— Stack ka faisla tumhara hai; us ke baad main ruka nahi, ek hi
saans mein bana kar dunga.
