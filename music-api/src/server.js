/* Music API — BloomeeTunes ke plugin contract (ContentResolver /
   ChartProvider / LyricsProvider) ki ek unified REST API.
   Sources: JioSaavn + YouTube Music. Koi npm dependency nahi.
   Chalana: node src/server.js   (PORT env, default 3000) */
import { createServer } from 'node:http';
import { jiosaavn } from './jiosaavn.js';
import { ytmusic } from './ytmusic.js';
import { getLyrics } from './lyrics.js';
import { parseMediaId, ApiError, ok } from './model.js';

export const SOURCES = { jiosaavn, ytmusic };

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(json);
}

function pickSources(srcParam) {
  if (!srcParam || srcParam === 'all') return Object.values(SOURCES);
  const s = SOURCES[srcParam];
  if (!s) throw new ApiError(`unknown source '${srcParam}' (jiosaavn | ytmusic | all)`, 400, 'bad_source');
  return [s];
}

function byMediaId(mediaId) {
  const parts = parseMediaId(mediaId);
  if (!parts) throw new ApiError(`malformed media id '${mediaId}' — format: source::localId`, 400, 'bad_id');
  const source = SOURCES[parts.source];
  if (!source) throw new ApiError(`unknown source in media id '${parts.source}'`, 400, 'bad_source');
  return { source, localId: parts.localId };
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;
  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (path === '/') {
    return send(res, 200, {
      name: 'music-api',
      about: 'BloomeeTunes plugin contract (search/home/details/streams/radio/charts/lyrics) as one REST API',
      sources: Object.keys(SOURCES),
      endpoints: [
        'GET /api/health',
        'GET /api/home?src=all|jiosaavn|ytmusic',
        'GET /api/search?q=&filter=all|track|album|playlist|artist&src=&page=',
        'GET /api/suggestions?q=&src=',
        'GET /api/track/{source}::{id}',
        'GET /api/track/{source}::{id}/streams',
        'GET /api/album/{source}::{id}',
        'GET /api/playlist/{source}::{id}',
        'GET /api/artist/{source}::{id}',
        'GET /api/radio/{source}::{id}?page=',
        'GET /api/charts?src=',
        'GET /api/charts/{source}::{id}',
        'GET /api/lyrics?title=&artist=&album=&durationMs=',
        'GET /api/lyrics/{source}::{id}',
      ],
    });
  }

  if (path === '/api/health') {
    return send(res, 200, { ok: true, status: 'up', sources: Object.keys(SOURCES), time: new Date().toISOString() });
  }

  if (path === '/api/home') {
    const sources = pickSources(q.get('src'));
    const sections = [];
    for (const s of sources) {
      const ss = await s.home();
      for (const sec of ss) sections.push({ source: s.id, ...sec });
    }
    return send(res, 200, ok(q.get('src') || 'all', sections));
  }

  if (path === '/api/search') {
    const query = q.get('q');
    if (!query) throw new ApiError('missing ?q=', 400, 'bad_request');
    const filter = q.get('filter') || 'all';
    if (!['all', 'track', 'album', 'playlist', 'artist'].includes(filter)) {
      throw new ApiError(`bad filter '${filter}'`, 400, 'bad_request');
    }
    const sources = pickSources(q.get('src'));
    if (sources.length === 1) {
      const s = sources[0];
      return send(res, 200, ok(s.id, await s.search(query, filter, q.get('page') || 1)));
    }
    const results = {};
    await Promise.all(sources.map(async (s) => {
      try { results[s.id] = await s.search(query, filter, 1); }
      catch (e) { results[s.id] = { error: e.message }; }
    }));
    return send(res, 200, ok('all', results));
  }

  if (path === '/api/suggestions') {
    const query = q.get('q');
    if (!query) throw new ApiError('missing ?q=', 400, 'bad_request');
    const sources = pickSources(q.get('src'));
    const out = [];
    for (const s of sources) {
      const items = await s.suggestions(query).catch(() => []);
      for (const text of items) if (!out.includes(text)) out.push(text);
    }
    return send(res, 200, ok(q.get('src') || 'all', out.slice(0, 10)));
  }

  if (path === '/api/charts') {
    const sources = pickSources(q.get('src'));
    const charts = [];
    for (const s of sources) {
      const cs = await s.charts().catch(() => []);
      for (const c of cs) charts.push(c);
    }
    return send(res, 200, ok(q.get('src') || 'all', charts));
  }

  let m = path.match(/^\/api\/(track|album|playlist|artist|radio|charts)\/(.+)$/);
  if (m) {
    const [, kind] = m;
    let rawId = decodeURIComponent(m[2]);
    const wantStreams = kind === 'track' && rawId.endsWith('/streams');
    if (wantStreams) rawId = rawId.slice(0, -'/streams'.length);
    const { source, localId } = byMediaId(rawId);
    if (kind === 'track') {
      if (wantStreams) return send(res, 200, ok(source.id, await source.streams(localId)));
      return send(res, 200, ok(source.id, await source.trackDetails(localId)));
    }
    if (kind === 'album') return send(res, 200, ok(source.id, await source.albumDetails(localId)));
    if (kind === 'playlist') return send(res, 200, ok(source.id, await source.playlistDetails(localId)));
    if (kind === 'artist') return send(res, 200, ok(source.id, await source.artistDetails(localId)));
    if (kind === 'radio') return send(res, 200, ok(source.id, await source.radio(localId, Number(q.get('page')) || 1)));
    if (kind === 'charts') return send(res, 200, ok(source.id, await source.chartDetails(localId)));
  }

  if (path === '/api/lyrics') {
    const title = q.get('title');
    const artistName = q.get('artist');
    if (!title || !artistName) throw new ApiError('missing ?title= and ?artist=', 400, 'bad_request');
    const lyrics = await getLyrics({
      title, artist: artistName, album: q.get('album'),
      durationMs: q.get('durationMs') ? Number(q.get('durationMs')) : null,
    });
    if (!lyrics) throw new ApiError('lyrics not found', 404, 'not_found');
    return send(res, 200, ok('lrclib', lyrics));
  }

  m = path.match(/^\/api\/lyrics\/(.+)$/);
  if (m) {
    const { source, localId } = byMediaId(decodeURIComponent(m[1]));
    const t = await source.trackDetails(localId);
    let lyrics = await getLyrics({
      title: t.title,
      artist: t.artists?.[0]?.name || '',
      album: t.album?.title || null,
      durationMs: t.durationMs,
    });
    if (!lyrics && source.lyricsById) lyrics = await source.lyricsById(localId).catch(() => null);
    if (!lyrics) throw new ApiError('lyrics not found', 404, 'not_found');
    return send(res, 200, ok(lyrics.source || 'lrclib', { track: t.id, ...lyrics }));
  }

  throw new ApiError(`no such route: ${path}`, 404, 'no_route');
}

export function createMusicServer() {
  return createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      send(res, status, { ok: false, error: { code: e.code || 'internal', message: e.message } });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 3000;
  createMusicServer().listen(port, '0.0.0.0', () => {
    console.log(`music-api listening on http://0.0.0.0:${port}`);
  });
}
