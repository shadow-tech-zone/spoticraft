/* ═══════════════════════════════════════════════════════════════
   GET /api/yt?action=… — Bloomee `ytmusic.bex` plugin ka gateway
   Plugin: kojima-ui/bloom-factory → ytmusic (YouTube Music resolver)

   action=home                              YTM home sections
   action=search&q=&type=songs|albums|artists|playlists|all&page=<continuation>
   action=track&id=<videoId>                details + playable streams
   action=streams&id=<videoId>              sirf fresh streams
   action=album&id=<MPRE…>                  album + tracks
   action=playlist&id=<VL…|PL…>             playlist + tracks
   action=artist&id=<UC…>                   artist page (top/albums/related)
   action=radio&id=<videoId>&page=<token>   automix radio (next)
   action=more&page=<continuation>          album/playlist next page tracks
   action=stream&url=<googlevideo URL>      ANDROID-UA stream proxy
                                            (browser <audio> ke liye)
   Sab responses JioSaavn wale (/api/*) hi shapes mein hain, aur
   har item par `source:"ytmusic"` lagta hai.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const { Readable } = require('stream');
const yt = require('./_ytmusic');
const { sendJson, badRequest } = require('./_jiosaavn');

const CACHE_HOME = 'public, s-maxage=300, stale-while-revalidate=900';
const CACHE_READ = 'public, s-maxage=120, stale-while-revalidate=600';
const CACHE_TRACK = 'public, s-maxage=60, stale-while-revalidate=300';

const VID = /^[A-Za-z0-9_-]{11}$/;
const safeVideoId = raw => {
  const id = String(raw || '').replace(/^yt_/, '');
  return VID.test(id) ? id : null;
};
const safeBrowseId = (raw, prefixes) => {
  const id = String(raw || '').trim();
  if (!/^[A-Za-z0-9_-]{2,100}$/.test(id)) return null;
  if (prefixes && !prefixes.some(p => id.startsWith(p))) return null;
  return id;
};

/* ANDROID client streams ke liye UA-proxy (plugin: headers["User-Agent"]).
   Browser <audio> custom header nahi bhej sakta — ye function wahi
   header server-side lagata hai aur Range requests pass karta hai. */
async function proxyStream(req, res, rawUrl) {
  let target;
  try { target = new URL(rawUrl); } catch { return sendJson(res, 400, { error: 'stream url invalid hai' }, null); }
  const host = target.hostname;
  if (!/(^|\.)googlevideo\.com$/.test(host) && !/(^|\.)youtube\.com$/.test(host)) {
    return sendJson(res, 400, { error: 'Sirf YouTube stream URLs proxy hoti hain' }, null);
  }
  const headers = { 'User-Agent': yt.ANDROID_UA };
  if (req.headers.range) headers.Range = req.headers.range;
  const upstream = await fetch(target, { headers, signal: AbortSignal.timeout(30000) });
  res.statusCode = upstream.status;
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h === 'content-type' ? 'Content-Type' : h, v);
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'private, max-age=120');
  if (!upstream.body) { res.end(); return; }
  Readable.fromWeb(upstream.body).pipe(res);
}

/* ANDROID (via:"proxy") streams ke raw googlevideo URLs ko isi
   gateway ke stream-proxy URLs se badal do — taake har consumer
   (web player, ya koi aur client) ko ready-to-play URL mile,
   kyunke raw URL sirf ANDROID User-Agent ke saath chalta hai. */
const withProxyUrls = streams => (streams || []).map(s => (s && s.via === 'proxy' && s.url)
  ? { ...s, url: `/api/yt?action=stream&url=${encodeURIComponent(s.url)}` }
  : s);

const actions = {
  async home() {
    const sections = await yt.getHome();
    return { body: { source: 'bloomee-ytmusic', sections }, cache: CACHE_HOME };
  },
  async search(q) {
    const query = (q.q || '').trim();
    if (!query) return badRequest('q parameter zaroori hai');
    const type = ['songs', 'albums', 'artists', 'playlists'].includes(q.type) ? q.type : 'all';
    const page = q.page && q.page !== '1' ? String(q.page) : null;
    const d = await yt.search(query, type, page);
    return { body: { source: 'bloomee-ytmusic', type, results: d.results, nextPage: d.nextPage }, cache: CACHE_READ };
  },
  async track(q) {
    const videoId = safeVideoId(q.id);
    if (!videoId) return badRequest('id (videoId) parameter zaroori hai');
    const [track, streams] = await Promise.all([
      yt.getTrackDetails(videoId).catch(() => null),
      yt.getStreams(videoId),
    ]);
    if (!track && !streams.length) return { status: 404, body: { error: 'Track ya stream nahi mila' }, cache: null };
    return {
      body: { source: 'bloomee-ytmusic', track: track || undefined, streams: withProxyUrls(streams) },
      cache: CACHE_TRACK,
    };
  },
  async streams(q) {
    const videoId = safeVideoId(q.id);
    if (!videoId) return badRequest('id (videoId) parameter zaroori hai');
    const streams = await yt.getStreams(videoId);
    return { body: { source: 'bloomee-ytmusic', streams: withProxyUrls(streams) }, cache: 'public, s-maxage=60, stale-while-revalidate=120' };
  },
  async album(q) {
    const id = safeBrowseId(q.id, ['MPRE']);
    if (!id) return badRequest('id (MPRE… album browseId) zaroori hai');
    const d = await yt.getAlbumDetails(id);
    return { body: { source: 'bloomee-ytmusic', ...d }, cache: CACHE_READ };
  },
  async playlist(q) {
    const id = safeBrowseId(q.id, ['VL', 'PL', 'RD', 'OL', 'UU']);
    if (!id) return badRequest('id (playlist browseId) zaroori hai');
    const d = await yt.getPlaylistDetails(id);
    return { body: { source: 'bloomee-ytmusic', ...d }, cache: CACHE_READ };
  },
  async artist(q) {
    const id = safeBrowseId(q.id, ['UC']);
    if (!id) return badRequest('id (UC… channel id) zaroori hai');
    const d = await yt.getArtistDetails(id);
    return { body: { source: 'bloomee-ytmusic', ...d }, cache: CACHE_READ };
  },
  async radio(q) {
    const videoId = safeVideoId(q.id);
    if (!videoId && !(q.id || '').startsWith('RD')) return badRequest('id (seed videoId) zaroori hai');
    const seed = videoId || String(q.id);
    const d = await yt.getRadio(seed, q.page ? String(q.page) : null);
    return { body: { source: 'bloomee-ytmusic', tracks: d.tracks, nextPage: d.nextPage }, cache: CACHE_READ };
  },
  async more(q) {
    const token = String(q.page || q.token || '');
    if (!token) return badRequest('page (continuation token) zaroori hai');
    const d = await yt.getMoreTracks(token);
    return { body: { source: 'bloomee-ytmusic', tracks: d.tracks, nextPage: d.nextPage }, cache: CACHE_READ };
  },
};

module.exports = async (req, res) => {
  const q = req.query || {};
  try {
    if (q.action === 'stream') return await proxyStream(req, res, q.url || '');
    const fn = actions[q.action || 'home'];
    if (!fn) return sendJson(res, 400, { error: `Unknown action: ${q.action || ''}`, actions: Object.keys(actions).concat('stream') }, null);
    const out = await fn(q);
    sendJson(res, out.status || 200, out.body, out.cache);
  } catch (e) {
    sendJson(res, 502, {
      error: 'Bloomee backend (YouTube Music resolver) se jawab nahi mila',
      detail: String((e && e.message) || e),
    }, null);
  }
};
