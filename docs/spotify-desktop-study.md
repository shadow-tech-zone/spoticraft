# Spotify Desktop — Complete UI/UX Study (Build Spec)

> Maqsad: native Windows app banane se **pehle** Spotify desktop ki har
> chhoti detail record karna, taake implementation andazay se na ho.
> Sources: (a) current desktop screenshots, (b) 1-to-1 Encore clone ka
> exact CSS/TSX (`index.css`, TopBar/NowPlayingBar/MainContent/Sidebar/
> RightPanel), (c) Encore design-system tokens (official scale values),
> (d) Spotify community/support se verified Windows behaviors.
>
> Confidence tags: **[M]** = measured (CSS/screenshot se exact) ·
> **[D]** = documented (Encore/support) · **[W]** = asal Windows par
> final verify hoga.

---

## 1. Foundations (Encore)

### 1.1 Color tokens [M]
| Token | Value | Istemal |
|---|---|---|
| `--background-base` | `#121212` | panels, main view base |
| `--background-highlight` | `#1a1a1a` | panel hover halka |
| `--background-press` | `#000000` | press state |
| `--background-elevated-base` | `#242424` | menus, dialogs, cards elevated |
| `--background-elevated-highlight` | `#2a2a2a` | elevated hover |
| `--background-elevated-press` | `#181818` | card bg (content cards) |
| window chrome black | `#000000` | poori window ki peeche wali zameen, top/player bar |
| `--text-base` | `#ffffff` | primary text |
| `--text-subdued` | `#b3b3b3` | secondary text (sab se zyada istemal) |
| dimmed text | `#a7a7a7` / `#7c7c7c` | meta, timestamps (`#7c7c7c` bhi observed) |
| `--essential-subdued` | `#727272` | disabled icons/text |
| icon resting | `#b3b3b3` → hover `#ffffff` | player/sidebar icons |
| `--text-bright-accent` / green | `#1ed760` | play FAB, active states, links playing |
| green hover | `#1fdf64` | FAB hover |
| green active/press | `#169c46` | FAB press |
| slider track | `#4d4d4d` | progress/volume khaali hissa |
| search pill bg | `#1f1f1f`, hover `#2a2a2a` | top search |
| home/quick tile chip | `#282828` (chip), tiles white 8% → 16% hover | |
| row hover | `rgba(255,255,255,.06)`; selected/current `rgba(255,255,255,.10)` | track rows |
| hairline | `rgba(255,255,255,.10)` | table header neeche, dividers |
| liked gradient | `#450af5 → #c4efd9` (135°) | Liked Songs cover/hero |
| focus ring | inset `0 0 0 1px #fff` (search), keyboard focus green/white outline | [M/D] |

Browse category tile colors [M]: Podcasts `#006450`, Live Events
`#8400e7`, Made For You `#1e3264`, Charts `#8d67ab`, New Releases
`#e8115b`, Pop `#148a08`, Hip-Hop `#bc5900`, Dance `#d84000`,
Rock `#e91429`, Mood `#ba5d07`, Latin `#e1118b`, R&B `#2d46b9`,
K-pop `#e91429`-family, Chill `#477d95`, Workout `#777777`,
Decades `#ba5d07`, Country `#2d46b9`, Jazz `#0d73ec`, Classical
`#7358ff`, Metal `#777777`, Blues `#0d73ec`, Funk `#e61e32`,
Punk `#e61e32`, Travel `#0d73ec`, Kids `#e13300`-family.

### 1.2 Typography [M/D]
- Family: **SpotifyMixUI** (UI) + **SpotifyMixUITitle** (bade titles);
  metric-compatible stand-in hamare liye **Montserrat** (embedded).
- Base UI size **14px** hai (desktop dense), body text 14/400 `#fff`,
  secondary 14 `#b3b3b3` [M].
- **Type scale (desktop asal)** [M]:
  | Role | Size | Weight | Tracking | Notes |
  |---|---|---|---|---|
  | Hero title (album/playlist/artist) | **dynamic**: ≤7 chars `clamp(44,5.8vw,88)`, ≤14 → 64, ≤24 → 46, ≤38 → 34, else 26 | 900 | −0.02em | 2-line clamp |
  | Home greeting ("Good morning") | 32 | 700 | −0.02em | waqt ke hisaab se badalta |
  | Section title | 24 | 800 | −0.02em | hover par underline |
  | Now Playing panel track title | 22 | 700 | −0.02em | |
  | Browse tile label | 20 | 800 | −0.02em | |
  | Card title | 16 | 700 | normal | 1-line ellipsis |
  | Nav item / library header | 16 | 700 | normal | |
  | Body / row title | 14 (row title 14–16) | 400–600 | normal | playing = green |
  | Chip label | 13 | 600 | normal | height 32 |
  | Quick tile title | 13 | 700 | normal | |
  | Card description / artist line | 13 | 400 | subdued, 2-line clamp | |
  | Meta / eyebrow | 12 | 700 (eyebrow uppercase nahi, bold) | normal | "Playlist" waghera |
  | Caption / time | 11–12 | 400 | subdued | player times 11 |
- Encore official web scale bhi yahi rhythm rakhta hai (16 base web,
  desktop 14 dense) [D]. Display sizes par **−0.02em letter-spacing**
  lazmi hai (DirectWrite `SetCharacterSpacing` se hota hai).

### 1.3 Spacing [D/M]
- Encore spacing scale: **2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64**.
- Panels ke darmiyan gap **8px**; window bahari padding 8 (panels
  black zameen par teerte hain) [M screenshot].
- Main content padding: `24px 32px 64px` (detail par hero full-bleed) [M].
- Section ke darmiyan ~32–40px; section title → cards 16px [M].

### 1.4 Radii / elevation [M]
- Panel radius **8**, card radius **6**, hero cover radius **4**,
  pill **9999**, round buttons 50%.
- Shadows: card hover FAB `0 8px 8px rgba(0,0,0,.3)`; hero cover
  `0 4px 60px rgba(0,0,0,.5)`; NP cover `0 8px 24px rgba(0,0,0,.5)`;
  context menu `0 16px 24px rgba(0,0,0,.3), 0 6px 8px rgba(0,0,0,.2)`;
  sticky header `0 4px 20px rgba(0,0,0,.5)` (scrolled par) [M].

### 1.5 Iconography [M]
- Spotify apne SVG icons 16/24px par istemal karta hai: player
  controls 16 (shuffle/prev/next/repeat), play triangle FAB ke andar
  size ke hisaab se; sidebar nav 24; top bar 20–24; NP panel 16–18.
- Icons filled style, 1.5–2px visual weight; active nav = filled
  variant, inactive = outline variant (Home/Library yahi pattern).
- Explicit badge: chhota `E` box (gray border, 9–10px). Verified
  artist: blue check seal.

### 1.6 Motion [M/D]
- Encore usool: micro-interactions **≤500ms, 60fps** [D].
- Page/section fade-in: **200ms** `cubic-bezier(.3,0,0,1)` +
  `translateY(4px)` se [M `@keyframes fadeIn`].
- Hover color transitions: **150–200ms ease**; FAB hover scale
  **1.04–1.06** (150ms), press scale ~0.98 + green dark [M].
- Card play FAB: hover par **200ms** mein `translateY(8px)→0` +
  opacity 0→1 (neeche-dayein kone mein) [M].
- Panel (right) slide: ~**250–300ms** ease-out, width animated [M/D].
- Sticky detail header: bg **250ms** ease fade, andar ka play+title
  **200ms** opacity/translateY(8px→0) [M].
- Slider thumb: **100ms** opacity; hover par fill green ho jata hai [M].
- EQ (current track): 4 bars, 3px wide, green, alag alag durations
  **0.6–0.8s ease-in-out infinite** (3→14px) [M exact keyframes CSS mein].
- Shuffle/repeat hover scale **1.08** (150ms) [M].
- Heart like: chhoti si pop/scale animation; liked = green fill [D].

---

## 2. Window & Layout Anatomy (Windows)

### 2.1 Overall grid [M]
```
┌────────────────────────────────────────────────┐
│ TopBar 64 (black, window drag + caption btns)  │
├──────────┬──────────────────────┬──────────────┤
│ Sidebar  │ Main view (#121212,  │ Right panel  │
│ 280      │ radius 8, scroll)    │ 320 (opt.)   │
│ (#121212)│                      │ (#121212)    │
├──────────┴──────────────────────┴──────────────┤
│ Player bar 72 (black)                          │
└────────────────────────────────────────────────┘
```
- Body bg **#000**; har panel `#121212` radius 8; panels ke beech
  **8px** gap [M].
- Window min size takreeban **980×660** par usable; is se chhota
  karne par pehle right panel, phir sidebar compact hota hai [M/W].

### 2.2 Windows chrome [M/W]
- Spotify apna title text nahi dikhata; upar ki 64px top bar hi
  drag area hai (khaali jagah), dayein kone mein Windows caption
  buttons (min/max/close) custom-drawn: har button ~46×32, hover
  `#2a2a2a`-ish white 10%, close hover **`#e81123`** white glyph [W].
- Borderless window + DWM shadow; resize kenaron se (6–8px grip) [M].

### 2.3 Left sidebar — "Your Library" [M]
- Upar chhota nav block (purane layout mein Home/Search; naye mein
  sirf **Your Library** panel kyunke search top bar mein hai):
  - Header row: library icon + "Your Library" 16/700 subdued→white
    hover; dayein: **+** (create) aur expand (⇗) buttons 32px ghost.
  - Filter chips row: Playlists / Artists / Albums (+ scroll arrow),
    chip 32h, selected = white bg black text.
  - Search-in-library (chhota input, 28–32h, `#1f1f1f`) + "Recents ▾" sort.
  - List rows: cover **48×48 r4** (artist = circle), title 14–16/600
    white 1-line, neeche 13 subdued ("Playlist • 185 Songs" /
    "Album • Artist" / "Artist"); **pinned item par green pin**;
    current-playing item ka title green + dayein EQ bars / speaker icon.
  - Row height ~64 (8 padding), hover `#1a1a1a`.
- Sidebar width default **280**, drag-resize (210–420 range takreeban),
  bohat tang karne par **72px icon-rail** (sirf covers) [M].
- Neeche sidebar ke andar koi player nahi — player full-width bottom hai.

### 2.4 TopBar (64px, black) [M]
- Baayein: back/forward **32px circles** `#000` 70% bg, chevron 16;
  disabled = 40% opacity, click nahi.
- Center: **Home button 48 circle** (`#1f1f1f`, hover `#282828`,
  icon 24, active state filled white icon) + **Search pill**:
  height 48, width `clamp(200px, 42vw, 520px)`, radius 9999,
  bg `#1f1f1f`, hover `#2a2a2a` + halki border, **focus = white
  inset ring**; andar search icon 20 baayein, placeholder
  "What do you want to play?" 14/500 `#a7a7a7`; type karte hi
  search page khul jata hai, daayein "Browse" (folder) icon alag button.
- Daayein: (naye layout mein) bell (What's New), group (Friend
  Activity), **avatar 28–32 circle**; hamari app mein yahan source
  switch (Desi/Global) + settings avatar ki jagah lega [hamara design
  faisla, Spotify pattern par].
- TopBar ke neeche koi divider nahi; main panel apne radius se juda hai.

### 2.5 Main view [M]
- bg `#121212`, radius 8; sirf yahi area scroll hota hai (custom
  scrollbar: 14px wide, thumb white 30% → hover 50%, sirf hover par
  nazar aata hai, radius 8, transparent track) [M].
- Home par upar ki taraf halka sa **gradient sheen** (cover/dominant
  color se, ~280px mein `#121212` mein ghul jata) [M].

### 2.6 Right panel (Now Playing / Queue / Lyrics) [M]
- Width **320** (`clamp(260px,26vw,320px)`), bg `#121212` radius 8;
  khulta hai to slide-in animation; band karne ka X header mein.
- Header (48–56): context title (playlist naam / "Now Playing")
  15/700 + ellipsis; tabs ki surat mein back arrow + green icon
  (Lyrics mic / Queue list, 18px) + label; daayein more (⋯) + X (18px,
  subdued → white hover).
- **Now Playing view**: body padding 16, gap 16; cover **3:4 aspect,
  260–440h, radius 8**, shadow; phir title **22/700** + artist 14
  subdued; daayein heart + ⋯; neeche cards (radius 8, `#1f1f1f`):
  "About the artist" (photo header 16:9-ish, verified badge, monthly
  listeners **bold white**, bio 2–3 line `#a7a7a7`), "On Tour",
  "Credits", aakhir mein **"Next in Queue"** chhota row (cover 48,
  title, artist, click = queue tab) [M screenshot+clone].
- **Queue view**: "Now Playing" label + current row (green title,
  EQ), "Next Up" / "Next From: {context}" list; rows wahi track-row
  pattern (cover 40, title, artist, duration, hover par play/remove);
  upar daayein "Clear queue" (sirf user queue par) [D/M].
- **Lyrics view** (panel): cover ke rang se rang-bhar background,
  synced lines — active line **white bold bara**, guzri lines
  40–50% opacity, auto scroll center; header mein mic green [M/D].

### 2.7 Player bar (72px, black) [M]
- Grid: `minmax(180px,30%) 1fr minmax(180px,30%)`, padding `0 16px`.
- **Baayein**: cover **56 r4**, title 14/600 (hover underline), artist
  11 subdued (hover white underline), heart 16 (liked = green).
- **Center**: controls gap 22 — shuffle 16, prev 18, **play 32 white
  circle (black triangle, hover scale 1.06, press 0.98-ish)**,
  next 18, repeat 16; active shuffle/repeat = **green + neeche 4px
  dot**; repeat-one = green + chhota "1" badge. Neeche progress row:
  time 11 subdued dono taraf, bar max-width **520–720**, 4px track
  `#4d4d4d`, fill white → hover/drag par **green**, thumb 12 sirf
  hover/drag par.
- **Daayein**: icons 16 gap ~14 — NowPlaying toggle (active = green
  + dot), Lyrics mic, Queue, **Connect (devices)**, volume (icon
  levels: mute/low/high) + **volume slider ~90–125px** (wahi slider
  pattern), PiP, fullscreen.
- Playing track ki progress hamesha chalti hai; seek click/drag dono.

### 2.8 Resize / breakpoints [M]
- Card grid: `minmax(112px,1fr)` gap 14; ≥780px par `minmax(140px,1fr)`
  gap 18; quick tiles: 2 columns, ≥1350px par 4, gap `8×12` [M].
- Track table: `40px 4fr 3fr 2fr 90px` padding `8 16`; <850px par
  date column gayab (`40px 5fr 3fr 80px`); <600 par album bhi gayab [M].
- Player: <850px par PiP/fullscreen/devices gayab, volume 60px;
  <650 par volume gayab [M].

---

## 3. Components (states ke saath)

### 3.1 Buttons [M]
- **Green play FAB** (context play): sizes — card **48**, hero **56**,
  quick tile **36** (tile ke andar), sticky header **44**, search
  top-result **48**. Hamesha: black triangle centered, hover
  `#1fdf64` + scale 1.04–1.06, press `#169c46`. Card par sirf card
  hover par dikhta (200ms rise), lekin **agar us context ka gana baj
  raha ho to hamesha visible + pause icon**.
- **White pill button** (Save/Follow waghera): white bg, black 14/700
  text, hover scale 1.04, press scale 0.98 + gray.
- **Ghost icon buttons**: subdued icon, hover white + scale 1.08
  (player chhote controls), koi bg nahi; active toggle = green + dot.
- **Filter chips**: 32h pill, bg `#232323`-ish white 8–10%, text
  13/600; hover halka bright; selected = **white bg, black text**;
  transition 200ms.

### 3.2 Cards [M]
- **Content card**: bg `#181818`, padding 16, radius 6 (bahari 8 ki
  tarah feel); hover bg `#282828` 200ms; cover square radius 6
  (artist = circle), title 16/700 ellipsis, description 13 subdued
  2-line clamp; FAB bottom-right (cover ke upar overlap).
- **Quick-play tile** (Home upar): height **48**, bg white 8%, hover
  16%, radius 4; baayein cover **48×48**; title 13/700; FAB 36 sirf
  hover par (tile ke daayein).
- **Top result card** (Search): bara card baayein (~40% width), cover
  92, title **32/800**, artist row (avatar 24 + naam bold), neeche
  type chip; hover par FAB 48 bottom-right [M/D].
- **Browse tile**: height ~110–120, radius 8, bold **20/800** white
  label upar-baayein padding 16, **cover art 80×80 rotate(25deg)
  bottom-right corner se bahar kata hua**, shadow [M].

### 3.3 Track rows / table [M]
- Header: `#`, TITLE, ALBUM, DATE ADDED, ⏱ — **12/600 uppercase
  `#a7a7a7`**, letter-spacing halka; neeche 1px hairline; **sticky**
  (scroll par top bar ke neeche chipakta, bg #121212).
- Row: height **56**, padding `0 16`, radius 4 hover zone; index
  16 subdued — hover par play triangle; cover **40 r4**; title 14/600
  white (explicit badge saath), artist 13 subdued (hover underline
  white); album 13 subdued; date 13; duration 13 right-ish; heart
  (sirf hover ya liked=green hamesha) + ⋯ (sirf hover).
- States: hover `white .06`; **current track: title green**, index ki
  jagah **EQ bars** (playing) ya green number (paused); selected row
  (click) `white .10`; double-click = play; right-click = context menu.
- Compact mode (setting): row 40h, cover nahi [D — hamare liye optional].

### 3.4 Sliders [M]
- Track 4px radius 2 `#4d4d4d`; fill white; group hover par fill
  **green** + thumb 12 white (shadow) zahir (100ms); drag ke doran
  bhi yehi. Volume bhi yahi pattern.

### 3.5 Context menu [M/D]
- bg `#282828`, radius 4, padding 4, min-width ~220, shadow gehra;
  item 40h padding `8 12`, 14px text, hover `white .10` radius 2;
  submenu arrow daayein; separators hairline.
- Track menu items: Add to Playlist ▸, Add to Liked Songs, Add to
  Queue, Go to Song Radio, Go to Artist, Go to Album, Share ▸,
  Remove from this Playlist (playlist mein) waghera [D].

### 3.6 Tooltip / Toast / Dialog [D/M]
- Tooltip: black `#282828`? asal mein gehra gray chhota (12px, 4
  radius, shadow), ~400ms hover delay par.
- Toast: neeche center (player ke upar) dark pill `#242424`-ish,
  14px, 2–3s, fade in/out ("Added to Liked Songs" waghera).
- Dialogs (Create playlist waghera): center, `#282828`? asal
  elevated `#242424`, radius 8, title 24/700, input underline style,
  buttons (Cancel ghost / Save white pill).

### 3.7 Scrollbar [M]
- 14px hit-area, asal thumb ~8px visual (4px transparent border
  clip), white 30% → hover 50%, active bhi; **sirf jab content par
  hover/scroll ho tab opacity** aati hai, warna gayab.

---

## 4. Pages

### 4.1 Home [M]
- "Good morning/afternoon/evening" (waqt se) **32/700**; filter
  chips (All / Music / Podcasts — hamare: All / Desi / Global).
- Quick tiles grid (recent/liked/mixes, 6–8 adad).
- Sections: title **24/800** (hover underline) + "Show all" 14/700
  subdued daayein; cards ki ek kataar (horizontal, overflow kata
  hua); Show all → usi section ka full grid page.
- Section kinds: Recently played, Jump back in, Made For You,
  Your top mixes, Popular albums, Artists (circle cards) waghera.

### 4.2 Search [M]
- Kuch type na ho: **"Browse all"** 24/800 + category tiles grid
  (`minmax(180px,1fr)`, gap 24) [M rang list §1.1 mein].
- Type karte hi: chips (All, Songs, Artists, Albums, Playlists);
  **All** layout: baayein Top result card, daayein **Songs top-4**
  list (chhoti rows: cover 40, title, artist, duration, hover play);
  neeche shelves: Artists (circle), Albums, Playlists (cards).
- Songs tab: poori track table; Artists/Albums/Playlists tabs: grids.
- "No results" state: barha title + mashwara text [D].

### 4.3 Detail pages (Album/Playlist/Artist/Liked) [M]
- **Hero**: full-bleed gradient — cover ke **average/dominant rang**
  se shuru, ~hero ke neeche `#121212` mein fade; content bottom-
  aligned: cover **232×232** (`clamp(160px,18vw,232px)`) r4 shadow
  `0 4px 60px rgba(0,0,0,.5)`; eyebrow 12/700 ("Playlist"/"Album");
  title dynamic hero scale (§1.2), 2-line clamp; description 14
  `white .7` 2-line; meta line 14/600: chhota avatar 24 + owner naam
  bold + "• N songs, ~duration" (Liked: user; Album: artist bold
  link + year • songs • duration; Artist: monthly listeners).
- **Action row**: play FAB **56**, (playlist par kabhi shuffle-play
  nahi — wahi FAB), heart/save 32 icon (liked = green), download
  icon (hamare optional), ⋯ 24; gap 24-ish, padding `24px 32px`.
- **Tracklist**: header sticky (§3.3); scroll karne par **condensed
  sticky bar (64px)**: hero rang ka darkened (×0.56) bg, 44px play +
  title 16/700 — 250ms fade se aata hai [M clone exact].
- **Artist page extra**: verified badge naam ke saath; "Popular"
  top-5 tracks (numbered rows, plays count column) + "See more";
  Discography chips (Popular releases/Albums/Singles) + card grid;
  "Fans also like" artists grid; "About" bara card (photo bg, rank,
  monthly listeners, bio) page ke aakhir mein [M/D].
- **Liked Songs**: hero cover gradient tile (♡ bara), baqi wahi pattern.

### 4.4 Library (sidebar ka expand) [D/M]
- Expand karne par library main view mein grid ban jati hai
  (Playlists/Albums/Artists cards + Liked bara tile) [screenshot observed].

### 4.5 Queue / Lyrics (main view) [D]
- Player ke queue button se right panel Queue tab hi khulta hai
  (desktop par yahi asal pattern hai); lyrics mic se right panel
  Lyrics, aur **fullscreen button** se poori screen lyrics +
  cover + controls (background cover-rang) [D].

---

## 5. Interaction & Motion Catalog [M/D]

| Interaction | Behavior | Timing |
|---|---|---|
| Page change (nav) | content 200ms fade + 4px rise | 200ms cubic-bezier(.3,0,0,1) |
| Card hover | bg #181818→#282828, FAB neeche se ubhart | 200ms |
| Quick tile hover | bg 8%→16% white, FAB 36 zahir | 150–200ms |
| Play FAB hover | #1fdf64 + scale 1.04–1.06 | 150ms |
| Icon button hover | subdued→white, scale 1.08 (player) | 150ms |
| Shuffle/Repeat on | green + neeche 4px dot (dot bhi fade se) | 200ms |
| Right panel open/close | width slide, content fade | ~250–300ms ease-out |
| Detail scroll | hero ke baad sticky condensed bar (darkened hero color, 44 play + title) | 250ms bg, 200ms content |
| Table header | scroll par sticky, bg solid | — |
| Slider hover/drag | fill green, thumb zahir | 100ms |
| Row hover | index → play icon; heart/⋯ zahir (opacity) | 150ms |
| Like (heart) | outline → green fill + halki pop scale | ~300ms |
| Search focus | pill white inset ring; results live update (~debounce) | 200ms |
| Toast | neeche se fade/slide, 2–3s baad gayab | 300ms |
| Skeleton/loading | gray blocks pulse (search/detail load par) [D] | 1.2s loop |
| Double-click row | foran play | — |
| Keyboard focus | dikhai dene wala outline (white/green) sirf keyboard nav par | — |

**Global rules** [D]: koi bhi animation 500ms se lambi nahi
(micro-interactions), sab 60fps; hover kabhi layout shift nahi karta
(jo cheez zahir hoti hai wo pehle se jagah rakhti hai ya overlay hai).

## 6. Playback UX Rules [M/D]
- Kisi bhi card/row ka play = usi **context** (album/playlist/home
  section) ki queue banti hai; current context ka item green + EQ.
- Bara play button (hero/FAB) agar wahi context chal raha ho to
  **pause/resume** karta hai, dobara shuru nahi.
- Shuffle: context shuffle (icon green+dot). Repeat: **off → all →
  one** cycle; one par chhota "1" badge.
- Track khatam → next; queue khatam → stop (ya radio/autoplay —
  hamare liye: radio continue) [hamara faisla].
- Volume icon 4 states (mute/low/med/high); mute click → purani
  volume wapas. Progress/volume par mouse wheel bhi chalta hai [D].
- Seek sirf progress bar click/drag; time labels `m:ss`.
- Media keys (keyboard ke play/next/prev) aur Windows volume
  flyout (SMTC) Spotify support karta hai [D] — hamari app mein
  WM_APPCOMMAND + taskbar buttons se cover hoga.

## 7. Windows App Behaviors (verified) [D/W]
- **Tray icon mojood hai**; Settings → Advanced mein "Close button
  should minimize Spotify to the tray" (default **off** — band
  karne se app band hota hai); tray right-click menu; asal Exit
  `Ctrl+Shift+Q` / tray menu se [community verified].
- Single instance: dobara launch → chalti hui window focus [D].
- Window size/position yaad rehti hai; per-monitor DPI par crisp
  (blur nahi) [D/W].
- Installer: web se chhota installer, per-user install
  (`%AppData%`), auto-update khamoshi se [D]. (Hamara scope:
  single EXE + desktop shortcut; auto-update baad ka phase.)
- `spotify:` protocol links aur web se "Open in desktop app" [D —
  hamare liye optional].

## 8. Keyboard Shortcuts (verified, desktop) [D]
| Shortcut | Kaam |
|---|---|
| Space | Play/Pause (typing ke waqt nahi) |
| Ctrl+→ / Ctrl+← | Next / Previous track |
| Ctrl+↑ / Ctrl+↓ | Volume ± |
| Ctrl+Shift+↓ / ↑ | Mute / Full volume |
| Ctrl+L | Search box focus (text select) |
| Alt+← / Alt+→ | Back / Forward |
| Shift+← / → | Seek ∓10s (desktop) |
| Ctrl+S / Ctrl+R | Shuffle / Repeat (kuch builds par Ctrl+Shift+S/R) |
| Ctrl+Shift+Q | Exit (tray mode mein) |
Search box mein type karte waqt bhi Ctrl/Alt wale shortcuts kaam
karte hain; plain Space/arrows text editing ke liye rehte hain.

## 9. Hamari Music API se Mapping
| Spotify page/hissa | music-api endpoint |
|---|---|
| Home sections | `GET /api/home?src=` (jiosaavn launch + ytmusic home) |
| Search (all/songs/albums/playlists/artists) | `GET /api/search` |
| Album/Playlist/Artist pages | `GET /api/album|playlist|artist/{id}` |
| Play (stream resolve) | `GET /api/track/{id}/streams` |
| Go to Radio | `GET /api/radio/{id}` |
| Charts (sidebar/home) | `GET /api/charts` + `/api/charts/{id}` |
| Lyrics panel | `GET /api/lyrics/{trackId}` (synced lines) |
| Suggestions (search typing) | `GET /api/suggestions` |
| Liked/Library/Recents/History | **local** (app ki apni store file) — Spotify bhi ye server se deta hai, hamare paas local-first theek hai |
| Queue | app ke andar (playback state), API nahi chahiye |

IDs har jagah stamped (`jiosaavn::…`, `ytmusic::…`) — UI ko source
alag se yaad nahi rakhna padega.

## 10. Native App Build Checklist (acceptance)
1. Window: borderless + DWM shadow, custom caption buttons
   (close hover red), 64px top bar drag, 980×660 min, DPI v2.
2. Layout: 3 panels (280 / fluid / 320) 8px gaps, panels #121212 r8,
   player 72 black — har size §2 ke mutabiq.
3. Fonts: embedded Montserrat 400/600/700/800/900; hero −0.02em
   tracking (SetCharacterSpacing); sizes §1.2 bilkul wahi.
4. Colors: §1.1 token table 1-to-1; koi naya rang ijazat nahi.
5. Har component §3 ke states ke saath (hover/active/disabled/
   focus/playing) — sirf static look kaafi nahi.
6. Motion §5 ki table ke mutabiq (fade 200ms, FAB rise, panel
   slide, sticky header, EQ bars, slider thumb).
7. Pages §4: Home / Search+ Browse / Detail (sticky header ke
   saath) / Artist / Liked / Library / Queue / Lyrics panel.
8. Playback UX §6 + shortcuts §8 + media keys + taskbar buttons.
9. Data: music-api (local Node server sidecar? ya API ko app ke
   andar port — **faisla app phase ke start mein hoga**), library
   local JSON (liked/playlists/history/recents/volume).
10. QA: har page ka side-by-side screenshot muqabla Spotify se
    (user ki Windows machine par), PE verify, PE resources
    (icon+version+manifest).

*Ye document zinda hai — app banate waqt jo detail galat nikle,
yahan pehle durust hogi, phir code badlega.*
