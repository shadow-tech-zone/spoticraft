/* GET /api/lyrics?track=&artist=&album=&duration=
   Bloomee ka `lrcnet.bex` plugin (LRCLIB) — wahi endpoints:
   pehle /api/get (exact match), phir /api/search fallback.       */
'use strict';
const { handler, badRequest } = require('./_jiosaavn');

const BASE = 'https://lrclib.net/api';
const UA = 'BloomeeWeb/1.0 (BloomeeTunes web player)';

async function lrclib(path) {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) return null;
  return res.json();
}
const pick = r => r && (r.syncedLyrics || r.plainLyrics)
  ? { id: r.id, plain: r.plainLyrics || null, synced: r.syncedLyrics || null, instrumental: !!r.instrumental }
  : null;

module.exports = handler(async (q) => {
  const track = (q.track || '').trim();
  if (!track) return badRequest('track parameter zaroori hai');
  const artist = (q.artist || '').trim();
  const album = (q.album || '').trim();
  const duration = parseInt(q.duration, 10);

  const p = new URLSearchParams({ track_name: track });
  if (artist) p.set('artist_name', artist);
  if (album) p.set('album_name', album);
  if (Number.isFinite(duration) && duration > 0) p.set('duration', String(duration));
  const exact = pick(await lrclib('/get?' + p.toString()).catch(() => null));
  if (exact) return { body: { source: 'bloomee-lrcnet', lyrics: exact } };

  const sq = new URLSearchParams({ q: [track, artist].filter(Boolean).join(' ') });
  const results = await lrclib('/search?' + sq.toString()).catch(() => null);
  const found = Array.isArray(results) ? pick(results.find(r => r.syncedLyrics) || results[0]) : null;
  return { body: { source: 'bloomee-lrcnet', lyrics: found }, cache: 'public, s-maxage=3600, stale-while-revalidate=86400' };
});
