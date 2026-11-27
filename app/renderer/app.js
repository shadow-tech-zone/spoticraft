/* Bloomee renderer — Spotify-measured UI.
   Renderer sirf render + events; saara data main process (core) se. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const artistsText = (t) => (t.artists || []).map(a => a.name).join(', ');
/* core model artwork ko {url} object deta hai — yahan string banao */
const artUrl = (o) => { const a = o?.artwork; return (typeof a === 'string' ? a : a?.url) || null; };
const fmt = (ms) => { if (!ms && ms !== 0) return '0:00'; const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const api = {};
for (const k of ['home', 'search', 'suggestions', 'track', 'streams', 'album', 'playlist', 'artist', 'radio', 'charts', 'chart', 'lyrics'])
  api[k] = async (...a) => { const r = await window.bloomee.api[k](...a); if (!r.ok) throw new Error(r.error); return r.data; };
const libOp = (op, payload) => window.bloomee.lib.op(op, payload);

/* ════════════ state ════════════ */
const S = {
  lib: null,
  source: 'jiosaavn',
  view: { kind: 'home' },
  history: [], histPos: -1,
  homeCache: null, homeSource: null, chartsCache: null,
  current: null, queue: [], queueIdx: -1, upNext: [],
  queueSourceId: null,
  lyrics: null, lyricsFor: null, lyricsBusy: false,
  rp: { open: false, tab: 'queue' },
  fsLyrics: false,
  skipCount: 0, streamGen: 0,
  userScrollLyr: 0,
};
const audio = $('#audio');

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ════════════ library helpers ════════════ */
const isLiked = (id) => !!S.lib?.liked.some(t => t.id === id);
async function toggleLike(track) {
  await libOp('toggleLike', { track });
  S.lib = await window.bloomee.lib.get();
  renderSidebar();
  refreshLikeUI(track.id);
  toast(isLiked(track.id) ? 'Added to Liked Songs' : 'Removed from Liked Songs');
}
function refreshLikeUI(id) {
  $$(`[data-like="${CSS.escape(id)}"]`).forEach(b => {
    const on = isLiked(id);
    b.classList.toggle('liked', on);
    b.textContent = on ? '♥' : '♡';
  });
  if (S.current?.id === id) renderNpLeft();
}

/* ════════════ navigation ════════════ */
function navigate(view, push = true) {
  closeMenu();
  S.view = view;
  if (push) {
    S.history = S.history.slice(0, S.histPos + 1);
    S.history.push(view);
    S.histPos = S.history.length - 1;
  }
  $('#btn-back').disabled = S.histPos <= 0;
  $('#btn-fwd').disabled = S.histPos >= S.history.length - 1;
  $('#main').scrollTop = 0;
  renderSidebar();
  render();
}
function navBack() { if (S.histPos > 0) { S.histPos--; S.view = S.history[S.histPos]; afterNav(); } }
function navForward() { if (S.histPos < S.history.length - 1) { S.histPos++; S.view = S.history[S.histPos]; afterNav(); } }
function afterNav() {
  $('#btn-back').disabled = S.histPos <= 0;
  $('#btn-fwd').disabled = S.histPos >= S.history.length - 1;
  $('#main').scrollTop = 0;
  renderSidebar();
  render();
}
function viewForItem(item) {
  if (item.kind === 'album') return { kind: 'list', id: item.id, isAlbum: true, title: item.title };
  if (item.kind === 'playlist') return { kind: 'list', id: item.id, isAlbum: false, title: item.title, isChart: !!item._chart };
  if (item.kind === 'artist') return { kind: 'artist', id: item.id, title: item.name };
  return S.view;
}

/* ════════════ shared fragments ════════════ */
const coverImg = (item, cls = '') => artUrl(item)
  ? `<img class="${cls}" src="${esc(artUrl(item))}" alt="" loading="lazy" data-fb="c-tile ${cls}" data-ch="${esc((item.title || item.name || '?').slice(0, 1))}">`
  : `<div class="c-tile ${cls}">${esc((item.title || item.name || '?').slice(0, 1))}</div>`;
const rowCover = (t) => artUrl(t)
  ? `<img src="${esc(artUrl(t))}" alt="" loading="lazy" data-fb="t-tile" data-ch="${esc((t.title || '?').slice(0, 1))}">`
  : `<div class="t-tile">${esc((t.title || '?').slice(0, 1))}</div>`;

/* image load fail → letter tile (CSP-safe, global capture) */
document.addEventListener('error', (e) => {
  const t = e.target;
  if (t.tagName !== 'IMG' || !t.dataset.fb) return;
  const d = document.createElement('div');
  d.className = t.dataset.fb;
  d.textContent = (t.dataset.ch || '?').slice(0, 1);
  t.replaceWith(d);
}, true);

function cardHTML(item) {
  if (item.kind === 'track') regTracks([item]);
  const playingThis = item.kind === 'track' && S.current?.id === item.id;
  const subtitle = item.kind === 'track' ? artistsText(item)
    : item.kind === 'album' ? `${item.year ? item.year + ' • ' : ''}${artistsText(item) || 'Album'}`
    : item.kind === 'playlist' ? (item.author || item.description || 'Playlist')
    : (item.subtitle || 'Artist');
  return `<button class="card ${item.kind === 'artist' ? 'round' : ''}" data-act="open-item" data-kind="${item.kind}" data-id="${esc(item.id)}" data-menu-item='${esc(JSON.stringify(item))}'>
    <div class="c-art">${coverImg(item)}
      <span class="fab ${playingThis ? 'show' : ''}" data-act="card-play" data-id="${esc(item.id)}">${playingThis && !audio.paused ? '❚❚' : '▶'}</span>
    </div>
    <div class="c-title">${esc(item.title || item.name)}</div>
    <div class="c-sub">${esc(subtitle)}</div>
  </button>`;
}

function rowHTML(t, idx, ctxJson) {
  const playing = S.current?.id === t.id;
  return `<div class="trow ${playing ? 'playing' : ''}" data-act="play-row" data-idx="${idx}" data-ctx="${esc(ctxJson)}" data-menu-track="${esc(t.id)}">
    <div class="t-num">${playing && !audio.paused ? '<span class="eq"><i></i><i></i><i></i></span>' : idx + 1}</div>
    <div class="t-main">${rowCover(t)}<div class="t-texts">
      <div class="t-title">${t.isExplicit ? '<span class="badge-e">E</span>' : ''}${esc(t.title)}</div>
      <div class="t-artist">${esc(artistsText(t))}</div></div></div>
    <div class="t-album">${esc(t.album?.title || '')}</div>
    <div class="t-end">
      <button class="like-btn ${isLiked(t.id) ? 'liked' : ''}" data-act="like" data-like="${esc(t.id)}" title="Like">${isLiked(t.id) ? '♥' : '♡'}</button>
      <span>${fmt(t.durationMs)}</span>
      <button class="like-btn" data-act="row-menu" data-id="${esc(t.id)}" title="More">•••</button>
    </div>
  </div>`;
}
const rowsHTML = (tracks) => {
  const ctx = esc(JSON.stringify(tracks.map(t => t.id)));
  return tracks.map((t, i) => rowHTML(t, i, ctx)).join('');
};
const colHead = `<div class="colhead"><span style="text-align:center">#</span><span>Title</span><span>Album</span><span style="text-align:right">Duration</span></div>`;
const skeletons = (n = 7) => Array.from({ length: n }, () => '<div class="skel skel-row"></div>').join('');
const errBox = (msg) => `<div class="center-msg"><h2>Something went wrong</h2><p>${esc(msg)}</p></div>`;

/* ════════════ sidebar ════════════ */
function renderSidebar() {
  if (!S.lib) return;
  const v = S.view;
  $('#nav-home').classList.toggle('active', v.kind === 'home');
  $('#nav-charts').classList.toggle('active', v.kind === 'charts');
  const items = [
    `<button class="librow ${v.kind === 'liked' ? 'active' : ''}" data-act="go-liked">
       <span class="lr-tile liked">♥</span>
       <span class="lr-mid"><div class="lr-title">Liked Songs</div><div class="lr-sub">${S.lib.liked.length} songs</div></span>
     </button>`,
    ...S.lib.playlists.map(p => `<button class="librow ${v.kind === 'local' && v.id === p.id ? 'active' : ''}" data-act="open-local" data-id="${esc(p.id)}" data-menu-local="${esc(p.id)}">
       ${artUrl(p.tracks[0]) ? `<img src="${esc(artUrl(p.tracks[0]))}" alt="" data-fb="lr-tile" data-ch="♪">` : '<span class="lr-tile">♪</span>'}
       <span class="lr-mid"><div class="lr-title">${esc(p.name)}</div><div class="lr-sub">Playlist • ${p.tracks.length} songs</div></span>
     </button>`),
  ];
  $('#lib-list').innerHTML = items.join('');
  $('#src-chips').innerHTML = ['jiosaavn', 'ytmusic'].map(s =>
    `<button class="chip ${S.source === s ? 'on' : ''}" data-act="src" data-src="${s}">${s === 'jiosaavn' ? 'JioSaavn' : 'YouTube Music'}</button>`).join('');
}

/* ════════════ pages ════════════ */
async function render() {
  const v = S.view;
  const el = $('#view');
  document.title = 'Bloomee';
  try {
    if (v.kind === 'home') return await pageHome(el);
    if (v.kind === 'search') return await pageSearch(el);
    if (v.kind === 'list') return await pageList(el, v);
    if (v.kind === 'artist') return await pageArtist(el, v);
    if (v.kind === 'liked') return pageLocalList(el, 'Liked Songs', S.lib.liked, { liked: true });
    if (v.kind === 'local') {
      const p = S.lib.playlists.find(x => x.id === v.id);
      if (!p) { el.innerHTML = errBox('Playlist not found'); return; }
      return pageLocalList(el, p.name, p.tracks, { localId: p.id });
    }
    if (v.kind === 'charts') return await pageCharts(el);
    if (v.kind === 'settings') return pageSettings(el);
  } catch (err) {
    el.innerHTML = errBox(err.message || 'Load failed — internet check karo');
  }
}

async function pageHome(el) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  el.innerHTML = `<h1 class="greet">${greet}</h1><div id="home-body">${skeletons(6)}</div>`;
  if (S.homeCache && S.homeSource === S.source) { fillHome($('#home-body')); return; }
  const sections = await api.home(S.source);
  S.homeCache = sections; S.homeSource = S.source;
  if (S.view.kind === 'home') fillHome($('#home-body'));
}
function fillHome(body) {
  if (!body) return;
  let html = '';
  if (S.lib.recent.length) {
    html += `<h2 class="sec-title">Recently played</h2>${rowsHTML(S.lib.recent.slice(0, 5))}`;
  }
  for (const sec of S.homeCache || []) {
    if (!sec.items?.length) continue;
    const allTracks = sec.items.every(i => i.kind === 'track');
    html += `<h2 class="sec-title">${esc(sec.title)}</h2>` +
      (allTracks ? rowsHTML(sec.items) : `<div class="cards">${sec.items.map(cardHTML).join('')}</div>`);
  }
  body.innerHTML = html || '<div class="center-msg"><h2>Kuch load nahi hua</h2><p>Source switch karke dekho (neeche left).</p></div>';

}

async function pageSearch(el) {
  const v = S.view;
  const chips = [['all', 'All'], ['track', 'Songs'], ['album', 'Albums'], ['playlist', 'Playlists'], ['artist', 'Artists']]
    .map(([f, label]) => `<button class="chip ${v.filter === f ? 'on' : ''}" data-act="filter" data-f="${f}">${label}</button>`).join('');
  el.innerHTML = `<div class="chips" style="margin-bottom:6px">${chips}</div><div id="search-body">${
    v.query ? skeletons(6) : '<div class="center-msg"><h2>Search Bloomee</h2><p>Gaane, album, artist — upar search box mein likho.</p></div>'}</div>`;
  if (!v.query) return;
  const body = $('#search-body');
  const data = await api.search(S.source, v.query, v.filter, 1);
  if (S.view !== v) return;
  let html = '';
  if (v.filter === 'all') {
    if (data.tracks?.length) html += `<h2 class="sec-title">Songs</h2>${rowsHTML(data.tracks)}`;
    if (data.albums?.length) html += `<h2 class="sec-title">Albums</h2><div class="cards">${data.albums.map(cardHTML).join('')}</div>`;
    if (data.playlists?.length) html += `<h2 class="sec-title">Playlists</h2><div class="cards">${data.playlists.map(cardHTML).join('')}</div>`;
    if (data.artists?.length) html += `<h2 class="sec-title">Artists</h2><div class="cards">${data.artists.map(cardHTML).join('')}</div>`;
  } else if (v.filter === 'track') {
    html = `<h2 class="sec-title">Songs</h2>${rowsHTML(data.items || [])}`;
  } else {
    html = `<div class="cards" style="margin-top:14px">${(data.items || []).map(cardHTML).join('')}</div>`;
  }
  body.innerHTML = html || '<div class="center-msg"><h2>Koi result nahi mila</h2><p>Spelling check karo ya doosra source try karo.</p></div>';

}

function heroHTML({ kind, title, meta, artwork, likedTile }) {
  return `<div class="hero" id="hero">
      ${likedTile ? '<div class="h-tile liked">♥</div>' : (artwork
        ? `<img id="hero-img" src="${esc(artwork)}" alt="" data-fb="h-tile" data-ch="${esc((title || '?').slice(0, 1))}">`
        : `<div class="h-tile">${esc((title || '?').slice(0, 1))}</div>`)}
      <div><div class="h-kind">${esc(kind)}</div><div class="h-title">${esc(title)}</div><div class="h-meta">${esc(meta)}</div></div>
    </div>
    <div class="sticky-head" id="sticky-head">
      ${artwork ? `<img src="${esc(artwork)}" alt="">` : ''}
      <span class="sh-title">${esc(title)}</span>
      <button class="playfab" data-act="hero-play" style="width:46px;height:46px;font-size:15px">▶</button>
    </div>`;
}
function applyHeroTint() {
  const img = $('#hero-img');
  const hero = $('#hero');
  if (!img || !hero) return;
  const done = (c) => { hero.style.setProperty('--tint', c); $('#sticky-head')?.style.setProperty('--tint', c); };
  /* alag probe image (CORS ke saath); fail ho to default tint.
     Asal hero img par crossorigin NAHI — warna CORS fail par cover gayab. */
  const probe = new Image();
  probe.crossOrigin = 'anonymous';
  probe.onload = () => {
    try {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 16;
      const cx = cv.getContext('2d');
      cx.drawImage(probe, 0, 0, 16, 16);
      const d = cx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      const f = lum > 0.55 ? 0.5 : lum < 0.06 ? 1.8 : 1;
      done(`rgb(${Math.min(255, r * f | 0)},${Math.min(255, g * f | 0)},${Math.min(255, b * f | 0)})`);
    } catch { done('#3a3a4d'); }
  };
  probe.onerror = () => done('#3a3a4d');
  probe.src = img.src;
}

async function pageList(el, v) {
  el.innerHTML = skeletons(8);
  const d = v.isAlbum ? await api.album(v.id) : (v.isChart ? await chartAsPlaylist(v.id) : await api.playlist(v.id));
  if (S.view !== v) return;
  S.pageData = d;
  const tracks = d.tracks || [];
  const meta = v.isAlbum
    ? `${d.year ? d.year + ' • ' : ''}${artistsText(d)} • ${tracks.length} songs`
    : `${d.author || (v.isChart ? 'Chart' : 'Playlist')} • ${tracks.length} songs`;
  el.innerHTML = heroHTML({ kind: v.isAlbum ? 'Album' : 'Playlist', title: d.title, meta, artwork: artUrl(d) })
    + `<div class="actions"><button class="playfab" data-act="hero-play">▶</button></div>`
    + colHead + rowsHTML(tracks);
  applyHeroTint();

}
async function chartAsPlaylist(id) {
  const tracks = await api.chart(id);
  return { id, title: S.view.title || 'Chart', artwork: artUrl(tracks[0]), author: 'Chart', tracks };
}

async function pageArtist(el, v) {
  el.innerHTML = skeletons(8);
  const d = await api.artist(v.id);
  if (S.view !== v) return;
  S.pageData = d;
  const tops = d.topTracks || d.tracks || [];
  const albums = d.albums || [];
  el.innerHTML = heroHTML({ kind: 'Artist', title: d.name, meta: d.subtitle || 'Artist', artwork: artUrl(d) })
    + `<div class="actions"><button class="playfab" data-act="hero-play">▶</button></div>`
    + (tops.length ? `<h2 class="sec-title">Popular</h2>${rowsHTML(tops)}` : '')
    + (albums.length ? `<h2 class="sec-title">Albums</h2><div class="cards">${albums.map(cardHTML).join('')}</div>` : '')
    + (d.bio ? `<h2 class="sec-title">About</h2><div class="about-box">${esc(d.bio)}</div>` : '');
  applyHeroTint();

}

function pageLocalList(el, title, tracks, opts) {
  const likedTile = !!opts.liked;
  el.innerHTML = heroHTML({ kind: 'Playlist', title, meta: `${tracks.length} songs`, artwork: !likedTile && artUrl(tracks[0]), likedTile })
    + `<div class="actions"><button class="playfab" data-act="hero-play">▶</button>
       ${opts.localId ? `<button class="iconbtn" data-act="local-menu" data-id="${esc(opts.localId)}" title="More">•••</button>` : ''}</div>`
    + colHead
    + (tracks.length ? rowsHTML(tracks)
      : `<div class="center-msg"><h2>Abhi khaali hai</h2><p>Kisi gaane ke ••• menu se “Add to playlist” / dil se Like karo.</p></div>`);

}

async function pageCharts(el) {
  el.innerHTML = `<h1 class="greet">Charts</h1><div id="charts-body">${skeletons(5)}</div>`;
  if (!S.chartsCache || S.chartsSource !== S.source) {
    S.chartsCache = await api.charts(S.source);
    S.chartsSource = S.source;
  }
  if (S.view.kind !== 'charts') return;
  const items = S.chartsCache.map(p => ({ ...p, _chart: true }));
  $('#charts-body').innerHTML = items.length
    ? `<div class="cards">${items.map(cardHTML).join('')}</div>`
    : '<div class="center-msg"><h2>Charts load nahi huay</h2></div>';
}

function pageSettings(el) {
  const s = S.lib.settings;
  el.innerHTML = `<h1 class="greet">Settings</h1>
    <div class="setrow"><div><b>Music source</b><div style="color:var(--t-sub);font-size:12.5px;margin-top:3px">JioSaavn tez streams, YouTube Music bara catalog</div></div>
      <div class="chips">${['jiosaavn', 'ytmusic'].map(x => `<button class="chip ${S.source === x ? 'on' : ''}" data-act="src" data-src="${x}">${x === 'jiosaavn' ? 'JioSaavn' : 'YouTube Music'}</button>`).join('')}</div></div>
    <div class="setrow"><div><b>Close button minimizes to tray</b><div style="color:var(--t-sub);font-size:12.5px;margin-top:3px">Spotify jaisa — band karne par tray mein chala jayega</div></div>
      <button class="switch ${s.closeToTray ? 'on' : ''}" data-act="toggle-tray"></button></div>
    <div class="setrow"><div><b>Logs</b><div style="color:var(--t-sub);font-size:12.5px;margin-top:3px">Masla ho to bloomee.log kaam aayega</div></div>
      <button class="btn" data-act="open-logs">Logs kholo</button></div>
    <div class="setrow"><div><b>Version</b></div><span style="color:var(--t-sub)" id="ver">…</span></div>`;
  window.bloomee.info().then(i => { const v = $('#ver'); if (v) v.textContent = `Bloomee ${i.version} (${i.platform})`; });
}

/* track context registry (rows sirf ids rakhte hain) */
const trackReg = new Map();
function regTracks(tracks) { for (const t of tracks || []) trackReg.set(t.id, t); }
/* ════════════ playback ════════════ */
const QUALITY_KEYS = ['320kbps', '192kbps', '160kbps', '128kbps', '96kbps', '48kbps', '12kbps'];

async function playAt(idx, autoplay = true) {
  const t = S.queue[idx];
  if (!t) return;
  S.queueIdx = idx;
  S.current = t;
  const gen = ++S.streamGen;
  S.lyrics = null; S.lyricsFor = null;
  renderNpLeft(); renderQueuePanel(); repaintPlayingRows();
  window.bloomee.playerState({ playing: false, title: `${t.title} — ${artistsText(t)}` });
  libOp('touchRecent', { track: t }).then(() => window.bloomee.lib.get().then(d => { S.lib = d; renderSidebar(); }));
  let res;
  try {
    res = await api.streams(t);
  } catch (e) {
    if (gen !== S.streamGen) return;
    return maybeSkip('streamFail', e.message);
  }
  if (gen !== S.streamGen) return;
  const list = res?.streams || [];
  if (res?.via?.endsWith('fallback')) toast(`Stream ${res.via.replace('-fallback', '')} se mila — “${res.matched || t.title}”`, 3200);
  const url = pickStream(list);
  if (!url) return maybeSkip('noStream');
  audio.src = url;
  audio.volume = S.lib.settings.volume ?? 0.75;
  setVolUI(audio.volume);
  if (autoplay) audio.play().catch(() => { /* gesture chahiye ho to pause state rahega */ });
  document.title = `${t.title} • ${artistsText(t)}  •  Bloomee`;
  navigator.mediaSession && setMediaSession(t);
  refreshLyricsVisibility();
}

function pickStream(list) {
  if (!Array.isArray(list) || !list.length) return null;
  for (const k of QUALITY_KEYS) {
    const s = list.find(x => x.quality === k) || list.find(x => x.bitrate === k);
    if (s?.url) return s.url;
  }
  const s = list.find(x => x.url);
  return s?.url || null;
}

function maybeSkip(reason, msg) {
  if (++S.skipCount > 3) {
    S.skipCount = 0;
    toast(msg ? `Stream fail: ${msg}` : 'Playback ruk gaya — doosra gaana try karo', 5000);
    return;
  }
  toast(msg ? `Stream fail (${msg.slice(0, 90)}) — agla gaana…` : 'Gaana skip ho raha hai…', 4200);
  next();
}
function next(manual = true) {
  if (S.lib.settings.repeat === 'one' && !manual) { audio.currentTime = 0; audio.play(); return; }
  if (S.upNext.length) {
    const t = S.upNext.shift();
    S.queue.splice(S.queueIdx + 1, 0, t);
    playAt(S.queueIdx + 1);
    return;
  }
  let idx = S.queueIdx + 1;
  if (idx >= S.queue.length) {
    if (S.lib.settings.repeat === 'all') idx = 0;
    else if (S.queue.length) { audio.pause(); audio.currentTime = 0; return; }
    else return;
  }
  playAt(idx);
}
function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (S.queueIdx > 0) playAt(S.queueIdx - 1);
  else audio.currentTime = 0;
}
function playContext(tracks, startIdx, sourceId) {
  if (!tracks?.length) return;
  let list = [...tracks];
  let idx = startIdx;
  if (S.lib.settings.shuffle && startIdx >= 0) {
    const cur = list[startIdx];
    list = [cur, ...list.filter((_, i) => i !== startIdx).sort(() => Math.random() - 0.5)];
    idx = 0;
  }
  S.queue = list;
  S.queueSourceId = sourceId || null;
  S.upNext = [];
  regTracks(list);
  playAt(idx);
}
function playSingle(track) {
  regTracks([track]);
  if (S.queue.some(q => q.id === track.id)) playContext(S.queue, S.queue.findIndex(q => q.id === track.id));
  else playContext([track], 0);
}
async function cardPlay(item) {
  if (item.kind === 'track') {
    const row = $$(`[data-menu-track="${CSS.escape(item.id)}"]`);
    if (row.length) { row[0].click(); return; }
    playSingle(trackReg.get(item.id) || item);
    return;
  }
  const d = item.kind === 'album' ? await api.album(item.id)
    : item._chart ? { tracks: await api.chart(item.id) }
    : await api.playlist(item.id);
  if (d.tracks?.length) playContext(d.tracks, 0, item.id);
}

function setMediaSession(t) {
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: artistsText(t),
      album: t.album?.title || '',
      artwork: artUrl(t) ? [{ src: artUrl(t), sizes: '500x500', type: 'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
  } catch { /* ignore */ }
}

/* ════════════ now playing UI ════════════ */
function renderNpLeft() {
  const t = S.current;
  const el = $('#np-left');
  if (!t) { el.innerHTML = ''; return; }
  el.innerHTML = `${artUrl(t) ? `<img src="${esc(artUrl(t))}" alt="" data-fb="np-tile" data-ch="${esc(t.title.slice(0, 1))}">` : `<div class="np-tile">${esc(t.title.slice(0, 1))}</div>`}
    <div style="min-width:0"><div class="np-title">${esc(t.title)}</div><div class="np-artist">${esc(artistsText(t))}</div></div>
    <button class="like-btn ${isLiked(t.id) ? 'liked' : ''}" style="opacity:1" data-act="like-cur" data-like="${esc(t.id)}">${isLiked(t.id) ? '♥' : '♡'}</button>`;
  $('#btn-play').textContent = audio.paused ? '▶' : '❚❚';
  renderQueuePanel();
}
function repaintPlayingRows() {
  $$('.trow').forEach(r => {
    const id = r.dataset.menuTrack;
    const playing = S.current?.id === id;
    r.classList.toggle('playing', playing);
    const num = r.querySelector('.t-num');
    if (num) num.innerHTML = playing && !audio.paused ? '<span class="eq"><i></i><i></i><i></i></span>' : (Number(r.dataset.idx) + 1);
  });
  $$('.card .fab').forEach(f => {
    const on = S.current?.id === f.dataset.id;
    f.classList.toggle('show', on);
    if (on) f.textContent = audio.paused ? '▶' : '❚❚';
  });
}
function setVolUI(v) { const el = $('#vol'); if (el) el.style.setProperty('--p', v); $('#vol-ic').textContent = v === 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊'; }

/* ════════════ right panel: queue + lyrics ════════════ */
function openRp(tab) {
  S.rp.open = true; S.rp.tab = tab || S.rp.tab;
  $('#shell').classList.add('with-rp');
  $('#rightpanel').classList.remove('hidden');
  $$('.rp-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === S.rp.tab));
  $('#btn-rp-lyrics')?.classList.toggle('on', S.rp.open && S.rp.tab === 'lyrics');
  $('#btn-rp-queue')?.classList.toggle('on', S.rp.open && S.rp.tab === 'queue');
  if (S.rp.tab === 'queue') renderQueuePanel(); else renderLyricsPanel();
}
function closeRp() {
  S.rp.open = false;
  $('#shell').classList.remove('with-rp');
  $('#rightpanel').classList.add('hidden');
  $('#btn-rp-lyrics')?.classList.remove('on');
  $('#btn-rp-queue')?.classList.remove('on');
}
function toggleRp(tab) { (S.rp.open && S.rp.tab === tab) ? closeRp() : openRp(tab); }

function renderQueuePanel() {
  if (!S.rp.open || S.rp.tab !== 'queue') return;
  const body = $('#rp-body');
  const cur = S.current;
  const qrow = (t, mode, i) => `<div class="qrow" data-act="${mode === 'now' ? 'q-now' : mode === 'up' ? 'up-play' : 'q-play'}" data-mode="${mode}" data-i="${i}" data-menu-track="${esc(t.id)}">
      ${artUrl(t) ? `<img src="${esc(artUrl(t))}" alt="" data-fb="q-tile" data-ch="${esc(t.title.slice(0, 1))}">` : `<div class="q-tile">${esc(t.title.slice(0, 1))}</div>`}
      <div style="min-width:0"><div class="q-title" ${mode === 'now' ? 'style="color:var(--green)"' : ''}>${esc(t.title)}</div><div class="q-artist">${esc(artistsText(t))}</div></div>
      ${mode !== 'now' ? `<button class="x" data-act="q-del" data-mode="${mode}" data-i="${i}" title="Remove">✕</button>` : ''}
    </div>`;
  let html = '';
  if (cur) html += `<div class="rp-sec">Now playing</div>${qrow(cur, 'now', S.queueIdx)}`;
  if (S.upNext.length) html += `<div class="rp-sec">Next in queue</div>` + S.upNext.map((t, i) => qrow(t, 'up', i)).join('');
  const rest = S.queue.slice(S.queueIdx + 1);
  if (rest.length) html += `<div class="rp-sec">Up next</div>` + rest.map((t, i) => qrow(t, 'next', S.queueIdx + 1 + i)).join('');
  body.innerHTML = html || '<div class="center-msg"><h2>Queue khaali hai</h2></div>';
}

async function ensureLyrics() {
  const t = S.current;
  if (!t) return;
  if (S.lyricsFor === t.id || S.lyricsBusy) return;
  S.lyricsBusy = true;
  try {
    S.lyrics = await api.lyrics(t);
  } catch { S.lyrics = null; }
  S.lyricsFor = t.id;
  S.lyricsBusy = false;
  renderLyricsPanel();
  if (S.fsLyrics) renderFsLyrics();
}
function refreshLyricsVisibility() {
  if ((S.rp.open && S.rp.tab === 'lyrics') || S.fsLyrics) ensureLyrics();
}
function renderLyricsPanel() {
  if (!S.rp.open || S.rp.tab !== 'lyrics') return;
  const body = $('#rp-body');
  const t = S.current;
  if (!t) { body.innerHTML = '<div class="center-msg"><h2>Pehle gaana chalao</h2></div>'; return; }
  if (!S.lyrics) { body.innerHTML = '<div class="center-msg"><h2>Lyrics dhoondh rahe hain…</h2></div>'; ensureLyrics(); return; }
  if (S.lyrics.synced?.length) {
    body.innerHTML = S.lyrics.synced.map((l, i) => `<div class="lyr-line" data-act="seek-lyr" data-t="${l.t}" data-i="${i}">${esc(l.text || '♪')}</div>`).join('');
    syncLyricsUI();
  } else if (S.lyrics.plain) {
    body.innerHTML = S.lyrics.plain.split('\n').map(l => `<div class="lyr-line on" style="cursor:default">${esc(l) || '&nbsp;'}</div>`).join('');
  } else {
    body.innerHTML = '<div class="center-msg"><h2>Lyrics nahi milay</h2><p>Is gaane ke bol available nahi hain.</p></div>';
  }
}
function syncLyricsUI() {
  const lines = S.lyrics?.synced;
  if (!lines?.length) return;
  const now = audio.currentTime;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) { if (lines[i].t <= now) idx = i; else break; }
  paintSync($$('.lyr-line'), $$('.fs-line'), idx);
}
function paintSync(rpEls, fsEls, idx) {
  for (const els of [rpEls, fsEls]) {
    if (!els.length) continue;
    const prev = els.findIndex(e => e.classList.contains('on'));
    if (prev === idx) continue;
    els.forEach((e, i) => e.classList.toggle('on', i === idx));
  }
  if (Date.now() - S.userScrollLyr < 3500) return;
  const target = document.querySelector('.fslyrics-open .fs-line.on') || document.querySelector('#rp-body .lyr-line.on');
  target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function renderFsLyrics() {
  const box = $('#fslyrics');
  const t = S.current;
  if (!t) { box.classList.add('hidden'); box.classList.remove('fslyrics-open'); return; }
  box.classList.remove('hidden'); box.classList.add('fslyrics-open');
  const lines = S.lyrics?.synced;
  box.innerHTML = `<div>${artUrl(t) ? `<img src="${esc(artUrl(t))}" alt="">` : `<div class="fs-tile">${esc(t.title.slice(0, 1))}</div>`}
      <div class="fs-title">${esc(t.title)}</div><div class="fs-artist">${esc(artistsText(t))}</div>
      <button class="btn" data-act="fs-close" style="margin-top:20px">✕ Band karo (Esc)</button></div>
    <div class="fs-lines">${lines?.length
      ? lines.map((l, i) => `<div class="fs-line" data-act="seek-lyr" data-t="${l.t}" data-i="${i}">${esc(l.text || '♪')}</div>`).join('')
      : `<div class="fs-line on">${S.lyrics?.plain ? esc(S.lyrics.plain).replace(/\n/g, '<br>') : 'Lyrics nahi milay'}</div>`}</div>`;
  syncLyricsUI();
}

/* ════════════ menus / modal ════════════ */
const menuEl = $('#menu');
function closeMenu() { menuEl.classList.add('hidden'); menuEl.innerHTML = ''; }
function openMenu(x, y, items) {
  menuEl.innerHTML = items.map(it => it === 'hr' ? '<hr>' :
    `<button data-act="menu-item" data-m="${esc(it.id)}" ${it.danger ? 'class="danger"' : ''}>${it.check ? '<span class="m-check">✓</span>' : '<span class="m-check"></span>'}${esc(it.label)}</button>`).join('');
  menuEl._items = items;
  menuEl.classList.remove('hidden');
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menuEl.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
function trackMenuItems(t) {
  const items = [
    { id: 'm-play', label: 'Play' },
    { id: 'm-upnext', label: 'Play next' },
    { id: 'm-queue', label: 'Add to queue' },
    'hr',
    { id: 'm-like', label: isLiked(t.id) ? 'Remove from Liked Songs' : 'Save to Liked Songs', check: isLiked(t.id) },
  ];
  for (const p of S.lib.playlists) items.push({ id: `m-addpl:${p.id}`, label: `Add to “${p.name}”` });
  items.push('hr', { id: 'm-radio', label: 'Go to song radio' });
  const art = t.artists?.find(a => a.id);
  if (art) items.push({ id: `m-artist:${art.id}`, label: `Go to artist — ${art.name}` });
  if (t.album?.id) items.push({ id: `m-album:${t.album.id}`, label: 'Go to album' });
  return items;
}
async function menuAction(id) {
  const t = S._menuTrack;
  closeMenu();
  if (!id || !t) { S._menuTrack = null; return; }
  if (id === 'm-play') playSingle(t);
  else if (id === 'm-upnext') { S.upNext.unshift(t); toast('Play next mein dala'); }
  else if (id === 'm-queue') { S.upNext.push(t); toast('Queue mein dala'); }
  else if (id === 'm-like') await toggleLike(t);
  else if (id === 'm-radio') {
    const items = await api.radio(t.id);
    const tracks = items?.items || items || [];
    if (tracks.length) { playContext(tracks, 0, 'radio'); toast('Song radio chal gaya'); }
    else toast('Radio nahi mila');
  }
  else if (id.startsWith('m-addpl:')) {
    await libOp('addToPlaylist', { id: id.slice(8), track: t });
    S.lib = await window.bloomee.lib.get();
    renderSidebar();
    toast('Playlist mein dala');
  }
  else if (id.startsWith('m-artist:')) navigate({ kind: 'artist', id: id.slice(9) });
  else if (id.startsWith('m-album:')) navigate({ kind: 'list', id: id.slice(8), isAlbum: true });
  S._menuTrack = null;
  renderQueuePanel();
}
function showModal(html) { const m = $('#modal'); m.innerHTML = `<div class="modal-card">${html}</div>`; m.classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }
function playlistNameModal(title, initial, cb) {
  showModal(`<h3>${esc(title)}</h3>
    <input id="pl-name" type="text" value="${esc(initial)}" maxlength="60">
    <div class="modal-btns"><button class="btn" data-act="modal-cancel">Cancel</button><button class="btn primary" data-act="modal-ok">Save</button></div>`);
  const input = $('#pl-name');
  input.focus(); input.select();
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { cb(input.value.trim()); closeModal(); } });
  $('#modal [data-act="modal-ok"]').onclick = () => { cb(input.value.trim()); closeModal(); };
}
function confirmModal(title, body, cb) {
  showModal(`<h3>${esc(title)}</h3><p style="color:var(--t-sub);margin-bottom:18px">${esc(body)}</p>
    <div class="modal-btns"><button class="btn" data-act="modal-cancel">Cancel</button><button class="btn dangerb" data-act="modal-del">Delete</button></div>`);
  $('#modal [data-act="modal-del"]').onclick = () => { cb(); closeModal(); };
}

/* ════════════ sliders ════════════ */
function bindSlider(el, getRatio, onSet) {
  let drag = false;
  const set = (e) => {
    const r = el.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    onSet(p);
  };
  el.addEventListener('pointerdown', e => { drag = true; el.classList.add('drag'); el.setPointerCapture(e.pointerId); set(e); });
  el.addEventListener('pointermove', e => { if (drag) set(e); });
  el.addEventListener('pointerup', () => { drag = false; el.classList.remove('drag'); });
  el._ratio = getRatio;
  return el;
}
const seekEl = bindSlider($('#seek'), () => audio.duration ? audio.currentTime / audio.duration : 0,
  p => { if (audio.duration) { audio.currentTime = p * audio.duration; seekEl.style.setProperty('--p', p); } });
const volEl = bindSlider($('#vol'), () => audio.volume,
  p => { audio.volume = p; setVolUI(p); libOp('setSetting', { key: 'volume', value: p }); });

/* ════════════ audio events ════════════ */
audio.addEventListener('play', () => { S.skipCount = 0; $('#btn-play').textContent = '❚❚'; repaintPlayingRows(); syncPlayState(); });
audio.addEventListener('pause', () => { $('#btn-play').textContent = '▶'; repaintPlayingRows(); syncPlayState(); });
audio.addEventListener('ended', () => next(false));
audio.addEventListener('error', () => { if (S.current && audio.src) maybeSkip('audioErr'); });
audio.addEventListener('timeupdate', () => {
  if (audio.duration) seekEl.style.setProperty('--p', audio.currentTime / audio.duration);
  $('#t-cur').textContent = fmt(audio.currentTime * 1000);
  syncLyricsUI();
});
audio.addEventListener('loadedmetadata', () => { $('#t-dur').textContent = fmt(audio.duration * 1000); });
function syncPlayState() {
  window.bloomee.playerState({ playing: !audio.paused, title: S.current ? `${S.current.title} — ${artistsText(S.current)}` : '' });
}

/* ════════════ global click router ════════════ */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  const rowCtx = e.target.closest('[data-menu-track]');
  const cardCtx = e.target.closest('[data-menu-item]');
  const localCtx = e.target.closest('[data-menu-local]');
  if (!el && !e.target.closest('#menu') && !e.target.closest('.searchbox')) { closeMenu(); hideSuggest(); }
  if (!el) return;
  const act = el.dataset.act;

  switch (act) {
    case 'go-home': navigate({ kind: 'home' }); break;
    case 'go-charts': navigate({ kind: 'charts' }); break;
    case 'go-liked': navigate({ kind: 'liked' }); break;
    case 'open-local': navigate({ kind: 'local', id: el.dataset.id }); break;
    case 'back': navBack(); break;
    case 'forward': navForward(); break;
    case 'win-min': window.bloomee.win.min(); break;
    case 'win-max': window.bloomee.win.max(); break;
    case 'win-close': window.bloomee.win.close(); break;
    case 'src': {
      S.source = el.dataset.src;
      await libOp('setSetting', { key: 'source', value: S.source });
      S.homeCache = null; S.chartsCache = null;
      renderSidebar();
      if (S.view.kind === 'settings') pageSettings($('#view')); else render();
      break;
    }
    case 'filter': navigate({ kind: 'search', query: S.view.query, filter: el.dataset.f }); break;
    case 'clear-search': $('#search').value = ''; hideSuggest(); navigate({ kind: 'home' }); break;

    case 'open-item': {
      let item;
      try { item = JSON.parse(el.dataset.menuItem); } catch { break; }
      if (item.kind === 'track') { playSingle(item); break; }
      navigate(viewForItem(item));
      break;
    }
    case 'card-play': {
      e.stopPropagation();
      let item;
      try { item = JSON.parse(cardCtx.dataset.menuItem); } catch { break; }
      try { await cardPlay(item); } catch (err) { toast(err.message); }
      break;
    }
    case 'hero-play': {
      const d = S.pageData;
      const v = S.view;
      if (v.kind === 'list' && d?.tracks?.length) playContext(d.tracks, 0, v.id);
      else if (v.kind === 'artist' && (d?.topTracks || d?.tracks)?.length) playContext(d.topTracks || d.tracks, 0, v.id);
      else if (v.kind === 'liked') playContext(S.lib.liked, 0, 'liked');
      else if (v.kind === 'local') { const p = S.lib.playlists.find(x => x.id === v.id); if (p) playContext(p.tracks, 0, p.id); }
      break;
    }
    case 'play-row': {
      const row = el;
      const menuBtn = e.target.closest('[data-act="row-menu"], [data-act="like"]');
      if (menuBtn) break;
      const ctx = JSON.parse(row.dataset.ctx);
      playContext(ctx.map(id => trackReg.get(id)).filter(Boolean), Number(row.dataset.idx));
      break;
    }
    case 'like': {
      e.stopPropagation();
      const t = trackReg.get(el.dataset.like) || (S.current?.id === el.dataset.like ? S.current : null);
      if (t) await toggleLike(t);
      break;
    }
    case 'like-cur': if (S.current) await toggleLike(S.current); break;
    case 'row-menu': {
      e.stopPropagation();
      const t = trackReg.get(el.dataset.id);
      if (t) { S._menuTrack = t; const r = el.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, trackMenuItems(t)); }
      break;
    }
    case 'menu-item': await menuAction(el.dataset.m); break;

    case 'toggle': if (S.current) { audio.paused ? audio.play() : audio.pause(); } break;
    case 'next': next(true); break;
    case 'prev': prev(); break;
    case 'shuffle': {
      const on = !S.lib.settings.shuffle;
      await libOp('setSetting', { key: 'shuffle', value: on });
      S.lib.settings.shuffle = on;
      $('#btn-shuffle').classList.toggle('on', on);
      toast(on ? 'Shuffle on' : 'Shuffle off');
      break;
    }
    case 'repeat': {
      const order = ['off', 'all', 'one'];
      const nxt = order[(order.indexOf(S.lib.settings.repeat) + 1) % 3];
      await libOp('setSetting', { key: 'repeat', value: nxt });
      S.lib.settings.repeat = nxt;
      paintRepeat();
      toast(nxt === 'off' ? 'Repeat off' : nxt === 'all' ? 'Repeat all' : 'Repeat one');
      break;
    }
    case 'rp-queue': toggleRp('queue'); break;
    case 'rp-lyrics': toggleRp('lyrics'); break;
    case 'rp-tab': openRp(el.dataset.tab); break;
    case 'rp-close': closeRp(); break;
    case 'fs-lyrics': S.fsLyrics = true; renderFsLyrics(); break;
    case 'fs-close': S.fsLyrics = false; $('#fslyrics').classList.add('hidden'); $('#fslyrics').classList.remove('fslyrics-open'); break;
    case 'q-now': break;
    case 'q-play': playAt(Number(el.dataset.i)); break;
    case 'up-play': {
      const t = S.upNext.splice(Number(el.dataset.i), 1)[0];
      if (t) { S.queue.splice(S.queueIdx + 1, 0, t); playAt(S.queueIdx + 1); }
      break;
    }
    case 'q-del': {
      e.stopPropagation();
      const i = Number(el.dataset.i);
      if (el.dataset.mode === 'up') S.upNext.splice(i, 1);
      else if (i > S.queueIdx) S.queue.splice(i, 1);
      renderQueuePanel();
      break;
    }
    case 'seek-lyr': audio.currentTime = Number(el.dataset.t) + 0.01; break;

    case 'new-playlist': {
      playlistNameModal('Create playlist', `My Playlist ${S.lib.playlists.length + 1}`, async (name) => {
        if (!name) return;
        const p = await window.bloomee.lib.op('newPlaylist', { name });
        S.lib = await window.bloomee.lib.get();
        renderSidebar();
        navigate({ kind: 'local', id: p.id });
      });
      break;
    }
    case 'local-menu': {
      const r = el.getBoundingClientRect();
      openMenu(r.left, r.bottom + 4, [
        { id: 'lm-rename', label: 'Rename' },
        { id: 'lm-delete', label: 'Delete playlist', danger: true },
      ]);
      S._menuLocal = el.dataset.id;
      menuEl._items = menuEl._items;
      menuEl.querySelectorAll('[data-act="menu-item"]').forEach(b => b.onclick = async () => {
        const id = b.dataset.m;
        closeMenu();
        if (id === 'lm-rename') {
          const p = S.lib.playlists.find(x => x.id === S._menuLocal);
          playlistNameModal('Rename playlist', p?.name || '', async (name) => {
            if (!name) return;
            await libOp('renamePlaylist', { id: S._menuLocal, name });
            S.lib = await window.bloomee.lib.get();
            renderSidebar(); render();
          });
        } else if (id === 'lm-delete') {
          confirmModal('Delete playlist?', `“${S.lib.playlists.find(x => x.id === S._menuLocal)?.name}” hamesha ke liye delete ho jayegi.`, async () => {
            const wasHere = S.view.kind === 'local' && S.view.id === S._menuLocal;
            await libOp('deletePlaylist', { id: S._menuLocal });
            S.lib = await window.bloomee.lib.get();
            renderSidebar();
            if (wasHere) navigate({ kind: 'liked' }); else render();
          });
        }
      });
      break;
    }
    case 'menu-app': {
      const r = el.getBoundingClientRect();
      openMenu(r.left - 160, r.bottom + 6, [
        { id: 'app-settings', label: 'Settings' },
        { id: 'app-logs', label: 'Open logs' },
        'hr',
        { id: 'app-exit', label: 'Exit Bloomee' },
      ]);
      menuEl.querySelectorAll('[data-act="menu-item"]').forEach(b => b.onclick = () => {
        closeMenu();
        if (b.dataset.m === 'app-settings') navigate({ kind: 'settings' });
        else if (b.dataset.m === 'app-logs') window.bloomee.openLogs();
        else if (b.dataset.m === 'app-exit') window.bloomee.quit();
      });
      break;
    }
    case 'toggle-tray': {
      const on = !S.lib.settings.closeToTray;
      await libOp('setSetting', { key: 'closeToTray', value: on });
      S.lib.settings.closeToTray = on;
      el.classList.toggle('on', on);
      break;
    }
    case 'open-logs': window.bloomee.openLogs(); break;
    case 'modal-cancel': closeModal(); break;
  }
});

document.addEventListener('contextmenu', (e) => {
  const tEl = e.target.closest('[data-menu-track]');
  const cEl = e.target.closest('[data-menu-item]');
  const lEl = e.target.closest('[data-menu-local]');
  if (tEl && (e.target.closest('.trow') || e.target.closest('.qrow'))) {
    e.preventDefault();
    const t = trackReg.get(tEl.dataset.menuTrack);
    if (t) { S._menuTrack = t; openMenu(e.clientX, e.clientY, trackMenuItems(t)); }
  } else if (cEl) {
    e.preventDefault();
    const item = JSON.parse(cEl.dataset.menuItem);
    if (item.kind === 'track') { S._menuTrack = item; openMenu(e.clientX, e.clientY, trackMenuItems(item)); }
    else {
      openMenu(e.clientX, e.clientY, [{ id: 'cm-open', label: 'Open' }, { id: 'cm-play', label: 'Play' }]);
      menuEl.querySelectorAll('[data-act="menu-item"]').forEach(b => b.onclick = async () => {
        closeMenu();
        if (b.dataset.m === 'cm-open') navigate(viewForItem(item));
        else { try { await cardPlay(item); } catch (err) { toast(err.message); } }
      });
    }
  } else if (lEl && e.target.closest('.librow')) {
    e.preventDefault();
    S._menuLocal = lEl.dataset.menuLocal;
    openMenu(e.clientX, e.clientY, [
      { id: 'lm-play', label: 'Play' },
      { id: 'lm-rename', label: 'Rename' },
      { id: 'lm-delete', label: 'Delete playlist', danger: true },
    ]);
    menuEl.querySelectorAll('[data-act="menu-item"]').forEach(b => b.onclick = async () => {
      const id = b.dataset.m;
      closeMenu();
      const p = S.lib.playlists.find(x => x.id === S._menuLocal);
      if (id === 'lm-play' && p) playContext(p.tracks, 0, p.id);
      else if (id === 'lm-rename' && p) playlistNameModal('Rename playlist', p.name, async (name) => {
        if (!name) return;
        await libOp('renamePlaylist', { id: p.id, name });
        S.lib = await window.bloomee.lib.get();
        renderSidebar(); render();
      });
      else if (id === 'lm-delete' && p) confirmModal('Delete playlist?', `“${p.name}” delete ho jayegi.`, async () => {
        await libOp('deletePlaylist', { id: p.id });
        S.lib = await window.bloomee.lib.get();
        renderSidebar();
        if (S.view.kind === 'local' && S.view.id === p.id) navigate({ kind: 'liked' }); else render();
      });
    });
  }
});

function paintRepeat() {
  const b = $('#btn-repeat');
  const on = S.lib.settings.repeat !== 'off';
  b.classList.toggle('on', on);
  b.textContent = S.lib.settings.repeat === 'one' ? '⤸¹' : '⤸';
}

/* ════════════ search / suggestions ════════════ */
const searchInput = $('#search');
let suggestTimer = null;
function hideSuggest() { $('#suggest').classList.add('hidden'); }
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  $('#search-clear').classList.toggle('hidden', !q);
  clearTimeout(suggestTimer);
  if (!q) { hideSuggest(); return; }
  suggestTimer = setTimeout(async () => {
    try {
      const items = await api.suggestions(S.source, q);
      const box = $('#suggest');
      if (!items?.length || document.activeElement !== searchInput) return;
      box.innerHTML = items.map(s => `<button data-act="suggest" data-q="${esc(s)}"><span class="sg-ic">⌕</span>${esc(s)}</button>`).join('');
      box.classList.remove('hidden');
      box.querySelectorAll('[data-act="suggest"]').forEach(b => b.onclick = () => {
        searchInput.value = b.dataset.q;
        hideSuggest();
        doSearch(b.dataset.q);
      });
    } catch { /* ignore */ }
  }, 220);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch(searchInput.value.trim());
  if (e.key === 'Escape') { hideSuggest(); searchInput.blur(); }
});
function doSearch(q, silent) {
  hideSuggest();
  if (!q) { if (!silent) navigate({ kind: 'home' }); return; }
  navigate({ kind: 'search', query: q, filter: 'all' });
}
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.searchbox')) hideSuggest();
  if (!e.target.closest('#menu') && !e.target.closest('[data-act]')) closeMenu();
});

/* ════════════ keyboard ════════════ */
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '');
  if (e.key === 'Escape') {
    if (S.fsLyrics) { S.fsLyrics = false; $('#fslyrics').classList.add('hidden'); $('#fslyrics').classList.remove('fslyrics-open'); return; }
    closeMenu(); closeModal(); hideSuggest();
    return;
  }
  if (typing) return;
  if (e.code === 'Space') { e.preventDefault(); if (S.current) audio.paused ? audio.play() : audio.pause(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'q') { window.bloomee.quit(); }
  else if (e.key === 'ArrowRight' && e.shiftKey) next(true);
  else if (e.key === 'ArrowLeft' && e.shiftKey) prev();
  else if (e.key.toLowerCase() === 'm') { audio.muted = !audio.muted; toast(audio.muted ? 'Muted' : 'Unmuted'); setVolUI(audio.muted ? 0 : audio.volume); }
  else if (e.key === 'F11') { S.fsLyrics = !S.fsLyrics; S.fsLyrics ? renderFsLyrics() : ($('#fslyrics').classList.add('hidden'), $('#fslyrics').classList.remove('fslyrics-open')); }
});
$('#main').addEventListener('scroll', () => {
  const sh = $('#sticky-head');
  const hero = $('#hero');
  if (sh && hero) sh.classList.toggle('show', $('#main').scrollTop > hero.offsetHeight - 90);
});
$('#rp-body').addEventListener('scroll', () => { S.userScrollLyr = Date.now(); });
window.bloomee.playerCmd((cmd) => {
  if (cmd === 'toggle' && S.current) audio.paused ? audio.play() : audio.pause();
  else if (cmd === 'next') next(true);
  else if (cmd === 'prev') prev();
});
window.bloomee.win.onMaxChanged((max) => { $('#win-max').textContent = max ? '❐' : '□'; });

/* ════════════ boot ════════════ */
(async function boot() {
  S.lib = await window.bloomee.lib.get();
  S.source = S.lib.settings.source || 'jiosaavn';
  audio.volume = S.lib.settings.volume ?? 0.75;
  setVolUI(audio.volume);
  $('#btn-shuffle').classList.toggle('on', !!S.lib.settings.shuffle);
  paintRepeat();
  if (S.lib.lastTrack) {
    S.current = S.lib.lastTrack;
    S.queue = [S.lib.lastTrack];
    S.queueIdx = 0;
    renderNpLeft();
  }
  navigate({ kind: 'home' });
})();

