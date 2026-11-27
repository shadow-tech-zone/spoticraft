/* LyricsProvider — Bloomee ki tarah metadata (title/artist/album/
   duration) se LRCLIB par synced lyrics. */
import { fetchJson } from './http.js';

/** "[mm:ss.xx] text" wali LRC -> [{ timeMs, text }] */
export function parseLrc(synced) {
  if (!synced) return [];
  const lines = [];
  for (const raw of String(synced).split('\n')) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/);
    if (!m) continue;
    lines.push({ timeMs: Math.round((Number(m[1]) * 60 + Number(m[2])) * 1000), text: m[3] || '' });
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function shape(d) {
  if (!d) return null;
  return {
    plain: d.plainLyrics || null,
    synced: d.syncedLyrics ? parseLrc(d.syncedLyrics) : null,
    source: 'lrclib',
    instrumental: !!d.instrumental,
  };
}

export async function getLyrics({ title, artist, album = null, durationMs = null }) {
  if (!title || !artist) return null;
  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) params.set('album_name', album);
  if (durationMs) params.set('duration', String(Math.round(durationMs / 1000)));
  try {
    const d = await fetchJson(`https://lrclib.net/api/get?${params}`);
    const s = shape(d);
    if (s && (s.plain || s.synced)) return s;
  } catch { /* search fallback */ }
  try {
    const list = await fetchJson(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: title, artist_name: artist })}`);
    if (Array.isArray(list)) {
      const best = list.find(x => x.syncedLyrics) || list[0];
      const s = shape(best);
      if (s && (s.plain || s.synced)) return s;
    }
  } catch { /* nahi mila */ }
  return null;
}
