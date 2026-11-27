/* ── Views ── */
function renderHome(){
  const hour = new Date().getHours();
  const greet = hour<12 ? 'Good morning' : hour<18 ? 'Good afternoon' : 'Good evening';
  const recent = recentIds.map(byId).filter(Boolean);
  const secs = homeBySource[catalog];
  viewEl.innerHTML = `
    <div class="chips"><button class="chip on">All</button><button class="chip" data-soon>Music</button><button class="chip" data-soon>Podcasts</button></div>
    <h1>${greet}</h1>
    <p class="sub">${backendOnline === false ? 'Demo mode — backend offline hai.' : `Bloomee backend live hai — asal gaane, ${catalogLabel()} resolver se.`} 🎧</p>
    ${recent.length ? section('Jump back in', shelf(recent.map(t=>({ ...t })))) : ''}
    <div id="homeSections">${secs ? renderApiSections(secs) : skeletonCards(10)}</div>`;
  if(!secs) loadHome();
}
function renderApiSections(sections){
  return sections.map(s => section(s.title, shelf(s.items), s.id==='new_trending'||s.id==='new_albums')).join('');
}
async function loadHome(){
  const key = catalog;
  try {
    const data = await apiGet(homeUrl());
    backendOnline = true;
    homeBySource[key] = data.sections;
    for(const s of data.sections) rememberTracks(s.items);
    if(route.name === 'home') renderHome();
  } catch(e) {
    backendOnline = false;
    homeBySource[key] = [{ id:'demo', title:'Made For You (Demo)', items: DEMO_TRACKS }];
    rememberTracks(DEMO_TRACKS);
    if(route.name === 'home'){ renderHome(); toast('Backend offline — demo mode chal raha hai'); }
  }
}

let searchSeq = 0;
function renderSearch(){
  const q = searchQuery.trim();
  if(!q){
    const cats = CATS.map(([n,g])=>`<button class="cat" data-cat="${esc(n)}" style="background:${g}">${n}</button>`).join('');
    const trendList = isYtCatalog() ? GLOBAL_TRENDING : TRENDING_SEARCHES;
    const trend = trendList.map(t=>`<button class="chip" data-cat="${esc(t)}">${esc(t)}</button>`).join('');
    viewEl.innerHTML = `
      <h1>Search</h1>
      <p class="sub">Asal search — Bloomee ke ${catalogLabel()} resolver se. Upar likhna shuru karo.</p>
      ${section('Trending searches', `<div class="chips">${trend}</div>`)}
      ${section('Browse all', `<div class="cats">${cats}</div>`)}`;
    return;
  }
  const tabs = [['all','All'],['songs','Songs'],['albums','Albums'],['artists','Artists'],['playlists','Playlists']]
    .map(([v,l])=>`<button class="chip ${searchType===v?'on':''}" data-stype="${v}">${l}</button>`).join('');
  viewEl.innerHTML = `
    <h1>Search</h1>
    <p class="sub">Results for “${esc(searchQuery)}”</p>
    <div class="chips">${tabs}</div>
    <div id="searchResults">${skeletonCards(6)}</div>`;
  runSearch(q, searchType);
}
async function runSearch(q, type){
  const seq = ++searchSeq;
  const el = () => $('#searchResults');
  try {
    if(type !== 'all'){
      const d = await apiGet(searchUrl(type, q));
      if(seq !== searchSeq || !el()) return;
      backendOnline = true;
      rememberTracks(d.results);
      el().innerHTML = d.results.length
        ? (type === 'songs' ? rowsOf(d.results) : shelf(d.results))
        : `<div class="empty"><b>No results found</b><p>Spelling check karo, ya kam keywords use karo.</p></div>`;
      return;
    }
    const [songs, albums, artists, playlists] = await Promise.allSettled([
      apiGet(searchUrl('songs', q)),
      apiGet(searchUrl('albums', q)),
      apiGet(searchUrl('artists', q)),
      apiGet(searchUrl('playlists', q)),
    ]);
    if(seq !== searchSeq || !el()) return;
    backendOnline = true;
    let html = '';
    if(songs.status === 'fulfilled' && songs.value.results.length){ rememberTracks(songs.value.results); html += section('Songs', rowsOf(songs.value.results.slice(0, 8))); }
    if(artists.status === 'fulfilled' && artists.value.results.length) html += section('Artists', shelf(artists.value.results));
    if(albums.status === 'fulfilled' && albums.value.results.length){ rememberTracks(albums.value.results); html += section('Albums', shelf(albums.value.results)); }
    if(playlists.status === 'fulfilled' && playlists.value.results.length) html += section('Playlists', shelf(playlists.value.results));
    el().innerHTML = html || `<div class="empty"><b>No results found for “${esc(q)}”</b><p>Make sure your words are spelled correctly, or use fewer keywords.</p></div>`;
  } catch(e) {
    if(seq !== searchSeq || !el()) return;
    backendOnline = false;
    const results = DEMO_TRACKS.filter(t=>(t.title+' '+t.artist).toLowerCase().includes(q.toLowerCase()));
    el().innerHTML = `<p class="sub">⚠️ Backend offline — demo results:</p>` +
      (results.length ? rowsOf(results) : `<div class="empty"><b>No results found</b><p>Backend bhi offline hai aur demo mein bhi kuch nahi mila.</p></div>`);
  }
}

function renderLibrary(){
  const likedTracks = [...liked].map(byId).filter(Boolean);
  const pls = playlists.map(p=>`
    <button class="card" data-open-userpl="${esc(p.id)}">
      <span class="art" style="background:${p.g}">${p.e||'🎧'}<span class="play">▶</span></span>
      <h3>${esc(p.name)}</h3><p>${p.tracks.length} songs</p>
    </button>`).join('');
  const likedCard = `
    <button class="card" data-open-liked>
      <span class="art" style="background:linear-gradient(135deg,#7358FF,#539DF5)">♥<span class="play">▶</span></span>
      <h3>Liked Songs</h3><p>${likedTracks.length} songs</p>
    </button>`;
  viewEl.innerHTML = `
    <h1>Your Library</h1>
    <p class="sub">Tumhari playlists aur liked songs — localStorage mein save hote hain.</p>
    <div style="margin:12px 0"><button class="pill-btn" id="newPlaylist">+ New playlist</button></div>
    ${section('Playlists', `<div class="shelf">${likedCard}${pls}</div>`)}
    ${likedTracks.length ? section('Liked Songs', rowsOf(likedTracks)) : ''}`;
  $('#newPlaylist')?.addEventListener('click', createPlaylist);
}

function renderLocal(){
  const rows = localTracks.length ? localTracks.map((t,i)=>trackRow(t,i)).join('')
    : `<div class="empty"><b>No local music yet</b><p>Apni device se MP3 / audio files choose karo —<br>wo browser mein hi play hongi, upload nahi hoti.</p></div>`;
  viewEl.innerHTML = `
    <h1>Local Music</h1>
    <p class="sub">Apne device ki files play karo — 100% private, browser mein hi.</p>
    <div class="dropzone" id="dropzone">
      <b>🎵 Choose audio files</b>
      <p>Click karo ya files yahan drag &amp; drop karo<br>MP3, WAV, OGG, M4A supported</p>
      <input type="file" id="fileInput" accept="audio/*" multiple hidden>
    </div>
    ${section('On this device', `<div>${rows}</div>`)}`;
  const dz = $('#dropzone'), fi = $('#fileInput');
  dz.addEventListener('click', ()=>fi.click());
  fi.addEventListener('change', ()=>addFiles(fi.files));
  dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', ()=>dz.classList.remove('over'));
  dz.addEventListener('drop', e=>{ e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer.files); });
}
function addFiles(files){
  const audioFiles = [...files].filter(f=>f.type.startsWith('audio') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(f.name));
  if(!audioFiles.length){ toast('Koi audio file nahi mili'); return; }
  audioFiles.forEach((f,i)=>{
    localTracks.push({ kind:'track', id:'local-'+Date.now()+'-'+i, title:f.name.replace(/\.[^.]+$/,''), artist:'Local file', album:{id:'',title:'Device'}, src:URL.createObjectURL(f), image:'', duration:null, g:'linear-gradient(135deg,#1ED760,#0D4A3D)', e:'💾' });
  });
  toast(`${audioFiles.length} file(s) added 🎵`);
  render();
}

function renderOffline(){
  const items = [...offline].map(byId).filter(Boolean);
  viewEl.innerHTML = `
    <h1>Offline</h1>
    <p class="sub">Offline list ke gaane (⬇ se add karo). Streams play ke waqt Bloomee backend se aate hain.</p>
    ${items.length ? rowsOf(items)
      : `<div class="empty"><b>Nothing here yet</b><p>Kisi track ke ⬇ button se offline list mein add karo,<br>wo yahan save ho jayega.</p></div>`}`;
}

/* ── Detail views (album / playlist / artist / user) ── */
function heroHTML({ kicker, title, sub, image, g, e, circle }) {
  return `<div class="detail-hero">
    <div class="detail-art ${circle?'circle':''}" ${g?`style="background:${g}"`:''}>${image?`<img src="${esc(image)}" alt="" onerror="this.remove()">`:(e||'♪')}</div>
    <div class="detail-meta">
      <span class="detail-kicker">${esc(kicker)}</span>
      <h1>${esc(title)}</h1>
      <p class="sub">${esc(sub||'')}</p>
      <button class="fp-play detail-play" data-play-first title="Play">▶</button>
    </div>
  </div>`;
}
let detailTracks = [];
function renderDetail(){
  const d = route.detail || {};
  detailTracks = [];
  viewEl.innerHTML = `
    <div class="detail-hero"><div class="detail-art skel"></div>
      <div class="detail-meta"><span class="detail-kicker">Loading</span><h1>···</h1></div>
    </div>${skeletonCards(6)}`;

  if(d.kind === 'liked'){
    const tracks = [...liked].map(byId).filter(Boolean);
    detailTracks = tracks;
    viewEl.innerHTML = heroHTML({ kicker:'Playlist', title:'Liked Songs', sub:`${tracks.length} songs`, g:'linear-gradient(135deg,#7358FF,#539DF5)', e:'♥' })
      + (tracks.length ? rowsOf(tracks) : `<div class="empty"><b>No liked songs yet</b><p>Kisi gaane ke ♡ se like karo.</p></div>`);
    return;
  }
  if(d.kind === 'user-playlist'){
    const p = playlists.find(x=>x.id===d.id);
    if(!p){ viewEl.innerHTML = `<div class="empty"><b>Playlist nahi mili</b></div>`; return; }
    const tracks = p.tracks.map(byId).filter(Boolean);
    detailTracks = tracks;
    viewEl.innerHTML = heroHTML({ kicker:'Playlist', title:p.name, sub:`${p.tracks.length} songs`, g:p.g, e:p.e })
      + (tracks.length ? `<div>${tracks.map((t,i)=>trackRow(t,i,{removable:p.id})).join('')}</div>`
        : `<div class="empty"><b>Abhi khaali hai</b><p>Gaane ke ＋ button se is playlist mein add karo.</p></div>`);
    return;
  }
  // API details (source ke mutabiq resolver: jiosaavn ya ytmusic)
  const src = d.source || 'jiosaavn';
  const loaders = {
    album: async () => {
      const r = await apiGet(detailUrl('album', d.id, src));
      rememberTracks(r.tracks);
      detailTracks = r.tracks;
      return heroHTML({ kicker:'Album', title:r.album.title, sub:`${r.album.artist}${r.album.year?' • '+r.album.year:''} • ${r.tracks.length} songs`, image:r.album.image })
        + rowsOf(r.tracks);
    },
    playlist: async () => {
      const r = await apiGet(detailUrl('playlist', d.id, src));
      rememberTracks(r.tracks);
      detailTracks = r.tracks;
      return heroHTML({ kicker:'Playlist', title:r.playlist.title, sub:`${r.playlist.subtitle||''} • ${r.tracks.length} songs`, image:r.playlist.image })
        + rowsOf(r.tracks);
    },
    artist: async () => {
      const r = await apiGet(detailUrl('artist', d.id, src));
      rememberTracks(r.topTracks);
      detailTracks = r.topTracks;
      return heroHTML({ kicker:'Artist', title:r.artist.name, sub:'Verified artist • Bloomee resolver', image:r.artist.image, circle:true })
        + (r.topTracks.length ? section('Popular', rowsOf(r.topTracks.slice(0, 10))) : '')
        + (r.albums.length ? section('Albums', shelf(r.albums)) : '')
        + (r.related.length ? section('Fans also like', shelf(r.related)) : '');
    },
  };
  (loaders[d.kind] || loaders.album)()
    .then(html => { if(route.name==='detail' && route.detail===d) viewEl.innerHTML = html; })
    .catch(() => { if(route.name==='detail') viewEl.innerHTML = `<div class="empty"><b>Load nahi hua 😕</b><p>Backend se data nahi aaya. Thodi der baad try karo.</p></div>`; });
}

const RENDER = { home:renderHome, search:renderSearch, library:renderLibrary, local:renderLocal, offline:renderOffline, detail:renderDetail };


/* Part 2 (player, lyrics, events, boot): player.js mein hai — index.html dono load karta hai. */
