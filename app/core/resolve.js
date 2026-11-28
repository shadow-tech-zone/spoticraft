/* Stream resolver — main process aur tests dono yahi use karte hain.
   Primary source fail (masalan YTM ka LOGIN_REQUIRED bot-check) to
   doosre source par wahi gaana dhoondh kar stream wahan se.
   Rescue matching: pehla result blindly nahi — title/artist/duration
   score karke behtareen match (karaoke/cover se bach kar). */
import { jiosaavn } from './jiosaavn.js';
import { ytmusic } from './ytmusic.js';
import { parseMediaId } from './model.js';

const impl = (src) => (src === 'ytmusic' ? ytmusic : jiosaavn);

const normWords = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean));
const JUNK = /\b(karaoke|cover|instrumental|ringtone|8d audio|slowed|reverb|sped up|lofi|lo-fi)\b/i;

export function rescueScore(track, cand) {
  const t = normWords(track.title);
  const c = normWords(cand.title);
  let score = 0;
  for (const w of t) if (c.has(w)) score += 2;
  const artist0 = track.artists?.[0]?.name?.toLowerCase().split(' ')[0];
  if (artist0 && cand.artists?.some(a => a.name?.toLowerCase().includes(artist0))) score += 3;
  if (track.durationMs && cand.durationMs) {
    const d = Math.abs(track.durationMs - cand.durationMs);
    if (d < 3000) score += 3;
    else if (d < 8000) score += 1;
    else if (d > 25000) score -= 2;
  }
  if (JUNK.test(cand.title || '') && !JUNK.test(track.title || '')) score -= 5;
  return score;
}

export function pickRescue(track, items) {
  if (!items?.length) return null;
  let best = null, bestScore = -Infinity;
  for (const cand of items.slice(0, 6)) {
    const s = rescueScore(track, cand);
    if (s > bestScore) { bestScore = s; best = cand; }
  }
  return best;
}

export async function resolveStreams(track, log = () => {}) {
  const t = typeof track === 'string' ? { id: track } : (track || {});
  const parsed = parseMediaId(t.id || '');
  const source = parsed?.source || 'jiosaavn';
  const localId = parsed?.localId || t.id;
  const primary = impl(source);
  try {
    const streams = await primary.streams(localId);
    if (!streams?.length) throw new Error('empty stream list');
    log('streams ok', source, localId, `${streams.length} variants`);
    return { streams, via: source };
  } catch (e1) {
    log('streams primary fail', source, localId, e1.message);
    const otherSrc = source === 'ytmusic' ? 'jiosaavn' : 'ytmusic';
    const other = impl(otherSrc);
    const q = [t.title, t.artists?.[0]?.name].filter(Boolean).join(' ').trim();
    if (q) {
      try {
        const res = await other.search(q, 'track', 1);
        const cand = pickRescue(t, res?.items || []);
        if (cand) {
          const streams = await other.streams(parseMediaId(cand.id)?.localId || cand.id);
          if (streams?.length) {
            log('streams fallback ok', otherSrc, cand.id, `score-match`);
            return { streams, via: `${otherSrc}-fallback`, matched: cand.title };
          }
        }
      } catch (e2) { log('streams fallback fail', e2.message); }
    }
    throw e1;
  }
}
