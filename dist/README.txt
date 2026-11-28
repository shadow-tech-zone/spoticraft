Bloomee v0.2.4 — Electron Desktop App (Windows)
================================================

Ye naya build hai — purana C++/Direct2D wala build hata diya gaya hai.
Study (docs/how-desktop-apps-are-built.md) ke baad stack Electron chuna
gaya: Spotify khud bhi Chromium UI hi use karta hai.

DOWNLOAD (GitHub Actions artifact)
----------------------------------
1. Saare builds ki list kholo (sab se upar wala run = latest):
   https://github.com/shadow-tech-zone/spoticraft/actions/workflows/build-windows.yml
2. Neeche "Artifacts" mein "Bloomee-Windows" download karo (zip, ~221MB)
3. Zip kholo, do files milengi:
   - Bloomee-Setup-0.2.4.exe      → installer (Start menu shortcut ke saath)
   - Bloomee-Portable-0.2.4.exe   → bina install, direct chalne wala

Unsigned app hai — Windows SmartScreen aaye to
"More info" → "Run anyway" dabana.

TEST CHECKLIST
--------------
- Home: greeting + Trending/sections, covers load hone chahiye
- Search: gaana likho, suggestions aayengi, Enter → results
- Play: kisi row/card par click — gaana chalna chahiye
- Album/Playlist/Artist kholo — hero cover tint + gaane
- Dil (♡) → Liked Songs sidebar mein count badhega
- Queue (☰) aur Lyrics (♪) — neeche right ke buttons
- ⛶ → fullscreen synced lyrics
- Restart ke baad last gaana player mein wapas aayega (paused)
- Tray icon: right-click → Play/Pause/Next/Exit

Masla ho to: title bar ke ••• → "Open logs" (bloomee.log khulega),
ya %APPDATA%\Bloomee\bloomee.log bhej do screenshot ke saath.

Data: %APPDATA%\Bloomee\library.json (likes, playlists, settings)
