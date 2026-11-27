/* ═══════════════════════════════════════════════════════════════
   Bloomee Web — app logic
   Backend: Bloomee ka asal data layer — JioSaavn resolver plugin
   (bloom-factory `jisaavn.bex`) ka Node port, /api/* par chalta hai.
   Search / Home / Album / Playlist / Artist / Streams / Radio /
   Lyrics (LRCLIB, `lrcnet.bex`) — sab real.
   Agar backend na mile to demo mode (SoundHelix) fallback hai.
   Likes / playlists / offline / recent: localStorage persisted.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const API = '/api';

/* ── Demo fallback catalogue (backend offline ho to) ── */
const SH = n => `https://www.soundhelix.com/examples/ruby/soundhelix-song-${n}.mp3`;
const DEMO_TRACKS = [
  { id:'t1',  title:'Midnight Bloom',  artist:'Bloomee Band',    album:{id:'',title:'Night Garden'},  src:SH(1),  g:'linear-gradient(135deg,#1ED760,#0D4A3D)', e:'🌸' },
  { id:'t2',  title:'Neon Nights',     artist:'Synthwave Club',  album:{id:'',title:'Afterglow'},     src:SH(2),  g:'linear-gradient(135deg,#7358FF,#539DF5)', e:'🌃' },
  { id:'t3',  title:'Desert Rose',     artist:'Lahore Sessions', album:{id:'',title:'Sand & Strings'},src:SH(3),  g:'linear-gradient(135deg,#D64000,#F3727F)', e:'🌹' },
  { id:'t4',  title:'Ocean Drive',     artist:'Coastal',         album:{id:'',title:'Tide Lines'},    src:SH(4),  g:'linear-gradient(135deg,#0D72EA,#1ED760)', e:'🌊' },
  { id:'t5',  title:'Green Light',     artist:'Encore',          album:{id:'',title:'Play'},          src:SH(5),  g:'linear-gradient(135deg,#088569,#1ED760)', e:'💚' },
  { id:'t6',  title:'Monsoon',         artist:'Karachi Rain',    album:{id:'',title:'Season One'},    src:SH(6),  g:'linear-gradient(135deg,#539DF5,#1ED760)', e:'🌧' },
  { id:'t7',  title:'Golden Hour',     artist:'Sunset Club',     album:{id:'',title:'Dusk'},          src:SH(7),  g:'linear-gradient(135deg,#FFA42B,#D64000)', e:'🌅' },
  { id:'t8',  title:'Echo Chamber',    artist:'Reverb',          album:{id:'',title:'Walls'},         src:SH(8),  g:'linear-gradient(135deg,#CC2FAF,#7358FF)', e:'🔊' },
].map(t => ({ kind:'track', image:'', duration:null, ...t }));
const CATS = [
  ['Pop','linear-gradient(135deg,#1ED760,#0D4A3D)'], ['Hip-Hop','linear-gradient(135deg,#D64000,#F3727F)'],
  ['Rock','linear-gradient(135deg,#E91429,#7358FF)'], ['Chill','linear-gradient(135deg,#539DF5,#1ED760)'],
  ['Workout','linear-gradient(135deg,#FFA42B,#E91429)'], ['Focus','linear-gradient(135deg,#7358FF,#0D72EA)'],
  ['Party','linear-gradient(135deg,#CC2FAF,#FFA42B)'], ['Jazz','linear-gradient(135deg,#0D72EA,#7358FF)'],
];
const TRENDING_SEARCHES = ['Arijit Singh','Atif Aslam','Taylor Swift','Punjabi Hits','Bollywood Romantic','Lo-Fi Beats','AP Dhillon','Old Bollywood'];
const GLOBAL_TRENDING = ['Taylor Swift','The Weeknd','Billie Eilish','Ed Sheeran','Top Hits 2024','Lo-Fi Beats','Arijit Singh','Chill Vibes'];

/* ── Persistent state ── */
const store = {
  get(k, d){ try { return JSON.parse(localStorage.getItem('bloomee:'+k)) ?? d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem('bloomee:'+k, JSON.stringify(v)); } catch {} },
};
let liked = new Set(store.get('liked', []));
let offline = new Set(store.get('offline', []));
let playlists = store.get('playlists', [
  { id:'p1', name:'My Playlist #1', tracks:[], g:'linear-gradient(135deg,#1ED760,#0D4A3D)', e:'🎧' },
]);
let trackLib = store.get('tracklib', {});      // id -> track snapshot (liked/offline/recent ke liye)
let recentIds = store.get('recent', []);       // haal hi mein chalaye gaye
let localTracks = [];                          // user files (session only)
let backendOnline = null;

/* ── Catalog (resolver) selection: Bloomee ke dono plugins ──
   'jiosaavn' = Desi (jisaavn.bex)  |  'ytmusic' = Global (ytmusic.bex) */
let catalog = store.get('source', 'jiosaavn');
const isYtCatalog = () => catalog === 'ytmusic';
const catalogLabel = () => isYtCatalog() ? 'YouTube Music' : 'JioSaavn';
const isYtTrack = t => !!t && (t.source === 'ytmusic' || String(t.id || '').startsWith('yt_'));
const ytVid = t => t.vid || String(t.id || '').replace(/^yt_/, '');

/* ── Runtime state ── */
const trackCache = new Map();                  // id -> track object (is session)
const streamCache = new Map();                 // id -> {url, list[]} stream candidates
let queue = [];
let current = null;
let shuffle = false, repeat = false;
let route = { name:'home' };
let historyStack = [{ name:'home' }];
let searchQuery = '';
let searchType = 'all';
let homeBySource = { jiosaavn: null, ytmusic: null };   // per-catalog home cache
let lyricsState = { forId:null, lines:[], plain:null, loading:false };
let playSeq = 0;

/* ── DOM helpers ── */
const $ = s => document.querySelector(s);
const audio = $('#audio');
const viewEl = $('#view');
const toastEl = $('#toast');
let toastTimer;
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toastEl.classList.remove('show'), 2400);
}
const fmt = s => { if(!isFinite(s)||s==null||s<0) return '—:—'; const m=Math.floor(s/60), r=Math.floor(s%60); return m+':'+String(r).padStart(2,'0'); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = t => (t.title||'?').trim().charAt(0).toUpperCase();

function rememberTracks(items){
  let libDirty = false;
  for(const t of items || []){
    if(!t || t.kind !== 'track' || !t.id) continue;
    trackCache.set(t.id, t);
    if(liked.has(t.id) || offline.has(t.id) || recentIds.includes(t.id)){
      trackLib[t.id] = { id:t.id, kind:'track', title:t.title, artist:t.artist, album:t.album, duration:t.duration, image:t.image, src:t.src, g:t.g, e:t.e, source:t.source, vid:t.vid };
      libDirty = true;
    }
  }
  if(libDirty) saveLib();
}
function saveLib(){
  const keys = Object.keys(trackLib);
  if(keys.length > 300){ for(const k of keys.slice(0, keys.length-300)) delete trackLib[k]; }
  store.set('tracklib', trackLib);
}
function byId(id){
  return trackCache.get(id) || localTracks.find(t=>t.id===id) || trackLib[id] || DEMO_TRACKS.find(t=>t.id===id) || null;
}

/* ── API ── */
async function apiGet(path){
  const ctl = new AbortController();
  const to = setTimeout(()=>ctl.abort(), 15000);
  try {
    const res = await fetch(API + path, { signal: ctl.signal });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  } finally { clearTimeout(to); }
}

/* ── Source-aware endpoints (jiosaavn /api/*  vs  ytmusic /api/yt?action=*) ── */
const homeUrl = () => isYtCatalog() ? '/yt?action=home' : '/home';
function searchUrl(type, q, page = 1){
  const e = encodeURIComponent(q);
  return isYtCatalog() ? `/yt?action=search&q=${e}&type=${type}` : `/search?q=${e}&type=${type}&page=${page}`;
}
function detailUrl(kind, id, source){
  return source === 'ytmusic'
    ? `/yt?action=${kind}&id=${encodeURIComponent(id)}`
    : `/${kind}?id=${encodeURIComponent(id)}`;
}
function syncSourceSwitch(){
  document.querySelectorAll('[data-catalog]').forEach(b => b.classList.toggle('on', b.dataset.catalog === catalog));
}
function switchCatalog(src){
  if(src !== 'jiosaavn' && src !== 'ytmusic') return;
  if(src === catalog){ syncSourceSwitch(); return; }
  catalog = src;
  store.set('source', catalog);
  syncSourceSwitch();
  toast(isYtCatalog() ? '🌍 Global catalog — YouTube Music' : '🇮🇳 Desi catalog — JioSaavn');
  if(route.name === 'detail') go({ name:'home' });
  else render();
}

/* ── Rendering helpers ── */
function artInner(t, emoji){
  const img = t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `${emoji || t.e || '♪'}${img}`;
}
function trackRow(t, i, opts = {}){
  const playing = current && current.id === t.id;
  const isLiked = liked.has(t.id);
  return `<div class="track ${playing?'playing':''}" data-play-track="${esc(t.id)}">
    <span class="idx">${playing ? '<span class="eq"><i></i><i></i><i></i></span>' : (i+1)}</span>
    <span class="thumb" ${t.g?`style="background:${t.g}"`:''}>${artInner(t, initials(t))}</span>
    <span class="meta"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></span>
    <button class="t-btn ${isLiked?'liked':''}" data-like="${esc(t.id)}" title="Like">${isLiked?'♥':'♡'}</button>
    <button class="t-btn" data-add="${esc(t.id)}" title="Add to playlist">＋</button>
    <button class="t-btn" data-offline="${esc(t.id)}" title="Offline list">${offline.has(t.id)?'⬇✓':'⬇'}</button>
    ${opts.removable ? `<button class="t-btn" data-remove-from="${esc(opts.removable)}:${esc(t.id)}" title="Remove">✕</button>` : ''}
    <span class="time">${fmt(t.duration ?? t.dur)}</span>
  </div>`;
}
function cardHTML(item){
  if(!item) return '';
  if(item.kind === 'track'){
    return `<button class="card" data-play-track="${esc(item.id)}">
      <span class="art" ${item.g?`style="background:${item.g}"`:''}>${artInner(item)}<span class="play">▶</span></span>
      <h3>${esc(item.title)}</h3><p>${esc(item.artist)}</p>
    </button>`;
  }
  if(item.kind === 'album'){
    return `<button class="card" data-open-album="${esc(item.id)}" data-source="${esc(item.source || 'jiosaavn')}">
      <span class="art">${artInner(item)}<span class="play">▶</span></span>
      <h3>${esc(item.title)}</h3><p>${item.year ? item.year + ' • ' : ''}${esc(item.artist || 'Album')}</p>
    </button>`;
  }
  if(item.kind === 'playlist'){
    return `<button class="card" data-open-playlist="${esc(item.id)}" data-source="${esc(item.source || 'jiosaavn')}">
      <span class="art">${artInner(item)}<span class="play">▶</span></span>
      <h3>${esc(item.title)}</h3><p>${esc(item.subtitle || item.owner || 'Playlist')}</p>
    </button>`;
  }
  if(item.kind === 'artist'){
    return `<button class="card" data-open-artist="${esc(item.id)}" data-source="${esc(item.source || 'jiosaavn')}">
      <span class="art circle">${artInner(item)}<span class="play">▶</span></span>
      <h3>${esc(item.name)}</h3><p>${esc(item.subtitle || 'Artist')}</p>
    </button>`;
  }
  return '';
}
function section(title, inner, showAll){
  return `<div class="section-head"><h2>${esc(title)}</h2>${showAll?'<span class="show-all">Show all</span>':''}</div>${inner}`;
}
const shelf = items => `<div class="shelf">${items.map(cardHTML).join('')}</div>`;
const rowsOf = tracks => `<div>${tracks.map((t,i)=>trackRow(t,i)).join('')}</div>`;
function skeletonCards(n = 6){
  return `<div class="shelf">${Array.from({length:n}, ()=>'<div class="card skel-card"><span class="art skel"></span><h3 class="skel-line"></h3><p class="skel-line short"></p></div>').join('')}</div>`;
}

/* ── Navigation ── */
function render(){ RENDER[route.name] ? RENDER[route.name]() : renderHome(); syncNav(); }
function go(r){
  if(JSON.stringify(r) === JSON.stringify(route)) { render(); return; }
  historyStack.push(r); route = r; render();
  $('#mainScroll').scrollTop = 0;
}
function syncNav(){
  const parent = route.name === 'detail' ? 'home' : route.name;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active', b.dataset.view===parent));
}


/* Views: views.js mein hain. Player/events/boot: player.js mein. index.html teeno load karta hai. */
