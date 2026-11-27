/* ═══════════════════════════════════════════════════════════════
   Bloomee backend — YouTube Music resolver (Node port)

   Ye file BloomeeTunes ke official `ytmusic.bex` plugin
   (kojima-ui/bloom-factory → ytmusic/src/{client,parser,mapper,cipher}.rs)
   ka seedha JavaScript port hai — wahi InnerTube endpoints, wahi
   clients, wahi parsing jo Flutter app use karta hai.

   Endpoints (music.youtube.com/youtubei/v1/, WEB_REMIX client):
     home      browse  browseId=FEmusic_home (+continuations)
     search    search  (type filters = plugin ke params constants)
     track     player  (videoDetails) + streams (neeche dekho)
     album     browse  browseId=MPRE…
     artist    browse  browseId=UC…
     playlist  browse  browseId=VL… ("VL" prefix plugin jodta hai)
     radio     next    playlistId=RDAMVM<videoId> (automix)

   Streams (client.rs `get_streams` ki web-adapted strategy):
     1. IOS client    → direct googlevideo URLs (browser <audio>
                        seedha chala sakta hai — pehli pasand)
     2. ANDROID client → direct URLs, lekin CDN ko Android
                        User-Agent chahiye → /api/yt ka stream
                        proxy use hota hai (via:"proxy")
     3. TVHTML5       → signatureCipher → _ytcipher.js decode
   Teeno mein playabilityStatus "OK" lazmi hai (plugin ki tarah).
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const cipher = require('./_ytcipher');

const YTM_BASE_API = 'https://music.youtube.com/youtubei/v1/';
const API_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const CLIENT_NAME = 'WEB_REMIX';
const CLIENT_VERSION = '1.20260222.01.00';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const ANDROID = { name: 'ANDROID', id: '3', version: '21.26.364', sdk: 30, ua: 'com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip' };
const IOS = { name: 'IOS', id: '5', version: '20.10.4', ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X)' };
const TV = { name: 'TVHTML5', id: '7', version: '7.20260114.12.00' };
const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const SRC = 'ytmusic';

/* ── visitorData (plugin: VISITOR_DATA_CACHE; lambda memory mein) ── */
let visitorDataCache = null;
let visitorSeedInFlight = null;

function captureVisitor(data) {
  const vd = data && data.responseContext && data.responseContext.visitorData;
  if (typeof vd === 'string' && vd) visitorDataCache = vd;
}
function clearVisitor() { visitorDataCache = null; }

function visitorFromHtml(html) {
  for (const marker of ['"VISITOR_DATA":"', '"visitorData":"']) {
    const start = html.indexOf(marker);
    if (start >= 0) {
      const rest = html.slice(start + marker.length);
      const end = rest.indexOf('"');
      if (end > 0) return rest.slice(0, end);
    }
  }
  return null;
}
async function fetchText(url, headers, ms = 15000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
async function seedVisitorData() {
  if (visitorDataCache) return visitorDataCache;
  if (visitorSeedInFlight) return visitorSeedInFlight;
  visitorSeedInFlight = (async () => {
    try {
      // Fast path: sw.js_data (plugin ki "extremely robust" seed)
      const text = await fetchText('https://www.youtube.com/sw.js_data', {
        Accept: 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; ANDROID 11)',
      });
      let clean = text;
      if (clean.startsWith(")]}'")) clean = clean.slice(4).trim();
      try {
        const data = JSON.parse(clean);
        const vd = data?.[0]?.[2]?.[0]?.[0]?.[13];
        if (typeof vd === 'string' && vd) { visitorDataCache = vd; return vd; }
      } catch { /* fallback neeche */ }
    } catch { /* fallback neeche */ }
    try {
      const html = await fetchText('https://music.youtube.com/', {
        'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.5',
      });
      const vd = visitorFromHtml(html);
      if (vd) visitorDataCache = vd;
    } catch { /* bina visitorData ke bhi aksar browse/search chal jata hai */ }
    return visitorDataCache;
  })();
  try { return await visitorSeedInFlight; } finally { visitorSeedInFlight = null; }
}
/** plugin `fetch_visitor_data`: cache → seed → watch page scrape. */
async function fetchVisitorData(videoId) {
  if (visitorDataCache) return visitorDataCache;
  await seedVisitorData();
  if (visitorDataCache) return visitorDataCache;
  if (videoId) {
    try {
      const html = await fetchText(`https://www.youtube.com/watch?v=${videoId}`, {
        'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.5',
      });
      const vd = visitorFromHtml(html);
      if (vd) { visitorDataCache = vd; return vd; }
    } catch { /* ignore */ }
  }
  return null;
}

/* ── InnerTube HTTP (ytm_post / ytm_post_continuation) ── */
function buildContext() {
  const context = {
    client: { clientName: CLIENT_NAME, clientVersion: CLIENT_VERSION, hl: 'en', gl: 'US' },
    user: {},
  };
  if (visitorDataCache) context.client.visitorData = visitorDataCache;
  return context;
}
async function postJson(url, body, headers, ms = 30000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`YouTube API returned status ${res.status}`);
  const data = await res.json();
  captureVisitor(data);
  return data;
}
async function ytmPost(endpoint, body) {
  return postJson(`${YTM_BASE_API}${endpoint}?alt=json&key=${API_KEY}`, body, {
    'User-Agent': USER_AGENT,
    Origin: 'https://music.youtube.com',
    Referer: 'https://music.youtube.com/',
  });
}
async function ytmPostContinuation(endpoint, continuation, body) {
  const b = { ...body, continuation };
  return postJson(
    `${YTM_BASE_API}${endpoint}?alt=json&key=${API_KEY}&ctoken=${encodeURIComponent(continuation)}&continuation=${encodeURIComponent(continuation)}`,
    b,
    { 'User-Agent': USER_AGENT, Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/' },
    15000,
  );
}

/* ── Parsers/mappers: _ytparser.js (parser.rs + mapper.rs port) ── */
const {
  nav, arr, cleanThumbUrl, bestImage, trackId, ytThumbFallback, mapParsedItem, mapAlbumTrack, mapItems, parseSearchResults, parseHomeSectionsPage, parseAlbumHeader, parseAlbumTracks, parsePlaylistHeader, parsePlaylistTracks, parseContinuationTracks, parseArtistPage, parseWatchPlaylist, parseWatchPanelItems, panelContinuation,
} = require('./_ytparser');

/* ── Streams (client.rs get_streams: web-adapted order) ── */
function bitrateQuality(bitrate) {
  const kbps = Math.floor((bitrate || 0) / 1000);
  return { kbps, label: kbps >= 256 ? 'High' : kbps >= 128 ? 'Medium' : 'Low' };
}
function mimeFormat(mime) {
  const m = String(mime || '');
  if (m.includes('opus') || m.includes('webm')) return 'opus';
  if (m.includes('mp4a') || m.includes('mp4')) return 'aac';
  if (m.includes('flac')) return 'flac';
  return 'unknown';
}
function parseExpire(url) {
  const m = /[?&]expire=(\d+)/.exec(url || '');
  return m ? Number(m[1]) : undefined;
}
let cachedManifest = null;
async function collectStreams(data, clientName, via) {
  const sd = data && data.streamingData;
  const formats = [...(arr(sd && sd.adaptiveFormats) || []), ...(arr(sd && sd.formats) || [])];
  const streams = [];
  for (const f of formats) {
    const mime = typeof f.mimeType === 'string' ? f.mimeType : '';
    if (!(mime.startsWith('audio/') || (mime.startsWith('video/') && (mime.includes('mp4a') || mime.includes('opus'))))) continue;
    let url = typeof f.url === 'string' ? f.url : undefined;
    if (!url) {
      const cipherStr = f.signatureCipher || f.cipher;
      if (typeof cipherStr === 'string') {
        try {
          if (!cachedManifest) cachedManifest = await cipher.getCipherManifest();
          url = cipher.decodeStreamUrl(cipherStr, cachedManifest);
        } catch {
          try {
            cachedManifest = await cipher.getCipherManifest(true);
            url = cipher.decodeStreamUrl(cipherStr, cachedManifest);
          } catch { url = undefined; }
        }
      }
    }
    if (!url) continue;
    const bitrate = f.bitrate || 0;
    const { kbps, label } = bitrateQuality(bitrate);
    streams.push({
      quality: `${kbps} kbps`, label, bitrate,
      url, format: mimeFormat(mime), mime,
      audioOnly: mime.startsWith('audio/'),
      client: clientName, via, expiresAt: parseExpire(url),
    });
  }
  return streams;
}
async function playerForClient(client, videoId, visitorData) {
  const isAndroid = client.name === 'ANDROID';
  const clientCtx = isAndroid
    ? { clientName: ANDROID.name, clientVersion: ANDROID.version, androidSdkVersion: ANDROID.sdk, userAgent: ANDROID.ua, hl: 'en', platform: 'MOBILE', osName: 'Android', osVersion: '11', timeZone: 'UTC', gl: 'US', utcOffsetMinutes: 0 }
    : { clientName: IOS.name, clientVersion: IOS.version, deviceModel: 'iPhone16,2', userAgent: IOS.ua, hl: 'en', gl: 'US', utcOffsetMinutes: 0 };
  if (visitorData) clientCtx.visitorData = visitorData;
  const body = {
    context: { client: clientCtx },
    videoId,
    playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
    contentCheckOk: true, racyCheckOk: true,
  };
  const headers = {
    'User-Agent': client.ua,
    'X-YouTube-Client-Name': client.id,
    'X-YouTube-Client-Version': client.version,
    Origin: 'https://www.youtube.com',
    'Sec-Fetch-Mode': 'navigate',
  };
  if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;
  const data = await postJson(PLAYER_URL, body, headers);
  const status = nav(data, 'playabilityStatus.status');
  if (status !== 'OK') {
    const reason = nav(data, 'playabilityStatus.reason') || 'Unknown';
    throw new Error(`${client.name} client: status=${status}, reason=${reason}`);
  }
  return data;
}
async function getStreamsAndroid(videoId, visitorData) {
  const data = await playerForClient(ANDROID, videoId, visitorData);
  return collectStreams(data, 'ANDROID', 'proxy');
}
async function getStreamsIos(videoId, visitorData) {
  const data = await playerForClient(IOS, videoId, visitorData);
  return collectStreams(data, 'IOS', 'direct');
}
async function getStreamsTv(videoId) {
  let manifest = cachedManifest || await cipher.getCipherManifest();
  cachedManifest = manifest;
  const body = {
    context: { client: { clientName: TV.name, clientVersion: TV.version, hl: 'en', timeZone: 'UTC', gl: 'US', utcOffsetMinutes: 0 } },
    videoId, contentCheckOk: true, racyCheckOk: true,
    playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS', signatureTimestamp: Number(manifest.sigTimestamp) || manifest.sigTimestamp } },
  };
  const data = await postJson(PLAYER_URL, body, {
    'X-YouTube-Client-Name': TV.id,
    'X-YouTube-Client-Version': TV.version,
    Origin: 'https://www.youtube.com',
    'Sec-Fetch-Mode': 'navigate',
  });
  const status = nav(data, 'playabilityStatus.status');
  if (status !== 'OK') throw new Error(`TVHTML5 client: status=${status || 'UNKNOWN'}, reason=${nav(data, 'playabilityStatus.reason') || 'Unknown'}`);
  // TV formats aksar cipher mein hote hain — collectStreams decode karta hai (direct via)
  return collectStreams(data, 'TVHTML5', 'direct');
}
/**
 * Playable streams: browser seedha chala sake pehle (IOS/TV direct),
 * phir ANDROID (proxy ke through). Har client andar quality desc.
 */
async function getStreams(videoId) {
  const visitorData = await fetchVisitorData(videoId);
  let ios = [], android = [], tv = [];
  try { ios = await getStreamsIos(videoId, visitorData || undefined); } catch { /* next */ }
  try { android = await getStreamsAndroid(videoId, visitorData || undefined); } catch { /* stale visitor? refresh */ }
  if (!android.length && !ios.length) {
    clearVisitor();
    const fresh = await fetchVisitorData(videoId);
    try { android = await getStreamsAndroid(videoId, fresh || undefined); } catch { /* next */ }
    if (!android.length) { try { ios = await getStreamsIos(videoId, fresh || undefined); } catch { /* next */ } }
  }
  if (!ios.length && !android.length) {
    try { tv = await getStreamsTv(videoId); } catch { /* sab fail */ }
  }
  // audio-only pehle, phir bitrate — muxed video wala sab se akhir (direct mein)
  const byPreference = (a, b) => ((b.audioOnly ? 1 : 0) - (a.audioOnly ? 1 : 0)) || (b.bitrate - a.bitrate);
  const direct = [...ios, ...tv].sort(byPreference);
  const proxied = android.sort(byPreference);
  return [...direct, ...proxied];
}

/* ── Diagnostic (temporary): har stream client ka asal jawab ── */
function fmtCounts(data) {
  const sd = (data && data.streamingData) || {};
  const all = [...(arr(sd.adaptiveFormats) || []), ...(arr(sd.formats) || [])];
  return {
    playability: nav(data, 'playabilityStatus.status') || null,
    reason: nav(data, 'playabilityStatus.reason') || null,
    formats: all.length,
    withUrl: all.filter(f => typeof f.url === 'string').length,
    withCipher: all.filter(f => typeof (f.signatureCipher || f.cipher) === 'string').length,
  };
}
async function diagStreams(videoId) {
  const out = { videoId, visitor: null, clients: {}, cipher: null, webRemix: null };
  try {
    const vd = await fetchVisitorData(videoId);
    out.visitor = vd ? `ok (len=${vd.length})` : 'missing';
  } catch (e) { out.visitor = 'error: ' + String(e && e.message || e); }
  const vd = visitorDataCache || undefined;
  for (const [name, fn] of [
    ['IOS', () => getStreamsIos(videoId, vd)],
    ['ANDROID', () => getStreamsAndroid(videoId, vd)],
    ['TVHTML5', () => getStreamsTv(videoId)],
  ]) {
    try {
      const s = await fn();
      out.clients[name] = { streams: s.length, first: s[0] ? { client: s[0].client, via: s[0].via, format: s[0].format, bitrate: s[0].bitrate } : null };
    } catch (e) { out.clients[name] = { error: String(e && e.message || e) }; }
  }
  try {
    const m = await cipher.getCipherManifest();
    out.cipher = { jsUrl: m.jsUrl, sigTimestamp: String(m.sigTimestamp), ops: (m.ops || []).length };
  } catch (e) { out.cipher = { error: String(e && e.message || e) }; }
  try {
    await seedVisitorData();
    const data = await ytmPost('player', {
      context: buildContext(), videoId, contentCheckOk: true, racyCheckOk: true,
    });
    out.webRemix = fmtCounts(data);
  } catch (e) { out.webRemix = { error: String(e && e.message || e) }; }
  return out;
}

/* ── Public API (client.rs functions ka port) ── */
const SEARCH_FILTERS = {
  songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
  albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
  artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF',
  playlists: 'Eg-KAQwIABAAGAAgACgBMABqChAEEAMQCRAFEAo%3D',
  all: undefined,
};
async function searchTracks(query, type, pageToken) {
  if (pageToken) {
    const data = await ytmPostContinuation('search', pageToken, { context: buildContext() });
    const { items, continuation } = parseSearchResults(data);
    return { results: mapItems(items), nextPage: continuation || null };
  }
  await seedVisitorData();
  const body = { context: buildContext(), query };
  const params = SEARCH_FILTERS[type];
  if (params) body.params = params;
  const data = await ytmPost('search', body);
  const { items, continuation } = parseSearchResults(data);
  return { results: mapItems(items), nextPage: continuation || null };
}

let homeMemo = null; // plugin HOME_CACHE_TTL_SECONDS=300 ki lambda-memory version
async function getHome() {
  if (homeMemo && (Date.now() - homeMemo.at) < 300_000) return homeMemo.sections;
  await seedVisitorData();
  const first = await ytmPost('browse', { context: buildContext(), browseId: 'FEmusic_home' });
  let page = parseHomeSectionsPage(first, 0, false);
  let sections = [...page.sections];
  let token = page.nextPageToken;
  let pages = 0;
  while (token && pages < 6) {
    pages++;
    const data = await ytmPostContinuation('browse', token, { context: buildContext() });
    const p = parseHomeSectionsPage(data, sections.length, true);
    sections.push(...p.sections);
    token = p.nextPageToken;
  }
  if (!sections.length) throw new Error('YouTube Music home se koi section nahi mila');
  const seen = new Set();
  const out = sections.map(s => ({
    ...s,
    items: s.items.map(p => mapParsedItem(p)).filter(Boolean),
  })).filter(s => {
    if (!s.items.length || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  homeMemo = { at: Date.now(), sections: out };
  return out;
}

async function getTrackDetails(videoId) {
  await seedVisitorData();
  const data = await ytmPost('player', {
    context: buildContext(), videoId, contentCheckOk: true, racyCheckOk: true,
  });
  const details = data && data.videoDetails;
  if (!details || !details.title) throw new Error(`videoDetails missing for ${videoId}`);
  const thumbs = arr(nav(details, 'thumbnail.thumbnails')) || [];
  const sized = thumbs.filter(t => t && typeof t.url === 'string').map(t => [cleanThumbUrl(t.url), t.width || 0]).sort((a, b) => a[1] - b[1]);
  const image = bestImage(sized) || ytThumbFallback(videoId);
  const lengthSeconds = Number(details.lengthSeconds) || null;
  const channelId = details.channelId || '';
  return {
    kind: 'track', source: SRC,
    id: trackId(videoId), vid: videoId,
    title: details.title,
    artist: details.author || 'Unknown Artist',
    artists: [{ id: channelId, name: details.author || 'Unknown Artist', image: '' }],
    album: null,
    duration: lengthSeconds,
    image,
    year: null, language: null, explicit: false, hasLyrics: true,
    permaUrl: `https://music.youtube.com/watch?v=${videoId}`,
  };
}

async function getAlbumDetails(browseId) {
  await seedVisitorData();
  const data = await ytmPost('browse', { context: buildContext(), browseId });
  const header = parseAlbumHeader(data);
  if (!header) throw new Error(`Album page parse nahi hua: ${browseId}`);
  const { tracks, continuation } = parseAlbumTracks(data);
  const albumImage = bestImage(header.thumbnails);
  const albumCtx = { id: browseId, title: header.title };
  return {
    album: {
      kind: 'album', source: SRC, id: browseId,
      title: header.title,
      artist: header.artists.map(a => a.name).join(', '),
      artists: header.artists.map(a => ({ id: a.id || '', name: a.name, image: '' })),
      image: albumImage, year: header.year ?? null, subtitle: 'Album',
      permaUrl: `https://music.youtube.com/browse/${browseId}`,
    },
    tracks: tracks.map(t => mapAlbumTrack(t, albumCtx, albumImage)),
    description: header.description || null,
    nextPage: continuation || null,
  };
}

async function getPlaylistDetails(browseId) {
  const actualId = browseId.startsWith('VL') ? browseId : 'VL' + browseId;
  await seedVisitorData();
  const data = await ytmPost('browse', { context: buildContext(), browseId: actualId });
  const header = parsePlaylistHeader(data);
  if (!header) throw new Error(`Playlist page parse nahi hua: ${browseId}`);
  const { tracks, continuation } = parsePlaylistTracks(data);
  const image = bestImage(header.thumbnails);
  return {
    playlist: {
      kind: 'playlist', source: SRC, id: actualId,
      title: header.title, image,
      owner: header.owner || null,
      subtitle: header.owner || 'Playlist',
      count: header.trackCount ?? null,
      permaUrl: `https://music.youtube.com/playlist?list=${actualId.replace(/^VL/, '')}`,
    },
    tracks: tracks.map(t => mapAlbumTrack(t, undefined, image)),
    description: header.description || null,
    nextPage: continuation || null,
  };
}

async function getArtistDetails(channelId) {
  await seedVisitorData();
  const data = await ytmPost('browse', { context: buildContext(), browseId: channelId });
  const artist = parseArtistPage(data, channelId);
  const image = bestImage(artist.thumbnails);
  return {
    artist: {
      kind: 'artist', source: SRC, id: channelId,
      name: artist.name, image, subtitle: 'Artist',
      permaUrl: `https://music.youtube.com/channel/${channelId}`,
    },
    topTracks: artist.topTracks.map(p => mapParsedItem(p)).filter(Boolean),
    albums: artist.albums.map(p => mapParsedItem(p)).filter(Boolean),
    related: artist.related.map(p => mapParsedItem(p)).filter(Boolean),
    description: artist.description || null,
  };
}

async function getMoreTracks(token) {
  const data = await ytmPostContinuation('browse', token, { context: buildContext() });
  const { tracks, continuation } = parseContinuationTracks(data);
  return { tracks: tracks.map(t => mapAlbumTrack(t)), nextPage: continuation || null };
}

async function getRadio(videoId, pageToken) {
  if (pageToken) {
    const data = await ytmPostContinuation('next', pageToken, { context: buildContext() });
    const panel = nav(data, 'continuationContents.playlistPanelContinuation');
    return {
      tracks: parseWatchPanelItems(arr(panel && panel.contents)).map(t => mapAlbumTrack(t)),
      nextPage: panelContinuation(panel) || null,
    };
  }
  await seedVisitorData();
  const playlistId = videoId.startsWith('RD') ? videoId : `RDAMVM${videoId}`;
  const data = await ytmPost('next', {
    context: buildContext(),
    videoId, playlistId,
    enablePersistentPlaylistPanel: true, isAudioOnly: true,
    tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
  });
  const { tracks, continuation } = parseWatchPlaylist(data);
  return {
    tracks: tracks.map(t => mapAlbumTrack(t)),
    nextPage: continuation || null,
  };
}

module.exports = {
  getHome, search: searchTracks, getTrackDetails, getStreams,
  getAlbumDetails, getPlaylistDetails, getArtistDetails,
  getMoreTracks, getRadio, diagStreams,
  ANDROID_UA: ANDROID.ua,
  _internals: { parseSearchResults, parseHomeSectionsPage, mapParsedItem },
};
