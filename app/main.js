/* Bloomee main process — window/tray/IPC/library.
   UI renderer hai, saara logic yahan core services mein hai
   (music-api ports). Spotify-jaisi layered architecture. */
import { app, BrowserWindow, ipcMain, Tray, Menu, shell, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { jiosaavn } from './core/jiosaavn.js';
import { ytmusic } from './core/ytmusic.js';
import { getLyrics } from './core/lyrics.js';
import { resolveStreams } from './core/resolve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const SMOKE = !!process.env.BLOOMEE_SMOKE;
const SHOTS = !!process.env.BLOOMEE_SHOTS;
if (SMOKE || SHOTS) app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/* ── log: userData/bloomee.log ── */
let logStream = null;
export function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map(p =>
    typeof p === 'string' ? p : (p?.stack || JSON.stringify(p))).join(' ')}`;
  try { logStream?.write(line + '\n'); } catch { /* ignore */ }
  if (isDev) console.log(line);
}

/* ── library store (userData/library.json) ── */
const DEFAULT_LIB = {
  liked: [], playlists: [], recent: [], lastTrack: null,
  settings: { source: 'jiosaavn', volume: 0.75, shuffle: false, repeat: 'off', closeToTray: false },
};
class Store {
  constructor(file) { this.file = file; this.data = structuredClone(DEFAULT_LIB); this.load(); }
  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...structuredClone(DEFAULT_LIB), ...raw,
        settings: { ...DEFAULT_LIB.settings, ...(raw.settings || {}) } };
    } catch { /* fresh */ }
  }
  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      try { fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch (e) { log('lib save fail', e); }
    }, 120);
  }
  flush() { try { fs.writeFileSync(this.file, JSON.stringify(this.data)); } catch { /* ignore */ } }
}
let store;

/* ── sources facade ── */
function srcImpl(src) { return src === 'ytmusic' ? ytmusic : jiosaavn; }
function wrap(fn) {
  return async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { log('api error', err); return { ok: false, error: err.message || 'request fail' }; }
  };
}

/* ── window/tray ── */
let win = null, tray = null;
let playerState = { playing: false, title: '' };

function createWindow() {
  const s = store.data.settings;
  win = new BrowserWindow({
    width: s.winW || 1280, height: s.winH || 800,
    minWidth: 940, minHeight: 580,
    frame: false, backgroundColor: '#121212', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  if (SMOKE || SHOTS) {
    /* QA modes mein page ki console main tak — warna andha test */
    win.webContents.on('console-message', (_e, _lvl, msg) => console.log('PAGE>', String(msg).slice(0, 400)));
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('resize', () => {
    if (!win.isMaximized()) { const [w, h] = win.getSize(); s.winW = w; s.winH = h; store.save(); }
  });
  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));
  win.on('close', (e) => {
    if (store.data.settings.closeToTray && !app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
  if (isDev && !SMOKE && !SHOTS) win.webContents.openDevTools({ mode: 'detach' });
  if (SMOKE) win.webContents.once('did-finish-load', () => setTimeout(() => runSmoke(win), 600));
  if (SHOTS) win.webContents.once('did-finish-load', () => runShots(win));
}

/* ── QA screenshot report: Home → Detail → Search, teeno pages ki
   photos taake UI review aankh se ho sakay (andha fix nahi) ── */
async function runShots(w) {
  const exec = (code) => w.webContents.executeJavaScript(code).catch(() => 0);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (sel, tries = 44) => {
    for (let i = 0; i < tries; i++) {
      if (await exec(`document.querySelectorAll('${sel}').length`) > 0) return true;
      await sleep(500);
    }
    return false;
  };
  const shot = async (name, settle = 1400) => {
    await sleep(settle);
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(process.cwd(), name), img.toPNG());
    console.log('SHOT', name);
  };
  try {
    await waitFor('.card,.trow');
    await shot('home.png');
    /* pehla card kholo → detail page */
    await exec(`document.querySelector('.card')?.click()`);
    await waitFor('#hero,.trow');
    await shot('detail.png');
    /* search page */
    await exec(`(function(){const i=document.querySelector('#search'); i.focus(); i.value='Arijit Singh'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
    await waitFor('.trow,.card');
    await shot('search.png');
    /* pehla gaana chalao → playback state wale panels.
       Asal mouse event (sendInputEvent) — synthetic .click() par
       bharosa nahi, user bhi mouse hi dabata hai. */
    const pt = await exec(`(() => { const r = document.querySelector('.trow')?.getBoundingClientRect(); return r ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null; })()`);
    console.log('ROW_PT', JSON.stringify(pt));
    if (pt) {
      w.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      w.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    }
    await waitFor('#np-left .np-title', 30);
    console.log('PLAY_STATE', JSON.stringify(await exec(`(document.querySelector('#np-left')?.textContent || '').trim().slice(0, 80)`)));
    await shot('playing.png', 2500);
    await exec(`document.querySelector('#btn-rp-queue')?.click()`);
    await waitFor('.qrow', 20);
    await shot('queue.png');
    await exec(`document.querySelector('[data-tab="now"]')?.click()`);
    await waitFor('.np-big', 20);
    await shot('now.png');
    await exec(`document.querySelector('[data-tab="lyrics"]')?.click()`);
    await waitFor('.lyr-line', 40);
    await shot('lyrics.png', 1800);
    /* charts page */
    await exec(`document.querySelector('#nav-charts')?.click()`);
    await waitFor('.card', 30);
    await shot('charts.png');
    /* fullscreen lyrics */
    await exec(`document.querySelector('[data-act="fs-lyrics"]')?.click()`);
    await waitFor('.fs-line', 24);
    await shot('fslyrics.png', 1600);
    console.log('SHOTS_OK');
  } catch (e) { console.log('SHOTS_FAIL ' + (e?.message || e)); }
  app.exit(0);
}

/* ── CI smoke test: asal app + asal IPC + asal Chromium <audio> ──
   Dono sources ke gaane play karke duration/currentTime verify. */
async function runSmoke(w) {
  const code = `(async () => {
    const unwrap = (p) => p.then(x => { if (!x || !x.ok) throw new Error((x && x.error) || 'ipc fail'); return x.data; });
    const play = async (url) => {
      const a = new Audio();
      const ready = new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('canplay timeout')), 30000);
        a.addEventListener('canplay', () => { clearTimeout(to); res(); }, { once: true });
        a.addEventListener('error', () => { clearTimeout(to); rej(new Error('audio error code=' + (a.error && a.error.code))); }, { once: true });
      });
      a.src = url;
      await ready;
      await a.play();
      const t0 = a.currentTime;
      await new Promise(r => setTimeout(r, 3500));
      return { duration: Math.round(a.duration || 0), t0: +t0.toFixed(2), t1: +a.currentTime.toFixed(2), paused: a.paused };
    };
    const out = {};
    const s1 = await unwrap(window.bloomee.api.search('jiosaavn', 'Arijit Singh', 'track', 1));
    const st1 = await unwrap(window.bloomee.api.streams(s1.items[0]));
    out.saavn = { title: s1.items[0].title, via: st1.via, ...(await play(st1.streams[0].url)) };
    const s2 = await unwrap(window.bloomee.api.search('ytmusic', 'Arijit Singh', 'track', 1));
    const st2 = await unwrap(window.bloomee.api.streams(s2.items[0]));
    out.ytm = { title: s2.items[0].title, via: st2.via, ...(await play(st2.streams[0].url)) };
    const lyr = await unwrap(window.bloomee.api.lyrics(s1.items[0])).catch(() => null);
    out.lyrics = { found: !!(lyr && (lyr.plain || lyr.synced?.length)), syncedLines: lyr?.synced?.length || 0 };
    out.ok = [out.saavn, out.ytm].every(p => p.duration > 30 && p.t1 > p.t0 && !p.paused);
    return out;
  })()`;
  try {
    const res = await w.webContents.executeJavaScript(code, true);
    console.log('SMOKE_RESULT ' + JSON.stringify(res));
    app.exit(res?.ok ? 0 : 1);
  } catch (e) {
    console.log('SMOKE_RESULT ' + JSON.stringify({ ok: false, error: String(e?.message || e) }));
    app.exit(1);
  }
}

function showWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function buildTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let img = nativeImage.createFromPath(iconPath);
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Bloomee');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Bloomee', click: showWindow },
    { label: 'Play / Pause', click: () => win?.webContents.send('player:cmd', 'toggle') },
    { label: 'Next', click: () => win?.webContents.send('player:cmd', 'next') },
    { label: 'Previous', click: () => win?.webContents.send('player:cmd', 'prev') },
    { type: 'separator' },
    { label: 'Exit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', showWindow);
}

/* ── IPC ── */
function registerIpc() {
  function parse(id) {
    const i = String(id).indexOf('::');
    return i < 0 ? { src: 'jiosaavn', local: String(id) } : { src: id.slice(0, i), local: id.slice(i + 2) };
  }
  function route(id) { return parse(id).src === 'ytmusic' ? ytmusic : jiosaavn; }
  const api = {
    'api:home': (src) => srcImpl(src).home(),
    'api:search': (src, q, filter, page) => srcImpl(src).search(q, filter || 'all', page || 1),
    'api:suggestions': (src, q) => srcImpl(src).suggestions(q),
    'api:track': (id) => route(id).trackDetails(parse(id).local),
    'api:album': (id) => route(id).albumDetails(parse(id).local),
    'api:playlist': (id) => route(id).playlistDetails(parse(id).local),
    'api:artist': (id) => route(id).artistDetails(parse(id).local),
    'api:radio': (id) => route(id).radio(parse(id).local),
    'api:charts': (src) => srcImpl(src).charts(),
    'api:chart': (id) => route(id).chartDetails(parse(id).local),
    'api:lyrics': (_src, t) => getLyrics({
      title: t.title,
      artist: t.artists?.[0]?.name || '',
      album: t.album?.title || null,
      durationMs: t.durationMs || null,
    }),
  };
  for (const [name, fn] of Object.entries(api)) ipcMain.handle(name, wrap(fn));

  /* streams: shared resolver (core/resolve.js) — primary fail par
     doosre source se rescue; tamam attempts bloomee.log mein */
  ipcMain.handle('api:streams', async (_e, track) => {
    try {
      return { ok: true, data: await resolveStreams(track, log) };
    } catch (err) {
      log('streams error', err);
      return { ok: false, error: err.message || 'stream resolve fail' };
    }
  });

  ipcMain.handle('lib:get', () => store.data);
  ipcMain.handle('lib:op', (_e, op, payload = {}) => {
    const d = store.data;
    switch (op) {
      case 'toggleLike': {
        const i = d.liked.findIndex(t => t.id === payload.track.id);
        if (i >= 0) d.liked.splice(i, 1); else d.liked.unshift(payload.track);
        break;
      }
      case 'newPlaylist': {
        const p = { id: `local::${Date.now()}`, name: payload.name || 'My Playlist', tracks: [] };
        d.playlists.push(p); store.save(); return p;
      }
      case 'renamePlaylist': { const p = d.playlists.find(x => x.id === payload.id); if (p) p.name = payload.name; break; }
      case 'deletePlaylist': { d.playlists = d.playlists.filter(x => x.id !== payload.id); break; }
      case 'addToPlaylist': {
        const p = d.playlists.find(x => x.id === payload.id);
        if (p && !p.tracks.some(t => t.id === payload.track.id)) p.tracks.push(payload.track);
        break;
      }
      case 'removeFromPlaylist': {
        const p = d.playlists.find(x => x.id === payload.id);
        if (p) p.tracks = p.tracks.filter(t => t.id !== payload.trackId);
        break;
      }
      case 'touchRecent': {
        d.recent = [payload.track, ...d.recent.filter(t => t.id !== payload.track.id)].slice(0, 50);
        d.lastTrack = payload.track;
        break;
      }
      case 'setSetting': { d.settings[payload.key] = payload.value; break; }
    }
    store.save();
    return store.data;
  });

  ipcMain.handle('player:state', (_e, st) => {
    playerState = st;
    tray?.setToolTip(st.title ? `Bloomee — ${st.title}` : 'Bloomee');
    return true;
  });

  ipcMain.handle('win:min', () => win?.minimize());
  ipcMain.handle('win:max', () => { if (win?.isMaximized()) win.unmaximize(); else win?.maximize(); });
  ipcMain.handle('win:close', () => win?.close());
  ipcMain.handle('win:isMax', () => !!win?.isMaximized());
  ipcMain.handle('app:openLogs', () => shell.openPath(path.join(app.getPath('userData'), 'bloomee.log')));
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));
  ipcMain.handle('app:quit', () => { app.isQuitting = true; app.quit(); });
  ipcMain.handle('app:openExternal', (_e, url) => {
    if (/^https:\/\/github\.com\//.test(String(url))) return shell.openExternal(url);
  });
}

/* ── auto-update check: GitHub latest release vs app version ── */
function isNewer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
async function checkUpdate() {
  try {
    const r = await fetch('https://api.github.com/repos/shadow-tech-zone/spoticraft/releases/latest', {
      headers: { 'user-agent': 'Bloomee', accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return;
    const j = await r.json();
    const latest = String(j.tag_name || '').replace(/^v/, '');
    if (latest && isNewer(latest, app.getVersion())) {
      log('update available', latest, 'current', app.getVersion());
      win?.webContents.send('app:update', { version: `v${latest}`, url: j.html_url });
    }
  } catch (e) { log('update check fail', e.message); }
}

/* ── boot ── */
app.whenReady().then(() => {
  const userData = app.getPath('userData');
  try { logStream = fs.createWriteStream(path.join(userData, 'bloomee.log'), { flags: 'a' }); } catch { /* ignore */ }
  store = new Store(path.join(userData, 'library.json'));
  log('Bloomee start', app.getVersion());

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) { app.quit(); return; }
  app.on('second-instance', showWindow);

  registerIpc();
  createWindow();
  if (!SMOKE && !SHOTS) setTimeout(checkUpdate, 4000);
  buildTray();

  app.on('activate', showWindow);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { store?.flush(); try { logStream?.end(); } catch { /* ignore */ } });
