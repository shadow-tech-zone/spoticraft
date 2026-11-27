# 🌐 Bloomee Web — Spotify Design + Bloomee Backend

BloomeeTunes ka **web version** — Spotify design language mein bana
frontend, aur iske peeche **Bloomee ka asal backend**: official
`jisaavn.bex` aur `ytmusic.bex` resolver plugins (bloom-factory)
ka Node.js port. Topbar ke 🇮🇳 **Desi** / 🌍 **Global** switch se
catalog chuno — Desi = JioSaavn, Global = YouTube Music. Choice
`localStorage` mein yaad rehti hai.

## 🔗 Live (Vercel)

- **https://bloomee-web-nine.vercel.app** (production)
- https://bloomee-web-shadow-tech4.vercel.app

> ⚠️ Vercel Deployment Protection (SSO) on hai — link kholne par
> Vercel login aayega. Owner account (`shadow-tech-zone`) se login
> karo, phir app khul jayegi. Public karna ho to: Vercel Dashboard
> → `bloomee-web` → Settings → Deployment Protection → Disable.

## Backend — Bloomee wala hi hai 🎯

BloomeeTunes (Flutter) music ke liye `.bex` plugins use karta hai.
Web version unhi plugins ka JavaScript port hai — wahi endpoints,
wahi parameters, wahi stream decryption:

| Plugin (Flutter) | Web backend | Kya karta hai |
|---|---|---|
| `jisaavn.bex` (`content-resolver`) | `api/_jiosaavn.js` + endpoints | JioSaavn (Desi) — home, search, album/playlist/artist, streams |
| `ytmusic.bex` (`content-resolver`) | `api/_ytmusic.js`, `api/_ytparser.js`, `api/_ytcipher.js` + `api/yt.js` | YouTube Music (Global) — InnerTube home/search/browse, player streams, automix radio |
| `lrcnet.bex` (`lyrics-provider`) | `api/lyrics.js` | LRCLIB se time-synced lyrics (dono catalogs ke liye) |

**YouTube Music streams** bhi plugin jaisi strategy: pehle **IOS /
TVHTML5 direct** googlevideo URLs (browser seedha chala sake),
na chalein to **ANDROID** streams `/api/yt?action=stream` wale
server proxy se (ANDROID User-Agent lazmi hota hai — browser header
bhej nahi sakta). TV signatures `_ytcipher.js` (cipher.rs ka port)
se decode hote hain. Player kisi URL pe error de to **agla
candidate khud try** hota hai.

**Stream decryption** bilkul Bloomee jaisa: `encrypted_media_url` →
DES-ECB decrypt (key `38346591`, pure-JS DES implementation) →
quality URLs **320 / 160 / 96 kbps**. Koi API key nahi chahiye —
plugins wala public flow hi use hota hai.

### API endpoints

| Endpoint | Params | Wapis |
|---|---|---|
| `GET /api/home` | — | Home sections (Trending, modules, New Albums…) |
| `GET /api/search` | `q`, `type=songs\|albums\|artists\|playlists`, `page` | Search results |
| `GET /api/track` | `id` | Track details + stream URLs (320/160/96) |
| `GET /api/album` | `id` | Album + saare tracks |
| `GET /api/playlist` | `id`, `page` | Playlist + tracks |
| `GET /api/artist` | `id` | Artist, top tracks, albums, similar |
| `GET /api/radio` | `id` | Related tracks (autoplay radio, `reco.getreco`) |
| `GET /api/lyrics` | `track`, `artist`, `album`, `duration` | Plain + synced (LRC) lyrics |

**Global catalog (single gateway — plugin ke har function par):**

| Endpoint | Params | Wapis |
|---|---|---|
| `GET /api/yt?action=home` | — | YTM home sections (continuations ke saath) |
| `GET /api/yt?action=search` | `q`, `type=songs\|albums\|artists\|playlists\|all`, `page` | Search results (+ `nextPage`) |
| `GET /api/yt?action=track` | `id` (videoId ya `yt_…`) | Track details + playable streams |
| `GET /api/yt?action=streams` | `id` | Sirf fresh streams |
| `GET /api/yt?action=album` | `id` (`MPRE…`) | Album + tracks |
| `GET /api/yt?action=playlist` | `id` (`VL…/PL…`) | Playlist + tracks |
| `GET /api/yt?action=artist` | `id` (`UC…`) | Artist, top tracks, albums, related |
| `GET /api/yt?action=radio` | `id`, `page` | Automix radio (`RDAMVM<videoId>`) |
| `GET /api/yt?action=more` | `page` (continuation) | Album/playlist next page tracks |
| `GET /api/yt?action=stream` | `url` (googlevideo) | ANDROID-UA stream proxy (sirf `googlevideo.com` / `youtube.com`) |

Har item par `source:"ytmusic"` lagta hai, aur jawab `/api/*` wali
hi shapes mein hota hai — is liye frontend dono catalogs ek hi
code se chalata hai.

Vercel par ye `api/*.js` files **serverless functions** ban jati
hain; locally `server.js` inhi ko chalata hai.

## Chalao (local dev)

```bash
cd web-spotify
node server.js
# browser mein: http://localhost:8000   (static + /api dono)
```

Sirf static dekhna ho to `python3 -m http.server 8000` bhi chalega —
us surat mein `/api` nahi milega aur app **demo mode** (SoundHelix)
mein chal jayega.

## Features

| Section | Kya karta hai |
|---|---|
| **🇮🇳 Desi / 🌍 Global switch** | Topbar se catalog badlo — Desi = JioSaavn, Global = YouTube Music; home/search/detail/player sab source-aware |
| **Home** | Asal home feed (JioSaavn launch data — ya Global mein YTM home shelves), Jump back in (recent), har catalog ka alag cache |
| **Search** | Real search — Songs / Albums / Artists / Playlists tabs; Global mein global trending chips |
| **Album / Playlist / Artist pages** | Card click → poora detail page (dono catalogs), play queue ke saath |
| **Your Library** | Playlists (create, add ＋, remove ✕), Liked Songs |
| **Local Music** | Device ki files choose / drag & drop — browser mein play |
| **Offline** | ⬇ offline list (localStorage) |
| **Player** | JioSaavn 320kbps streams — Global mein YT streams (direct pehle, fail ho to agla candidate / ANDROID proxy), shuffle, repeat, seek, volume, keyboard (Space / ← / →) |
| **Radio autoplay** | Queue khatam ho to milte-julte gaane — JioSaavn `reco.getreco`, Global YT automix (`/api/yt?action=radio`) |
| **Lyrics** | Full player mein time-synced karaoke lyrics (LRCLIB) |

- **Persistence:** Likes, playlists, offline, recent — `localStorage`
- **Design:** Spotify tokens — `#121212` bg, `#181818` cards,
  `#1ED760` green, pill buttons, circular play, 8px radius
- **Fallback:** Backend na mile to demo mode — UI kabhi dead nahi hoti

## Files

| File | Role |
|---|---|
| `index.html` | Layout: sidebar, topbar, views, player bar, full player |
| `styles.css` | Spotify design tokens + responsive (mobile bottom nav) |
| `app.js` | State, API client, render helpers, navigation |
| `views.js` | Home / Search / Library / Local / Offline / Detail views |
| `player.js` | Player, radio, lyrics, likes, global events, boot |
| `api/_jiosaavn.js` | Bloomee jisaavn plugin port: JioSaavn client + DES + mappers |
| `api/_ytmusic.js` | Bloomee ytmusic plugin port: InnerTube client, visitorData, home/search/details/radio, stream ranking |
| `api/_ytparser.js` | `parser.rs` + `mapper.rs` port: InnerTube JSON → track/album/artist shapes |
| `api/_ytcipher.js` | `cipher.rs` port: player-JS discovery + signature decipher (TV streams) |
| `api/yt.js` | YTMusic gateway `/api/yt?action=…` + ANDROID-UA stream proxy |
| `api/*.js` | Serverless endpoints (home, search, track, album, yt, …) |
| `server.js` | Local dev server (static + /api, zero dependencies) |

## Flutter se taaluq

`../web/` wala folder Flutter ka web shell hai; ye `web-spotify/`
**standalone web app** hai. Dono ka design ek hai (Spotify tokens
`../lib/core/theme/spotify_theme.dart`), aur ab **backend bhi ek
hai** — Bloomee ke plugins wala data layer.

## Windows par local chalana (YouTube playback ke liye)

Vercel (datacenter IP) par YouTube player `LOGIN_REQUIRED`
bot-wall deta hai, is liye Windows ke liye local package hai:
**`Start-Bloomee.bat`** double-click karein — launcher zaroorat
par portable Node download karke `server.js` ko PC par chala
deta hai (port 8000), aur browser khol deta hai. Requests ghar
ki IP se jati hain, to YTMusic streams bhi chalte hain
(Bloomee app ki tarah). Tafseel: `README-WINDOWS.md`;
Desktop shortcut ke liye `Create-Desktop-Shortcut.bat`.
