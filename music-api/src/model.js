/* Unified model — BloomeeTunes ke plugin contract (models.dart) ki
   REST shakl. Har object ka id Bloomee ki tarah stamped hai:
   "{source}::{localId}" (media_id.dart ka '::' separator). */

export const SOURCES = {
  jiosaavn: { id: 'jiosaavn', name: 'JioSaavn' },
  ytmusic: { id: 'ytmusic', name: 'YouTube Music' },
};

export const stamp = (source, localId) => `${source}::${localId}`;

export function parseMediaId(id) {
  if (typeof id !== 'string') return null;
  const idx = id.indexOf('::');
  if (idx === -1) return null;
  return { source: id.slice(0, idx), localId: id.slice(idx + 2) };
}

export function decodeEntities(s) {
  if (typeof s !== 'string') return s ?? '';
  return s
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** "3:25" / seconds number -> milliseconds */
export function durationToMs(d) {
  if (d == null || d === '') return null;
  if (typeof d === 'number') return Math.round(d * 1000);
  const s = String(d).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 1000);
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return Math.round(parts.reduce((a, p) => a * 60 + p, 0) * 1000);
}

const art = (url) => (url ? { url } : { url: null });

export function track({ source, id, title, artists = [], album = null, durationMs = null, artwork = null, explicit = false, url = null }) {
  return {
    kind: 'track',
    id: stamp(source, id),
    title: decodeEntities(title || ''),
    artists: artists.map(a => (typeof a === 'string'
      ? { id: null, name: decodeEntities(a) }
      : { id: a.id ? stamp(source, a.id) : null, name: decodeEntities(a.name || '') })),
    album: album ? { id: album.id ? stamp(source, album.id) : null, title: decodeEntities(album.title || '') } : null,
    durationMs,
    artwork: art(artwork),
    isExplicit: !!explicit,
    url: url || null,
  };
}

export function album({ source, id, title, artists = [], year = null, artwork = null, trackCount = null }) {
  return {
    kind: 'album',
    id: stamp(source, id),
    title: decodeEntities(title || ''),
    artists: artists.map(a => (typeof a === 'string'
      ? { id: null, name: decodeEntities(a) }
      : { id: a.id ? stamp(source, a.id) : null, name: decodeEntities(a.name || '') })),
    year: year || null,
    artwork: art(artwork),
    trackCount: trackCount ?? null,
  };
}

export function artist({ source, id, name, artwork = null, subtitle = null }) {
  return {
    kind: 'artist',
    id: stamp(source, id),
    name: decodeEntities(name || ''),
    artwork: art(artwork),
    subtitle: subtitle || null,
  };
}

export function playlist({ source, id, title, description = null, artwork = null, trackCount = null, author = null }) {
  return {
    kind: 'playlist',
    id: stamp(source, id),
    title: decodeEntities(title || ''),
    description: description ? decodeEntities(description) : null,
    artwork: art(artwork),
    trackCount: trackCount ?? null,
    author: author || null,
  };
}

/** API jawab ka standard ghonsla: { ok, source, data } / { ok:false, error } */
export function ok(source, data) { return { ok: true, source, data }; }

export class ApiError extends Error {
  constructor(message, status = 502, code = 'upstream') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
