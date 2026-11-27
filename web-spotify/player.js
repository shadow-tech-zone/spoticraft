/* ── Playlists ── */
function createPlaylist(){
  const name = prompt('Playlist ka naam?', `My Playlist #${playlists.length+1}`);
  if(!name) return;
  playlists.unshift({ id:'p'+Date.now(), name, tracks:[], g:'linear-gradient(135deg,#1ED760,#0D4A3D)', e:'🎧' });
  store.set('playlists', playlists);
  toast(`“${name}” ban gayi ✓`);
  render();
}
$('#sideCreatePlaylist').addEventListener('click', createPlaylist);
function addToPlaylist(trackId){
  if(!playlists.length){ toast('Pehle playlist banao'); return; }
  const list = playlists.map((p,i)=>`${i+1}. ${p.name}`).join('\n');
  const ans = prompt(`Kis playlist mein add karun?\n${list}\n\nNumber likho:`);
  const idx = parseInt(ans, 10) - 1;
  if(!playlists[idx]) return;
  if(!playlists[idx].tracks.includes(trackId)) playlists[idx].tracks.push(trackId);
  store.set('playlists', playlists);
  const t = byId(trackId); if(t) rememberTracks([t]);
  toast(`“${playlists[idx].name}” mein add ho gaya ✓`);
}

/* ── Player ── */
function updatePlayerUI(){
  if(!current) return;
  $('#pTitle').textContent = current.title;
  $('#pArtist').textContent = current.artist;
  $('#pArt').innerHTML = current.image ? `<img src="${esc(current.image)}" alt="">` : (current.e||'♪');
  $('#pArt').style.background = current.g || '';
  $('#fpTitle').textContent = current.title;
  $('#fpArtist').textContent = current.artist + (current.album?.title ? ' • ' + current.album.title : '');
  $('#fpArt').innerHTML = current.image ? `<img src="${esc(current.image)}" alt="">` : (current.e||'♪');
  $('#fpArt').style.background = current.g || '';
  $('#pLike').textContent = liked.has(current.id) ? '♥' : '♡';
  $('#pLike').classList.toggle('liked', liked.has(current.id));
}
function syncPlayIcons(){
  const icon = audio.paused ? '▶' : '❚❚';
  $('#playBtn').textContent = icon;
  $('#fpPlay').textContent = icon;
}
function pushRecent(t){
  recentIds = [t.id, ...recentIds.filter(id=>id!==t.id)].slice(0, 12);
  store.set('recent', recentIds);
  rememberTracks([t]);
}
let streamCandidates = [];   // maujooda track ke saaray stream URLs (fallback ke liye)
let streamUrlNow = '';
function playTrack(id, list){
  const t = byId(id);
  if(!t){ toast('Track nahi mila'); return; }
  if(list && list.length) queue = [...list];
  else if(!queue.some(x=>x.id===id)) queue = [t];
  current = t;
  pushRecent(t);
  updatePlayerUI(); render();
  const seq = ++playSeq;
  const start = url => { if(seq === playSeq){ streamUrlNow = url; audio.src = url; audio.play().catch(()=>{}); } };
  if(t.src){ streamCandidates = []; start(t.src); return; }   // local file / demo
  const cachedStream = streamCache.get(id);
  if(cachedStream){ streamCandidates = cachedStream.list; start(cachedStream.url); loadLyrics(t); return; }
  $('#playBtn').textContent = '…';
  // JioSaavn: /track (320 pehle) — YTMusic: /yt?action=track (direct streams pehle)
  const url = isYtTrack(t)
    ? '/yt?action=track&id=' + encodeURIComponent(ytVid(t))
    : '/track?id=' + encodeURIComponent(id);
  apiGet(url)
    .then(d => {
      const streams = d.streams || [];
      if(d.track){ Object.assign(t, d.track); trackCache.set(id, t); updatePlayerUI(); }
      if(!streams.length){ toast('Is gaane ka stream nahi mila 😕'); syncPlayIcons(); return; }
      streamCandidates = streams.map(s => s.url);
      streamCache.set(id, { url: streams[0].url, list: streamCandidates });
      start(streams[0].url);
      loadLyrics(t);
    })
    .catch(() => { if(seq === playSeq){ toast('Stream load nahi hua — backend check karo'); syncPlayIcons(); } });
}
/* Stream fail → agla candidate try karo (IOS → TV → ANDROID-proxy waghera) */
audio.addEventListener('error', () => {
  if(!current || current.src || !streamCandidates.length) return;
  const next = streamCandidates[streamCandidates.indexOf(streamUrlNow) + 1];
  if(next){
    streamUrlNow = next;
    audio.src = next;
    audio.play().catch(()=>{});
  } else if(streamUrlNow){
    toast('Stream nahi chala 😕 — doosra gaana try karo');
    syncPlayIcons();
  }
});
function togglePlay(){
  if(!current){
    const first = (homeBySource[catalog]?.[0]?.items || DEMO_TRACKS).find(i=>i.kind==='track');
    if(first) playTrack(first.id);
    return;
  }
  audio.paused ? audio.play().catch(()=>{}) : audio.pause();
}
function step(dir){
  if(!queue.length) return;
  let i = queue.findIndex(t=>current && t.id===current.id);
  if(dir > 0 && i >= 0 && i === queue.length - 1){ radioExtend(); return; }
  if(shuffle && dir > 0) i = Math.floor(Math.random()*queue.length);
  else i = (i + dir + queue.length) % queue.length;
  if(queue[i]) playTrack(queue[i].id);
}
/* Queue khatam → Bloomee radio se aage badhao
   (JioSaavn: reco.getreco — YTMusic: next automix RDAMVM…) */
let radioBusy = false;
async function radioExtend(){
  if(!current || radioBusy || current.src){ return; }
  radioBusy = true;
  toast('📻 Radio se milte-julte gaane la raha hoon…');
  try {
    const url = isYtTrack(current)
      ? '/yt?action=radio&id=' + encodeURIComponent(ytVid(current))
      : '/radio?id=' + encodeURIComponent(current.id);
    const d = await apiGet(url);
    const fresh = (d.tracks || []).filter(t=>t.id !== current.id && !queue.some(x=>x.id===t.id));
    rememberTracks(fresh);
    if(fresh.length){
      queue.push(...fresh);
      playTrack(fresh[0].id);
    } else toast('Radio mein kuch naya nahi mila');
  } catch { toast('Radio load nahi hua'); }
  radioBusy = false;
}
audio.addEventListener('play', ()=>{ syncPlayIcons(); render(); });
audio.addEventListener('pause', ()=>{ syncPlayIcons(); render(); });
audio.addEventListener('loadedmetadata', ()=>{
  if(current){ current.dur = audio.duration; }
  $('#durTime').textContent = fmt(audio.duration);
  $('#fpDur').textContent = fmt(audio.duration);
});
audio.addEventListener('timeupdate', ()=>{
  const d = audio.duration||0, c = audio.currentTime||0;
  const pct = d ? (c/d*100) : 0;
  $('#progressFill').style.width = pct+'%';
  $('#fpFill').style.width = pct+'%';
  $('#curTime').textContent = fmt(c);
  $('#fpCur').textContent = fmt(c);
  syncLyrics(c);
});
audio.addEventListener('ended', ()=>{
  if(repeat){ audio.currentTime = 0; audio.play().catch(()=>{}); return; }
  const i = queue.findIndex(t=>current && t.id===current.id);
  if(i >= 0 && i < queue.length - 1) step(1);
  else radioExtend();
});
$('#playBtn').addEventListener('click', togglePlay);
$('#fpPlay').addEventListener('click', togglePlay);
$('#nextBtn').addEventListener('click', ()=>step(1));
$('#prevBtn').addEventListener('click', ()=>step(-1));
$('#fpNext').addEventListener('click', ()=>step(1));
$('#fpPrev').addEventListener('click', ()=>step(-1));
$('#shuffleBtn').addEventListener('click', e=>{ shuffle=!shuffle; e.currentTarget.classList.toggle('on', shuffle); toast(shuffle?'Shuffle on 🔀':'Shuffle off'); });
$('#repeatBtn').addEventListener('click', e=>{ repeat=!repeat; e.currentTarget.classList.toggle('on', repeat); toast(repeat?'Repeat on 🔁':'Repeat off'); });
$('#volume').addEventListener('input', e=>{ audio.volume = e.target.value/100; });
audio.volume = 0.8;
function seek(e, bar){
  const r = bar.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (e.clientX - r.left)/r.width));
  if(audio.duration) audio.currentTime = pct * audio.duration;
}
$('#progressBar').addEventListener('click', e=>seek(e, e.currentTarget));
$('.fp-progress')?.addEventListener('click', e=>seek(e, e.currentTarget));
$('#pLike').addEventListener('click', ()=>{ if(current) toggleLike(current.id); });
$('#expandBtn').addEventListener('click', ()=>{ $('#fullPlayer').classList.add('open'); if(current) loadLyrics(current); });
$('#pArt').addEventListener('click', ()=>{ $('#fullPlayer').classList.add('open'); if(current) loadLyrics(current); });
$('#fpClose').addEventListener('click', ()=>$('#fullPlayer').classList.remove('open'));
document.addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA') return;
  if(e.code==='Space'){ e.preventDefault(); togglePlay(); }
  if(e.code==='ArrowRight') step(1);
  if(e.code==='ArrowLeft') step(-1);
});

/* ── Lyrics (Bloomee lrcnet plugin → LRCLIB) ── */
function parseLrc(synced){
  const lines = [];
  for(const raw of String(synced||'').split('\n')){
    const m = raw.match(/\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/);
    if(m) lines.push({ time: parseInt(m[1])*60 + parseFloat(m[2]), text: m[3] || '♪' });
  }
  return lines.sort((a,b)=>a.time-b.time);
}
async function loadLyrics(t){
  const box = $('#fpLyrics'); if(!box || !t || t.src) return;
  if(lyricsState.forId === t.id && (lyricsState.lines.length || lyricsState.plain)) return;
  lyricsState = { forId:t.id, lines:[], plain:null, loading:true };
  box.innerHTML = `<p>🎤 Lyrics dhoond raha hoon…</p>`;
  try {
    const p = new URLSearchParams({ track:t.title, artist:(t.artist||'').split(',')[0], album:t.album?.title||'', duration:t.duration||'' });
    const d = await apiGet('/lyrics?' + p.toString());
    if(lyricsState.forId !== t.id) return;
    const lyr = d.lyrics;
    lyricsState.loading = false;
    if(!lyr){ box.innerHTML = `<p>🎤 Is gaane ke lyrics nahi mile<br><span>LRCLIB par available nahi hain</span></p>`; lyricsState.plain = ''; return; }
    lyricsState.plain = lyr.plain;
    lyricsState.lines = parseLrc(lyr.synced);
    if(lyricsState.lines.length){
      box.innerHTML = lyricsState.lines.map((l,i)=>`<p class="lyr-line" data-li="${i}">${esc(l.text)}</p>`).join('');
    } else if(lyr.plain){
      box.innerHTML = lyr.plain.split('\n').map(l=>`<p class="lyr-line static">${esc(l) || '&nbsp;'}</p>`).join('');
    } else {
      box.innerHTML = `<p>🎤 Instrumental lagta hai 🎻</p>`;
    }
  } catch { if(lyricsState.forId === t.id) box.innerHTML = `<p>🎤 Lyrics load nahi hue</p>`; }
}
let lastLyrIdx = -1;
function syncLyrics(c){
  if(!lyricsState.lines.length || !$('#fullPlayer').classList.contains('open')) return;
  let idx = -1;
  for(let i=0;i<lyricsState.lines.length;i++){ if(lyricsState.lines[i].time <= c) idx = i; else break; }
  if(idx === lastLyrIdx) return;
  lastLyrIdx = idx;
  document.querySelectorAll('.lyr-line.active').forEach(el=>el.classList.remove('active'));
  if(idx >= 0){
    const el = document.querySelector(`[data-li="${idx}"]`);
    if(el){ el.classList.add('active'); el.scrollIntoView({ block:'center', behavior:'smooth' }); }
  }
}

/* ── Likes & offline ── */
function toggleLike(id){
  liked.has(id) ? liked.delete(id) : liked.add(id);
  store.set('liked', [...liked]);
  const t = byId(id); if(t) rememberTracks([t]);
  toast(liked.has(id) ? 'Liked Songs mein add ♥' : 'Like hataya');
  updatePlayerUI(); render();
}
function toggleOffline(id){
  offline.has(id) ? offline.delete(id) : offline.add(id);
  store.set('offline', [...offline]);
  const t = byId(id); if(t) rememberTracks([t]);
  toast(offline.has(id) ? 'Offline list mein add ⬇' : 'Offline se hataya');
  render();
}

/* ── Global events (delegation) ── */
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click', ()=>go({ name:b.dataset.view })));
$('#backBtn').addEventListener('click', ()=>{
  if(historyStack.length>1){ historyStack.pop(); route = historyStack[historyStack.length-1]; render(); $('#mainScroll').scrollTop=0; }
});
$('#fwdBtn').addEventListener('click', ()=>toast('Aage ki history abhi nahi hai'));
let searchDebounce;
$('#globalSearch').addEventListener('input', e=>{
  searchQuery = e.target.value;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(()=>{
    if(route.name !== 'search') go({ name:'search' }); else renderSearch();
  }, 300);
});
viewEl.addEventListener('click', e=>{
  const like = e.target.closest('[data-like]');
  if(like){ e.stopPropagation(); toggleLike(like.dataset.like); return; }
  const off = e.target.closest('[data-offline]');
  if(off){ e.stopPropagation(); toggleOffline(off.dataset.offline); return; }
  const add = e.target.closest('[data-add]');
  if(add){ e.stopPropagation(); addToPlaylist(add.dataset.add); return; }
  const rem = e.target.closest('[data-remove-from]');
  if(rem){
    e.stopPropagation();
    const [pid, tid] = rem.dataset.removeFrom.split(':');
    const p = playlists.find(x=>x.id===pid);
    if(p){ p.tracks = p.tracks.filter(x=>x!==tid); store.set('playlists', playlists); toast('Playlist se hataya'); render(); }
    return;
  }
  const cat = e.target.closest('[data-cat]');
  if(cat){ searchQuery = cat.dataset.cat; $('#globalSearch').value = searchQuery; searchType='all'; go({ name:'search' }); return; }
  const st = e.target.closest('[data-stype]');
  if(st){ searchType = st.dataset.stype; renderSearch(); return; }
  if(e.target.closest('[data-soon]')){ toast('Ye tab jald aa raha hai 🎧'); return; }
  if(e.target.closest('[data-open-liked]')){ go({ name:'detail', detail:{ kind:'liked' } }); return; }
  const upl = e.target.closest('[data-open-userpl]');
  if(upl){ go({ name:'detail', detail:{ kind:'user-playlist', id:upl.dataset.openUserpl } }); return; }
  const alb = e.target.closest('[data-open-album]');
  if(alb){ go({ name:'detail', detail:{ kind:'album', id:alb.dataset.openAlbum, source:alb.dataset.source } }); return; }
  const pl = e.target.closest('[data-open-playlist]');
  if(pl){ go({ name:'detail', detail:{ kind:'playlist', id:pl.dataset.openPlaylist, source:pl.dataset.source } }); return; }
  const ar = e.target.closest('[data-open-artist]');
  if(ar){ go({ name:'detail', detail:{ kind:'artist', id:ar.dataset.openArtist, source:ar.dataset.source } }); return; }
  if(e.target.closest('[data-play-first]')){
    if(detailTracks.length) playTrack(detailTracks[0].id, detailTracks);
    return;
  }
  const play = e.target.closest('[data-play-track]');
  if(play && play.dataset.playTrack){
    const list = [...viewEl.querySelectorAll('[data-play-track]')]
      .map(el=>byId(el.dataset.playTrack)).filter((t,i,a)=>t && a.findIndex(x=>x.id===t.id)===i);
    playTrack(play.dataset.playTrack, list.length?list:null);
  }
});

/* ── Catalog switch (Desi/Global) ── */
document.querySelectorAll('[data-catalog]').forEach(b => b.addEventListener('click', () => switchCatalog(b.dataset.catalog)));

/* ── Boot ── */
syncSourceSwitch();
render();
syncPlayIcons();
